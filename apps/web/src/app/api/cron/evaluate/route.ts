import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import type { Alert } from "@prisma/client";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/db";
import { assetOf, pricingPair } from "@/core/symbols";
import {
  indicatorNotice, moveNotice, portfolioMoveNotice, positionPnlNotice, priceTargetNotice,
  type Notice,
} from "@/lib/alert-copy";
import { evaluatePositionPnl } from "@/lib/alerts";
import { evaluatePortfolioMove, expandPortfolioRules, expandRules } from "@/lib/alert-rules";
import { fetchKlines } from "@/data/sources/binance";
import { assetTypeOf, baselines, priceSymbols, type PricedSymbol, type Settings } from "@/data/services/alert-pricing";
import { deps } from "@/lib/deps";
import { run } from "@/lib/indicator";
import {
  evaluatePctMove, evaluatePriceTarget, PctMoveParams, PriceTargetParams, utcDayOpen,
} from "@/lib/alerts";
import { computeHoldings, type Tx, type TxSide } from "@/lib/portfolio";
import { WebhookNotifier, webhookUrl } from "@/lib/notifier/webhook";
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
      else if (a.kind === "portfolio_move") summary.push(await evalPortfolioMove(a, notifiers, pricing));
      else if (a.kind === "position_pnl") summary.push(await evalPositionPnl(a, notifiers, pricing));
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
  ev: {
    barTime: number; signal: string; symbol: string; price: number;
    /**
     * What a person reads. Composed here rather than in each notifier: Web
     * Push and FCM each wrote their own from the routing payload and produced
     * "BTCUSDT · target_above:BTCUSDT", which is the ticker twice and an
     * internal tag. The evaluator is the only place that holds the alert, the
     * price and the currency at once, so it is the only place that can write
     * a sentence.
     */
    text: Notice;
    meta?: Record<string, unknown>;
  },
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
        text: ev.text,
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
      // The indicator runs on Binance klines, so its prices are USDT — the
      // only place in this route where the currency is known statically.
      text: indicatorNotice({
        name: assetOf(a.symbol), signal: s.kind, price: s.price,
        currency: "USDT", timeframe: a.timeframe,
      }),
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
  const quote = prices[a.symbol];
  if (quote === undefined) {
    return { alertId: a.id, fired: 0, skipped: 0, error: `no price for ${a.symbol}` };
  }

  let fired = 0, skipped = 0;
  if (evaluatePriceTarget(params, quote.price)) {
    const ok = await dispatch(a, notifiers, {
      barTime: utcDayOpen(Date.now()),
      signal: `target_${params.direction}:${a.symbol}`,
      symbol: a.symbol,
      price: quote.price,
      text: priceTargetNotice({
        name: assetOf(a.symbol),
        direction: params.direction,
        target: params.price,
        price: quote.price,
        currency: quote.currency,
        oneShot: !a.repeat,
      }),
      meta: { target: params.price },
    });
    if (ok) fired++; else skipped++;
  }

  await prisma.alert.update({
    where: { id: a.id },
    // A one-shot disarms itself; a continuous one stays on and may say the
    // same thing tomorrow, which is what the person asked for when they chose
    // it. The dedupe on (alertId, barTime, signal) keeps that to once a day.
    data: { lastEvaluated: new Date(), ...(fired && !a.repeat ? { enabled: false } : {}) },
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
/**
 * The portfolio's own move, evaluated once against the total.
 *
 * Not a loop over holdings: that is `pct_move`, and it answers a different
 * question. This asks whether the money moved, which is what the front page
 * shows and what no rule could express before.
 *
 * The rule is built through `expandPortfolioRules` rather than from the row
 * directly, so the server and the device agree on what is included — cash out,
 * coins as Binance pairs, shares as bare tickers — instead of two evaluators
 * each deciding for themselves.
 */
/**
 * What a position has done since it was bought, against a threshold.
 *
 * Built through `expandRules` rather than by hand, so the server and the
 * device agree on the one rule that needs the ledger: which holdings exist,
 * what each cost, and that a rule about something unheld produces no check.
 * `heldSymbols` carries the average cost for exactly this.
 */
async function evalPositionPnl(
  a: Alert, notifiers: Notifier[], pricing: Settings,
): Promise<Summary> {
  const held = await heldSymbols(a.portfolioId);
  const rules = expandRules(
    [{
      id: a.id, kind: "position_pnl", symbol: a.symbol, portfolioId: a.portfolioId,
      assetType: assetTypeOf(a),
      params: JSON.parse(a.params) as Record<string, unknown>, repeat: a.repeat,
    }],
    held.map((h: PricedSymbol) => ({
      symbol: h.symbol, assetType: h.assetType, quantity: h.quantity, avgCost: h.avgCost,
    })),
  );
  await prisma.alert.update({ where: { id: a.id }, data: { lastEvaluated: new Date() } });
  if (rules.length === 0) return { alertId: a.id, fired: 0, skipped: 0 };

  const wanted = rules.map((r) => ({ symbol: r.symbol, assetType: r.assetType }));
  const prices = await priceSymbols(deps().net, pricing, wanted);

  const day = Math.floor(Date.now() / 86_400_000) * 86_400_000;
  let fired = 0, skipped = 0;
  for (const rule of rules) {
    const quote = prices[rule.symbol];
    if (!quote || rule.pnlPct === undefined) { skipped++; continue; }
    const hit = evaluatePositionPnl(
      { direction: rule.pnlDirection ?? "up", pct: rule.pnlPct }, rule.avgCost ?? 0, quote.price,
    );
    if (!hit) { skipped++; continue; }
    const sent = await dispatch(a, notifiers, {
      barTime: day,
      signal: `pnl_${rule.pnlDirection ?? "up"}:${rule.symbol}`,
      symbol: rule.symbol,
      price: quote.price,
      text: positionPnlNotice({
        name: rule.name, direction: rule.pnlDirection ?? "up", pct: hit.pct,
        avgCost: rule.avgCost ?? 0, price: quote.price, currency: quote.currency,
      }),
    });
    if (sent) fired++; else skipped++;
  }
  return { alertId: a.id, fired, skipped };
}

async function evalPortfolioMove(
  a: Alert, notifiers: Notifier[], pricing: Settings,
): Promise<Summary> {
  const held = await heldSymbols(a.portfolioId);
  const [rule] = expandPortfolioRules(
    [{
      id: a.id, kind: "portfolio_move", symbol: a.symbol, portfolioId: a.portfolioId,
      params: JSON.parse(a.params) as Record<string, unknown>, repeat: a.repeat,
    }],
    held.map((h: PricedSymbol) => ({ symbol: h.symbol, assetType: h.assetType, quantity: h.quantity })),
  );
  if (!rule) {
    await prisma.alert.update({ where: { id: a.id }, data: { lastEvaluated: new Date() } });
    return { alertId: a.id, fired: 0, skipped: 0 };
  }

  const wanted = rule.holdings.map((h) => ({ symbol: h.symbol, assetType: h.assetType }));
  const [prices, base] = await Promise.all([
    priceSymbols(deps().net, pricing, wanted),
    baselines(deps().net, pricing, wanted),
  ]);

  const priced = Object.fromEntries(Object.entries(prices).map(([k, v]) => [k, v.price]));
  const hit = evaluatePortfolioMove(rule, priced, base);
  await prisma.alert.update({ where: { id: a.id }, data: { lastEvaluated: new Date() } });
  if (!hit) return { alertId: a.id, fired: 0, skipped: 1 };

  const portfolioName = a.portfolioId
    ? (await prisma.portfolio.findUnique({ where: { id: a.portfolioId }, select: { name: true } }))?.name
    : null;
  const currency = Object.values(prices)[0]?.currency ?? "USD";
  // From the hit, not reduced again: a holding it excluded from the percentage
  // has to be excluded from the money the notice quotes too.
  const { value, from } = hit;

  /*
   * The bar time is the UTC day, and the signal carries the direction — the
   * same dedupe shape the other kinds use, so a standing fall notifies once
   * and a rise after it still gets through, because they are different news.
   */
  const day = Math.floor(Date.now() / 86_400_000) * 86_400_000;
  const sent = await dispatch(a, notifiers, {
    barTime: day,
    signal: `portfolio_${hit.direction}`,
    symbol: a.symbol ?? rule.portfolioId,
    price: value,
    text: portfolioMoveNotice({
      portfolio: portfolioName ?? "your portfolio",
      direction: hit.direction, pct: hit.pct, from, value, currency,
      skipped: hit.skipped,
    }),
  });
  return { alertId: a.id, fired: sent ? 1 : 0, skipped: sent ? 0 : 1 };
}

async function evalPctMove(
  a: Alert, notifiers: Notifier[], pricing: Settings,
): Promise<Summary> {
  const params = PctMoveParams.parse(JSON.parse(a.params));
  const wanted: PricedSymbol[] = a.symbol
    ? [{ symbol: a.symbol, assetType: assetTypeOf(a) }]
    : await heldSymbols(a.portfolioId);
  /*
   * Only for a portfolio-wide rule, and only its name.
   *
   * These fire on a symbol the person never chose — the setup flow's "big
   * moves" switch is one row meaning every holding — so the notification has
   * to say which rule chose it. Without that there is no route from the thing
   * that woke you to the switch that turns it off.
   */
  const portfolioName = a.symbol || !a.portfolioId
    ? null
    : (await prisma.portfolio.findUnique({
        where: { id: a.portfolioId }, select: { name: true },
      }))?.name ?? null;
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

  // A symbol that will not price is skipped, silently and deliberately — see
  // the note in `alert-rules.ts` about the no-price alert that was built and
  // removed.
  let fired = 0, skipped = 0;
  for (const { symbol } of wanted) {
    const quote = prices[symbol];
    const was = base[symbol];
    if (quote === undefined || was === undefined) continue;
    const hit = evaluatePctMove(params, was, quote.price);
    if (!hit) continue;
    const ok = await dispatch(a, notifiers, {
      barTime: utcDayOpen(Date.now()),
      signal: `move_${hit.direction}:${symbol}`,
      symbol,
      price: quote.price,
      text: moveNotice({
        name: assetOf(symbol),
        direction: hit.direction,
        pct: hit.pct,
        from: was,
        price: quote.price,
        currency: quote.currency,
        // Only for a rule that watches everything: a notification about a
        // symbol nobody chose has to say which rule chose it.
        portfolio: a.symbol ? null : portfolioName,
      }),
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
      // Carried for `portfolio_move`, which totals a book rather than testing a
      // price. The per-symbol kinds ignore it: a threshold on a price is the
      // same question however much of it is held.
      quantity: h.quantity,
      // Read only by `position_pnl`, the one kind that asks about the holder.
      avgCost: h.avgCost,
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
  const hook = webhookUrl(s?.haUrl, s?.haWebhookId);
  if (hook) out.push(new WebhookNotifier(hook));
  const wp = makeWebPushNotifier();
  if (wp) out.push(wp);
  const fcm = makeFcmNotifier();
  if (fcm) out.push(fcm);
  return out;
}

/**
 * Constant-time string comparison.
 *
 * `timingSafeEqual` throws on a length mismatch rather than returning false,
 * which is itself a signal — so the lengths are compared first and the
 * comparison still runs, against the value itself, so a wrong-length guess
 * costs the same as a right-length one.
 */
function secretsMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  const same = ab.length === bb.length;
  return timingSafeEqual(same ? ab : bb, bb) && same;
}

async function authorized(req: NextRequest): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  // `===` on a bearer token compares byte by byte and returns at the first
  // difference. Not practically exploitable across a network against a
  // JavaScript comparison, and the route is on a trusted network by design —
  // but `auth.ts` already reaches for `timingSafeEqual` on the password path,
  // so this was the one place doing it the other way.
  if (cronSecret && header && secretsMatch(header, `Bearer ${cronSecret}`)) return true;
  const sessionSecret = process.env.SESSION_SECRET;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  return !!(sessionSecret && token && (await verifySessionToken(token, sessionSecret)));
}
