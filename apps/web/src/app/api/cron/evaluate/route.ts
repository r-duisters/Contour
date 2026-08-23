import { NextRequest, NextResponse } from "next/server";
import type { Alert } from "@prisma/client";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/db";
import { fetchKlines, fetchPricesSafe } from "@/data/sources/binance";
import { deps } from "@/lib/deps";
import { run } from "@/lib/indicator";
import {
  evaluatePctMove, evaluatePriceTarget, PctMoveParams, PriceTargetParams, utcDayOpen,
} from "@/lib/alerts";
import { computeHoldings, type Tx, type TxSide } from "@/lib/portfolio";
import { HomeAssistantNotifier } from "@/lib/notifier/home-assistant";
import { makeWebPushNotifier } from "@/lib/notifier/web-push";
import type { Notifier } from "@/lib/notifier";
import type { Timeframe } from "@/lib/types";

export const dynamic = "force-dynamic";

type Summary = { alertId: string; fired: number; skipped: number; error?: string };

/**
 * Evaluate every enabled alert against the latest data and dispatch new events
 * via the configured notifier. Idempotent: a (alertId, barTime, signal)
 * unique constraint prevents duplicate dispatch across cron ticks.
 */
export async function GET(req: NextRequest) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  const notifiers = makeNotifiers(settings);
  const alerts = await prisma.alert.findMany({ where: { enabled: true } });
  const summary: Summary[] = [];

  for (const a of alerts) {
    try {
      if (a.kind === "price_target") summary.push(await evalPriceTarget(a, notifiers));
      else if (a.kind === "pct_move") summary.push(await evalPctMove(a, notifiers));
      else summary.push(await evalIndicator(a, notifiers));
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
  notifiers: Notifier[],
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
  let deliveredToAny = false;
  for (const n of notifiers) {
    try {
      await n.send({
        alertId: a.id,
        symbol: ev.symbol,
        timeframe: a.timeframe,
        signal: ev.signal,
        price: ev.price,
        time: ev.barTime,
        meta: ev.meta,
      });
      deliveredToAny = true;
    } catch {
      // one notifier failing must not block the others; delivered stays false if all fail
    }
  }
  if (deliveredToAny) {
    await prisma.alertEvent.updateMany({
      where: { alertId: a.id, barTime: BigInt(ev.barTime), signal: ev.signal },
      data: { delivered: true },
    });
  }
  return true;
}

async function evalIndicator(a: Alert, notifiers: Notifier[]): Promise<Summary> {
  if (!a.symbol) return { alertId: a.id, fired: 0, skipped: 0, error: "indicator alert has no symbol" };
  const bars = await fetchKlines(deps().net, {
    symbol: a.symbol, interval: a.timeframe as Timeframe, limit: 500,
  });
  // Drop the in-progress bar; only act on closed bars.
  const closed = bars.slice(0, -1);
  const { signals } = run(closed, JSON.parse(a.params));

  let fired = 0, skipped = 0;
  for (const s of signals) {
    if (a.lastBarTime && BigInt(s.barTime) <= a.lastBarTime) { skipped++; continue; }
    const ok = await dispatch(a, notifiers, {
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
async function evalPriceTarget(a: Alert, notifiers: Notifier[]): Promise<Summary> {
  if (!a.symbol) return { alertId: a.id, fired: 0, skipped: 0, error: "price_target alert has no symbol" };
  const params = PriceTargetParams.parse(JSON.parse(a.params));
  const price = (await fetchPricesSafe(deps().net, [a.symbol]))[a.symbol];
  if (price === undefined) {
    return { alertId: a.id, fired: 0, skipped: 0, error: `no price for ${a.symbol}` };
  }

  let fired = 0, skipped = 0;
  if (evaluatePriceTarget(params, price)) {
    const ok = await dispatch(a, notifiers, {
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
async function evalPctMove(a: Alert, notifiers: Notifier[]): Promise<Summary> {
  const params = PctMoveParams.parse(JSON.parse(a.params));
  const symbols = a.symbol ? [a.symbol] : await heldSymbols(a.portfolioId);
  if (symbols.length === 0) {
    await prisma.alert.update({ where: { id: a.id }, data: { lastEvaluated: new Date() } });
    return { alertId: a.id, fired: 0, skipped: 0 };
  }

  const prices = await fetchPricesSafe(deps().net, symbols);
  let fired = 0, skipped = 0;
  for (const symbol of symbols) {
    const price = prices[symbol];
    if (price === undefined) continue;
    const daily = await fetchKlines(deps().net, { symbol, interval: "1d", limit: 2 });
    const prevClose = daily.length >= 2 ? daily[daily.length - 2]!.c : NaN;
    const hit = evaluatePctMove(params, prevClose, price);
    if (!hit) continue;
    const ok = await dispatch(a, notifiers, {
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

function makeNotifiers(s: { haUrl: string | null; haWebhookId: string | null } | null): Notifier[] {
  const out: Notifier[] = [];
  if (s?.haUrl && s?.haWebhookId) out.push(new HomeAssistantNotifier(s.haUrl, s.haWebhookId));
  const wp = makeWebPushNotifier();
  if (wp) out.push(wp);
  return out;
}

async function authorized(req: NextRequest): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  if (cronSecret && header === `Bearer ${cronSecret}`) return true;
  const sessionSecret = process.env.SESSION_SECRET;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  return !!(sessionSecret && token && (await verifySessionToken(token, sessionSecret)));
}
