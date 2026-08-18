import { NextResponse } from "next/server";
import type { Alert } from "@prisma/client";
import { prisma } from "@/lib/db";
import { fetchKlines, fetchPricesSafe } from "@/lib/binance";
import { run } from "@/lib/indicator";
import {
  evaluatePctMove, evaluatePriceTarget, PctMoveParams, PriceTargetParams, utcDayOpen,
} from "@/lib/alerts";
import { computeHoldings, type Tx, type TxSide } from "@/lib/portfolio";
import { HomeAssistantNotifier } from "@/lib/notifier/home-assistant";
import type { Notifier } from "@/lib/notifier";
import type { Timeframe } from "@/lib/types";

export const dynamic = "force-dynamic";

type Summary = { alertId: string; fired: number; skipped: number; error?: string };

/**
 * Evaluate every enabled alert against the latest data and dispatch new events
 * via the configured notifier. Idempotent: a (alertId, barTime, signal)
 * unique constraint prevents duplicate dispatch across cron ticks.
 */
export async function GET() {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  const notifier = makeNotifier(settings);
  const alerts = await prisma.alert.findMany({ where: { enabled: true } });
  const summary: Summary[] = [];

  for (const a of alerts) {
    try {
      if (a.kind === "price_target") summary.push(await evalPriceTarget(a, notifier));
      else if (a.kind === "pct_move") summary.push(await evalPctMove(a, notifier));
      else summary.push(await evalIndicator(a, notifier));
    } catch (e) {
      summary.push({ alertId: a.id, fired: 0, skipped: 0, error: (e as Error).message });
    }
  }

  return NextResponse.json({ ok: true, summary });
}

/**
 * Create the event (dedupe via unique constraint), then notify and mark delivered.
 * Returns false when this (barTime, signal) was already dispatched.
 */
async function dispatch(
  a: Alert,
  notifier: Notifier | null,
  ev: { barTime: number; signal: string; symbol: string; price: number; meta?: Record<string, unknown> },
): Promise<boolean> {
  try {
    await prisma.alertEvent.create({
      data: {
        alertId: a.id,
        barTime: BigInt(ev.barTime),
        signal: ev.signal,
        price: ev.price,
        payload: JSON.stringify({ timeframe: a.timeframe, ...ev }),
      },
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return false;
    throw e;
  }
  if (notifier) {
    await notifier.send({
      alertId: a.id,
      symbol: ev.symbol,
      timeframe: a.timeframe,
      signal: ev.signal,
      price: ev.price,
      time: ev.barTime,
      meta: ev.meta,
    });
    await prisma.alertEvent.updateMany({
      where: { alertId: a.id, barTime: BigInt(ev.barTime), signal: ev.signal },
      data: { delivered: true },
    });
  }
  return true;
}

async function evalIndicator(a: Alert, notifier: Notifier | null): Promise<Summary> {
  if (!a.symbol) return { alertId: a.id, fired: 0, skipped: 0, error: "indicator alert has no symbol" };
  const bars = await fetchKlines({
    symbol: a.symbol, interval: a.timeframe as Timeframe, limit: 500,
  });
  // Drop the in-progress bar; only act on closed bars.
  const closed = bars.slice(0, -1);
  const { signals } = run(closed, JSON.parse(a.params));

  let fired = 0, skipped = 0;
  for (const s of signals) {
    if (a.lastBarTime && BigInt(s.barTime) <= a.lastBarTime) { skipped++; continue; }
    const ok = await dispatch(a, notifier, {
      barTime: s.barTime, signal: s.kind, symbol: a.symbol, price: s.price,
    });
    if (ok) fired++; else skipped++;
  }

  await prisma.alert.update({
    where: { id: a.id },
    data: {
      lastEvaluated: new Date(),
      lastBarTime: closed.length ? BigInt(closed[closed.length - 1]!.t) : a.lastBarTime,
    },
  });
  return { alertId: a.id, fired, skipped };
}

/** One-shot: checks the live ticker price and disables the alert after it fires. */
async function evalPriceTarget(a: Alert, notifier: Notifier | null): Promise<Summary> {
  if (!a.symbol) return { alertId: a.id, fired: 0, skipped: 0, error: "price_target alert has no symbol" };
  const params = PriceTargetParams.parse(JSON.parse(a.params));
  const price = (await fetchPricesSafe([a.symbol]))[a.symbol];
  if (price === undefined) {
    return { alertId: a.id, fired: 0, skipped: 0, error: `no price for ${a.symbol}` };
  }

  let fired = 0, skipped = 0;
  if (evaluatePriceTarget(params, price)) {
    const ok = await dispatch(a, notifier, {
      barTime: utcDayOpen(Date.now()),
      signal: `target_${params.direction}:${a.symbol}`,
      symbol: a.symbol,
      price,
      meta: { target: params.price },
    });
    if (ok) fired++; else skipped++;
  }

  await prisma.alert.update({
    where: { id: a.id },
    data: { lastEvaluated: new Date(), ...(fired ? { enabled: false } : {}) },
  });
  return { alertId: a.id, fired, skipped };
}

/**
 * Live price vs. previous daily close, for one symbol or every held symbol of a portfolio.
 * Fires at most once per direction per symbol per UTC day (event dedupe).
 */
async function evalPctMove(a: Alert, notifier: Notifier | null): Promise<Summary> {
  const params = PctMoveParams.parse(JSON.parse(a.params));
  const symbols = a.symbol ? [a.symbol] : await heldSymbols(a.portfolioId);
  if (symbols.length === 0) {
    await prisma.alert.update({ where: { id: a.id }, data: { lastEvaluated: new Date() } });
    return { alertId: a.id, fired: 0, skipped: 0 };
  }

  const prices = await fetchPricesSafe(symbols);
  let fired = 0, skipped = 0;
  for (const symbol of symbols) {
    const price = prices[symbol];
    if (price === undefined) continue;
    const daily = await fetchKlines({ symbol, interval: "1d", limit: 2 });
    const prevClose = daily.length >= 2 ? daily[daily.length - 2]!.c : NaN;
    const hit = evaluatePctMove(params, prevClose, price);
    if (!hit) continue;
    const ok = await dispatch(a, notifier, {
      barTime: utcDayOpen(Date.now()),
      signal: `move_${hit.direction}:${symbol}`,
      symbol,
      price,
      meta: { pct: Number(hit.pct.toFixed(2)), prevClose, threshold: params.threshold },
    });
    if (ok) fired++; else skipped++;
  }

  await prisma.alert.update({ where: { id: a.id }, data: { lastEvaluated: new Date() } });
  return { alertId: a.id, fired, skipped };
}

async function heldSymbols(portfolioId: string | null): Promise<string[]> {
  if (!portfolioId) return [];
  const rows = await prisma.transaction.findMany({ where: { portfolioId } });
  const txs: Tx[] = rows.map((t) => ({
    symbol: t.symbol,
    side: t.side as TxSide,
    quantity: t.quantity,
    price: t.price,
    fee: t.fee,
    time: Number(t.time),
  }));
  return computeHoldings(txs).filter((h) => h.quantity > 0).map((h) => h.symbol);
}

function makeNotifier(s: { haUrl: string | null; haWebhookId: string | null } | null): Notifier | null {
  if (!s?.haUrl || !s?.haWebhookId) return null;
  return new HomeAssistantNotifier(s.haUrl, s.haWebhookId);
}
