import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { toDisplayTxs } from "@/lib/display-tx";
import { fetchKlines, fetchKlinesRange } from "@/lib/binance";
import { fetchEcbRates, fetchLatestEurUsd, rateOn } from "@/lib/fx";
import { currencyForTicker, makeEquitySource } from "@/lib/equity";
import { portfolioValueSeries } from "@/lib/portfolio";
import { flowsByBar, moneyWeightedReturn, timeWeightedSeries } from "@/lib/performance";
import { cached } from "@/lib/cache";
import type { Bar } from "@/lib/types";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;
const Query = z.object({
  range: z.enum(["1d", "1w", "1m", "ytd", "1y", "2y", "5y", "all"]).default("all"),
});

/** Window start for a range, and the candle width used to draw it. */
function rangeWindow(range: string, firstTx: number): { from: number; barMs: number } {
  const now = Date.now();
  switch (range) {
    case "1d": return { from: now - DAY_MS, barMs: 3_600_000 };
    case "1w": return { from: now - 7 * DAY_MS, barMs: DAY_MS };
    case "1m": return { from: now - 31 * DAY_MS, barMs: DAY_MS };
    case "ytd": return { from: Date.UTC(new Date(now).getUTCFullYear(), 0, 1), barMs: DAY_MS };
    case "1y": return { from: now - 365 * DAY_MS, barMs: DAY_MS };
    case "2y": return { from: now - 2 * 365 * DAY_MS, barMs: DAY_MS };
    case "5y": return { from: now - 5 * 365 * DAY_MS, barMs: DAY_MS };
    default: return { from: firstTx, barMs: DAY_MS };
  }
}

/**
 * Portfolio value over time. Split out of /valuation because it needs full
 * price history for every asset ever held — seconds of work that must not
 * delay the headline figures.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = Query.safeParse({ range: req.nextUrl.searchParams.get("range") ?? "all" });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { range } = parsed.data;
  const portfolio = await prisma.portfolio.findUnique({
    where: { id },
    include: { transactions: true },
  });
  if (!portfolio) return NextResponse.json({ error: "not found" }, { status: 404 });

  const settings = await prisma.settings.findUnique({
    where: { id: 1 },
    select: { displayCurrency: true, equityProvider: true, equityApiKey: true },
  });
  const currency = settings?.displayCurrency === "EUR" ? "EUR" : "USD";
  const displayUsd = currency === "EUR" ? ((await fetchLatestEurUsd()) ?? 0) : 1;
  const toDisplay = displayUsd > 0 ? 1 / displayUsd : 1;

  const txs = toDisplayTxs(portfolio.transactions, currency, toDisplay);
  if (txs.length === 0) return NextResponse.json({ series: [], currency, range });

  const equitySymbols = new Set(
    portfolio.transactions.filter((t) => t.assetType === "equity").map((t) => t.symbol),
  );
  const firstTx = Math.min(...txs.map((t) => t.time));
  const { from: windowFrom, barMs } = rangeWindow(range, firstTx);
  // Prices must cover the window, but holdings must be reconstructed from the
  // very first transaction, so history always starts at firstTx for dailies.
  const from = barMs === DAY_MS ? firstTx : windowFrom;
  const symbols = [...new Set(txs.map((t) => t.symbol))];

  // Equity closes arrive in the venue's own currency; convert each day with
  // the ECB rate for that day so the history is not skewed by today's FX.
  const source = makeEquitySource(settings?.equityProvider, settings?.equityApiKey);
  const fxByCurrency = new Map<string, Map<number, number>>();
  for (const s of symbols) {
    if (!equitySymbols.has(s)) continue;
    const cur = currencyForTicker(s);
    if (cur === "USD" || fxByCurrency.has(cur)) continue;
    try {
      fxByCurrency.set(cur, await fetchEcbRates(cur, "USD", from, Date.now()));
    } catch {
      fxByCurrency.set(cur, new Map());
    }
  }

  const histories = await Promise.allSettled(
    symbols.map(async (s): Promise<Bar[]> => {
      if (!equitySymbols.has(s)) {
        return barMs === DAY_MS
          ? fetchKlinesRange({ symbol: s, interval: "1d", from, to: Date.now() })
          : cached(`h1:${s}:${Math.floor(Date.now() / 300_000)}`, 300_000, () =>
              fetchKlines({ symbol: s, interval: "1h", limit: 26 }),
            );
      }
      const rows = await cached(
        `eqhist:${s}:${barMs}:${Math.floor(Date.now() / 3_600_000)}`,
        3_600_000,
        async () => (source.history
          ? await source.history(s, barMs === DAY_MS ? "10y" : "1d", barMs === DAY_MS ? "1d" : "60m")
          : []),
      );
      const cur = currencyForTicker(s);
      const fx = fxByCurrency.get(cur);
      return rows.flatMap((r) => {
        const usd = cur === "USD" ? r.c : (() => {
          const rate = fx ? rateOn(fx, r.t) : null;
          return rate === null ? null : r.c * rate;
        })();
        if (usd === null) return [];
        // Snap to the bar grid so equity and crypto points line up.
        const slot = Math.floor(r.t / barMs) * barMs;
        return [{ t: slot, o: usd, h: usd, l: usd, c: usd, v: 0 }];
      });
    }),
  );

  const candles: Record<string, Bar[]> = {};
  histories.forEach((r, i) => {
    if (r.status === "fulfilled") candles[symbols[i]!] = r.value;
  });

  // Intraday: a market that is closed has no bars for the early part of the
  // window. Without a seed those holdings read as worthless until the open,
  // which would show up as a huge fake gain over the day.
  if (barMs !== DAY_MS) {
    for (const bars of Object.values(candles)) {
      const first = bars[0];
      if (first && first.t > windowFrom) {
        bars.unshift({ ...first, t: Math.floor(windowFrom / barMs) * barMs });
      }
    }
  }

  const series = portfolioValueSeries(txs, candles, barMs)
    .filter((p) => p.t >= windowFrom)
    .map((p) => ({ t: p.t, value: p.value * toDisplay }));

  // Baseline is the first point that actually holds something: the earliest
  // bars of an "all" window predate the first fill and are legitimately zero.
  const first = series.find((p) => p.value > 0)?.value ?? 0;
  const last = series[series.length - 1]?.value ?? 0;
  // Change over the window. Deposits inside it inflate this — it is portfolio
  // value movement, not a time-weighted return.
  // Over "all" the baseline is the first purchase, so a percentage would
  // report every later deposit as a gain. Report the absolute move only.
  const change = series.length >= 2 && first > 0
    ? {
        abs: last - first,
        pct: range === "all" ? null : ((last - first) / first) * 100,
      }
    : null;

  // Time-weighted return over the window: what one unit invested at the start
  // would have done, with deposits and withdrawals removed.
  const windowTxs = txs.filter((t) => t.time >= windowFrom);
  const windowFlows = flowsByBar(windowTxs, barMs);
  const twr = timeWeightedSeries(series, windowFlows);

  // Money-weighted return: annualised, and sensitive to when money went in.
  // The opening value counts as an investment made at the window's start.
  const opening = series[0]?.value ?? 0;
  const closing = series[series.length - 1]?.value ?? 0;
  const closingAt = series[series.length - 1]?.t ?? Date.now();
  const cashFlows = [
    ...(opening > 0 ? [{ t: series[0]!.t, amount: opening }] : []),
    ...[...windowFlows.entries()]
      .filter(([t]) => t > (series[0]?.t ?? 0))
      .map(([t, amount]) => ({ t, amount })),
  ];
  const mwrPct = moneyWeightedReturn(cashFlows, closing, closingAt);
  const investedNet = cashFlows.reduce((a, f) => a + f.amount, 0);

  return NextResponse.json({
    series, currency, range, change,
    twr: { points: twr.points, totalPct: twr.totalPct },
    mwr: { annualPct: mwrPct, investedNet, closing },
    windowFrom, barMs,
  });
}
