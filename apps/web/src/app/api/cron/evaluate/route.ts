import { NextRequest, NextResponse } from "next/server";
import type { Alert } from "@prisma/client";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/db";
import { pricingPair } from "@/core/symbols";
import { fetchKlines } from "@/data/sources/binance";
import { assetTypeOf, baselines, priceSymbols, type PricedSymbol, type Settings } from "@/lib/alert-pricing";
import { deps } from "@/lib/deps";
import { run } from "@/lib/indicator";
import {
  evaluatePctMove, evaluatePriceTarget, PctMoveParams, PriceTargetParams, utcDayOpen,
} from "@/lib/alerts";
import { computeHoldings, type Tx, type TxSide } from "@/lib/portfolio";
import { HomeAssistantNotifier } from "@/lib/notifier/home-assistant";
import { makeWebPushNotifier } from "@/lib/notifier/web-push";
import { makeFcmNotifier } from "@/lib/notifier/fcm";
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
  // Which provider prices shares, for the alerts that are about shares.
  const pricing = { equityProvider: settings?.equityProvider, equityApiKey: settings?.equityApiKey };
  const alerts = await prisma.alert.findMany({ where: { enabled: true } });
  const summary: Summary[] = [];

  for (const a of alerts) {
    try {
      if (a.kind === "price_target") summary.push(await evalPriceTarget(a, notifiers, pricing));
      else if (a.kind === "pct_move") summary.push(await evalPctMove(a, notifiers, pricing));
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
async function evalPriceTarget(
  a: Alert, notifiers: Notifier[], pricing: Settings,
): Promise<Summary> {
  if (!a.symbol) return { alertId: a.id, fired: 0, skipped: 0, error: "price_target alert has no symbol" };
  const params = PriceTargetParams.parse(JSON.parse(a.params));
  // Priced through the venue that lists it. This asked Binance for everything,
  // so an ASML.AS target was never evaluated and never said so.
  const prices = await priceSymbols(deps().net, pricing, [
    { symbol: a.symbol, assetType: assetTypeOf(a) },
  ]);
  const price = prices[a.symbol];
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
 * Live price vs. the price a rolling twenty-four hours ago, for one symbol or
 * every held symbol of a portfolio. Fires at most once per direction per
 * symbol per UTC day (event dedupe).
 *
 * The window matches what the screens show. It used to be the previous daily
 * close — "since 00:00 UTC" — while the asset page drew a rolling day, so an
 * alert and the figure it was about could disagree by a percentage point.
 * Both now come from `fetchCrypto24hAgo`.
 */
async function evalPctMove(
  a: Alert, notifiers: Notifier[], pricing: Settings,
): Promise<Summary> {
  const params = PctMoveParams.parse(JSON.parse(a.params));
  const wanted: PricedSymbol[] = a.symbol
    ? [{ symbol: a.symbol, assetType: assetTypeOf(a) }]
    : await heldSymbols(a.portfolioId);
  if (wanted.length === 0) {
    await prisma.alert.update({ where: { id: a.id }, data: { lastEvaluated: new Date() } });
    return { alertId: a.id, fired: 0, skipped: 0 };
  }

  // Both halves keyed by the stored symbol, so a share and a coin are compared
  // the same way here even though the two venues were asked different things:
  // Binance a rolling day, an equity provider the previous close.
  const [prices, base] = await Promise.all([
    priceSymbols(deps().net, pricing, wanted),
    baselines(deps().net, pricing, wanted),
  ]);

  let fired = 0, skipped = 0;
  for (const { symbol } of wanted) {
    const price = prices[symbol];
    const was = base[symbol];
    if (price === undefined || was === undefined) continue;
    const hit = evaluatePctMove(params, was, price);
    if (!hit) continue;
    const ok = await dispatch(a, notifiers, {
      barTime: utcDayOpen(Date.now()),
      signal: `move_${hit.direction}:${symbol}`,
      symbol,
      price,
      meta: { pct: Number(hit.pct.toFixed(2)), dayAgo: was, threshold: params.threshold },
    });
    if (ok) fired++; else skipped++;
  }

  await prisma.alert.update({ where: { id: a.id }, data: { lastEvaluated: new Date() } });
  return { alertId: a.id, fired, skipped };
}

/**
 * The crypto a portfolio holds, for a rule that names no symbol of its own.
 *
 * Cash is excluded, and that is not tidiness. A EUR balance is a positive
 * quantity under the symbol `EUR`, which `pricingPair` turns into `EURUSDT` —
 * a real Binance market. A portfolio-wide swing rule would then page its owner
 * about the euro as though it were a holding.
 *
 * Equities are excluded too, though they need no filter to be: `pricingPair`
 * makes `ASML.AS` into `ASML.ASUSDT`, which Binance rejects, so they are
 * dropped by the price lookup instead. Silently — which is #19, and why an
 * equity alert cannot fire today.
 */
async function heldSymbols(portfolioId: string | null): Promise<PricedSymbol[]> {
  if (!portfolioId) return [];
  const rows = await prisma.transaction.findMany({
    where: { portfolioId, assetType: { not: "cash" } },
  });
  const txs: Tx[] = rows.map((t) => ({
    symbol: t.symbol,
    side: t.side as TxSide,
    quantity: t.quantity,
    price: t.price,
    fee: t.fee,
    time: Number(t.time),
  }));
  // The ledger already records what each holding is, so the kind comes from
  // the rows rather than from the shape of the ticker.
  const kindOf = new Map(rows.map((t) => [t.symbol, t.assetType]));
  return computeHoldings(txs)
    .filter((h) => h.quantity > 0)
    .map((h) => ({
      symbol: h.symbol,
      assetType: kindOf.get(h.symbol) === "equity" ? "equity" as const : "crypto" as const,
    }));
}

/**
 * Every configured way to reach a person, in one list. An absent one is
 * skipped rather than failing the tick, and `dispatch` marks an event
 * delivered if *any* of them succeeded.
 *
 * All three can be on at once, and on different devices they have to be:
 * Home Assistant fans out to whatever it already knows about, Web Push
 * reaches a browser or an installed PWA, and FCM reaches the Android build —
 * which cannot use Web Push at all, because its WebView implements no Push
 * API.
 */
function makeNotifiers(s: { haUrl: string | null; haWebhookId: string | null } | null): Notifier[] {
  const out: Notifier[] = [];
  if (s?.haUrl && s?.haWebhookId) out.push(new HomeAssistantNotifier(s.haUrl, s.haWebhookId));
  const wp = makeWebPushNotifier();
  if (wp) out.push(wp);
  const fcm = makeFcmNotifier();
  if (fcm) out.push(fcm);
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
