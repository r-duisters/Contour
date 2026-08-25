import { cached } from "@/core/cache";
import { toDisplayTxs } from "@/core/display-tx";
import { cashBalancesOver } from "@/core/cash";
import { currencyForTicker } from "@/core/equity";
import { rateOn } from "@/core/fx";
import {
  flowsByBar, indexSeries, moneyWeightedReturn, simulateFlowsInto, timeWeightedSeries,
  type ReturnPoint,
} from "@/core/performance";
import { portfolioValueSeries } from "@/core/portfolio";
import type { RangeKey } from "@/core/ranges";
import type { Bar } from "@/core/types";
import type { Net } from "../ports/net";
import type { Store, Transaction } from "../ports/store";
import { pricingPair } from "@/core/symbols";
import { fetchKlines, fetchKlinesRange, fetchDailyStats } from "../sources/binance";
import { makeEquitySource } from "../sources/equity";
import { fetchEcbRates } from "../sources/fx";
import { getPortfolio } from "./portfolios";
import { displayContext } from "./pricing";
import { currentCashRates } from "./valuation";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * The four endpoints that build a time window and walk it.
 *
 * ## What the three copies of the windowing helper actually agreed on
 *
 * `series` had `rangeWindow`, `changes` had `windowStart`, `history` had
 * `window_`. For the seven fixed keys — `1d` through `5y` — all three computed
 * the *same* boundary, to the millisecond. `all` is where they part: `series`
 * and `changes` anchor it to the portfolio's first transaction, while `history`
 * has no portfolio to anchor to and returns 0, meaning "everything the source
 * will give". That is the one parameter `windowStart` below takes, so the
 * agreement is shared and the disagreement is named at each call site rather
 * than reconciled into something neither endpoint did.
 *
 * The *granularity* decision is a genuine three-way disagreement and stays
 * three functions: `series` draws `1d` hourly and everything else daily,
 * `history` draws `1d` and `1w` hourly, and `changes` fetches hourly only for
 * `1d`. Folding those together would silently change at least two endpoints'
 * output. `yahooRange` is a fourth mapping — the equity provider's own
 * vocabulary — and is unrelated to the other three.
 */
function windowStart(range: RangeKey, allFrom: number): number {
  const now = Date.now();
  switch (range) {
    case "1d": return now - DAY_MS;
    case "1w": return now - 7 * DAY_MS;
    case "1m": return now - 31 * DAY_MS;
    case "ytd": return Date.UTC(new Date(now).getUTCFullYear(), 0, 1);
    case "1y": return now - 365 * DAY_MS;
    case "2y": return now - 2 * 365 * DAY_MS;
    case "5y": return now - 5 * 365 * DAY_MS;
    default: return allFrom;
  }
}

export type SeriesPoint = { t: number; value: number };

/**
 * What a portfolio was worth over a window, with the two return measures.
 *
 * A portfolio holding nothing priceable answers with the thin shape: there is
 * no window to report, and inventing a zeroed `change`/`twr`/`mwr` would put
 * figures on a chart that has no points.
 */
export type Series =
  | { series: SeriesPoint[]; currency: "USD" | "EUR"; range: RangeKey }
  | {
      series: SeriesPoint[];
      currency: "USD" | "EUR";
      range: RangeKey;
      change: { abs: number; pct: number | null } | null;
      twr: { points: ReturnPoint[]; totalPct: number | null };
      mwr: { annualPct: number | null; investedNet: number; closing: number };
      windowFrom: number;
      barMs: number;
    };

/**
 * Portfolio value over time. Split out of `valuation` because it needs full
 * price history for every asset ever held — seconds of work that must not
 * delay the headline figures.
 */
export async function series(
  store: Store,
  net: Net,
  id: string,
  range: RangeKey,
): Promise<Series> {
  const portfolio = await getPortfolio(store, id);
  const { currency, toDisplay, displayUsd, equityProvider, equityApiKey } =
    await displayContext(store, net);
  // A failed EUR lookup leaves `toDisplay` at 1, so every figure below stays in
  // USD. The label has to follow, or the response reports dollars as euros.
  // `currency` itself stays the raw setting: it also decides which stored
  // trades count as natively priced. Same split as `valuation`.
  const label = displayUsd > 0 ? currency : "USD";

  // Cash is reported beside the portfolio, not inside it: it has no price
  // series, so counting deposits as money entering the invested pool would
  // charge the return for capital the chart never shows.
  const txs = toDisplayTxs(
    portfolio.transactions.filter((t) => t.assetType !== "cash"),
    currency,
    toDisplay,
  );
  if (txs.length === 0) return { series: [], currency: label, range };

  const equitySymbols = new Set(
    portfolio.transactions.filter((t) => t.assetType === "equity").map((t) => t.symbol),
  );
  const firstTx = Math.min(...txs.map((t) => t.time));
  const windowFrom = windowStart(range, firstTx);
  const barMs = range === "1d" ? HOUR_MS : DAY_MS;
  // Prices must cover the window, but holdings must be reconstructed from the
  // very first transaction, so history always starts at firstTx for dailies.
  const from = barMs === DAY_MS ? firstTx : windowFrom;
  const symbols = [...new Set(txs.map((t) => t.symbol))];

  // Equity closes arrive in the venue's own currency; convert each day with
  // the ECB rate for that day so the history is not skewed by today's FX.
  const source = makeEquitySource(net, equityProvider, equityApiKey);
  const fxByCurrency = new Map<string, Map<number, number>>();
  for (const s of symbols) {
    if (!equitySymbols.has(s)) continue;
    const cur = currencyForTicker(s);
    if (cur === "USD" || fxByCurrency.has(cur)) continue;
    try {
      fxByCurrency.set(cur, await fetchEcbRates(net, cur, "USD", from, Date.now()));
    } catch {
      fxByCurrency.set(cur, new Map());
    }
  }

  const histories = await Promise.allSettled(
    symbols.map(async (s): Promise<Bar[]> => {
      if (!equitySymbols.has(s)) {
        // Binance prices the pair; the store may hold either form.
        const pair = pricingPair(s);
        return barMs === DAY_MS
          ? fetchKlinesRange(net, { symbol: pair, interval: "1d", from, to: Date.now() })
          : cached(`h1:${pair}:${Math.floor(Date.now() / 300_000)}`, 300_000, () =>
              fetchKlines(net, { symbol: pair, interval: "1h", limit: 26 }),
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

  const assetPoints: SeriesPoint[] = portfolioValueSeries(txs, candles, barMs)
    .filter((p) => p.t >= windowFrom)
    .map((p) => ({ t: p.t, value: p.value * toDisplay }));

  // Cash rides on the drawn line and nowhere else.
  //
  // The line has to end where the figure printed above it sits — `BRAND.md`
  // requires it, and the two disagreed by the whole cash balance for as long
  // as this endpoint has existed. But the returns below must stay on the
  // holdings alone: TWR divides by a value whose flows it has been told
  // about, and those flows are the asset trades. Feeding it a series that
  // jumps on every deposit while withholding the deposit from `windowFlows`
  // would report funding the account as performance.
  const cash = await cashOver(net, portfolio.transactions, assetPoints.map((p) => p.t), currency);
  const points: SeriesPoint[] = assetPoints.map((p, i) => ({
    t: p.t,
    value: p.value + (cash[i] ?? 0),
  }));

  // Baseline is the first point that actually holds something: the earliest
  // bars of an "all" window predate the first fill and are legitimately zero.
  const first = points.find((p) => p.value > 0)?.value ?? 0;
  const last = points[points.length - 1]?.value ?? 0;
  // Change over the window. Deposits inside it inflate this — it is portfolio
  // value movement, not a time-weighted return.
  // Over "all" the baseline is the first purchase, so a percentage would
  // report every later deposit as a gain. Report the absolute move only.
  const change = points.length >= 2 && first > 0
    ? {
        abs: last - first,
        pct: range === "all" ? null : ((last - first) / first) * 100,
      }
    : null;

  // Time-weighted return over the window: what one unit invested at the start
  // would have done, with deposits and withdrawals removed.
  const windowTxs = txs.filter((t) => t.time >= windowFrom);
  const windowFlows = flowsByBar(windowTxs, barMs);
  const twr = timeWeightedSeries(assetPoints, windowFlows);

  // Money-weighted return: annualised, and sensitive to when money went in.
  // The opening value counts as an investment made at the window's start.
  // Money-weighted return is measured on the holdings too, for the same reason
  // TWR is: its flow list is the asset trades, so its opening and closing
  // values must be of the same thing.
  const opening = assetPoints[0]?.value ?? 0;
  const closing = assetPoints[assetPoints.length - 1]?.value ?? 0;
  const closingAt = assetPoints[assetPoints.length - 1]?.t ?? Date.now();
  const cashFlows = [
    ...(opening > 0 ? [{ t: assetPoints[0]!.t, amount: opening }] : []),
    ...[...windowFlows.entries()]
      .filter(([t]) => t > (assetPoints[0]?.t ?? 0))
      .map(([t, amount]) => ({ t, amount })),
  ];
  const mwrPct = moneyWeightedReturn(cashFlows, closing, closingAt);
  const investedNet = cashFlows.reduce((a, f) => a + f.amount, 0);

  return {
    series: points,
    currency: label,
    range,
    change,
    twr: { points: twr.points, totalPct: twr.totalPct },
    mwr: { annualPct: mwrPct, investedNet, closing },
    windowFrom,
    barMs,
  };
}

export type Changes = { range: RangeKey; changes: Record<string, number> };

/**
 * Price change per held asset over the selected period, so a holding row can
 * say how the asset itself moved. This is the asset's price return, not the
 * position's — buying more mid-period does not flatter it.
 */
export async function changes(
  store: Store,
  net: Net,
  id: string,
  range: RangeKey,
): Promise<Changes> {
  const portfolio = await getPortfolio(store, id);
  if (portfolio.transactions.length === 0) return { range, changes: {} };

  // Every symbol the ledger mentions, cash included: a currency has no kline
  // and its lookup fails, which `allSettled` drops. Filtering cash out here
  // instead would be a behaviour change, not a tidy-up — a cash row whose
  // symbol is also a traded ticker would stop being asked about.
  const firstTx = Math.min(...portfolio.transactions.map((t) => t.time));
  const from = windowStart(range, firstTx);
  const equity = new Set(
    portfolio.transactions.filter((t) => t.assetType === "equity").map((t) => t.symbol),
  );
  const symbols = [...new Set(portfolio.transactions.map((t) => t.symbol))];

  const settings = await store.settings.get();
  const source = makeEquitySource(net, settings.equityProvider, settings.equityApiKey);
  const years = Math.max(1, Math.min(10, Math.ceil((Date.now() - from) / (365 * DAY_MS))));

  // A day's change for coins comes from one batched request against Binance's
  // own rolling window, for the same reason the header and the chart use it:
  // an hour-aligned basis measures 24 to 25 hours, and these percentages sit
  // beside the ones that do not. It is also one request for every holding
  // instead of one each.
  const dayStats = range === "1d"
    ? await fetchDailyStats(net, symbols.filter((sy) => !equity.has(sy)).map(pricingPair))
    : {};

  const results = await Promise.allSettled(
    symbols.map(async (symbol): Promise<[string, number] | null> => {
      if (range === "1d" && !equity.has(symbol)) {
        const stat = dayStats[pricingPair(symbol)];
        return stat ? [symbol, ((stat.last - stat.open24h) / stat.open24h) * 100] : null;
      }
      const closes = await cached(
        `chg:${symbol}:${range}:${Math.floor(Date.now() / 900_000)}`,
        900_000,
        async (): Promise<number[]> => {
          if (equity.has(symbol)) {
            if (!source.history) return [];
            const rows = await source.history(
              symbol,
              range === "1d" ? "1d" : `${years}y`,
              range === "1d" ? "60m" : "1d",
            );
            return rows.filter((r) => r.t >= from).map((r) => r.c);
          }
          // Crypto at "1d" never reaches here — it is answered above from the
          // batched rolling window.
          const pair = pricingPair(symbol);
          const bars = await fetchKlinesRange(net, {
            symbol: pair, interval: "1d", from, to: Date.now(),
          });
          return bars.map((b) => b.c);
        },
      );
      const first = closes.find((c) => c > 0);
      const last = closes[closes.length - 1];
      if (first === undefined || last === undefined || first <= 0) return null;
      return [symbol, ((last - first) / first) * 100];
    }),
  );

  const out: Record<string, number> = {};
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) out[r.value[0]] = r.value[1];
  }
  return { range, changes: out };
}

/** What a portfolio can be measured against. */
export const BENCHMARKS = {
  sp500: { label: "S&P 500", symbol: "^GSPC", kind: "equity" },
  aex: { label: "AEX", symbol: "^AEX", kind: "equity" },
  nasdaq: { label: "Nasdaq 100", symbol: "^NDX", kind: "equity" },
  world: { label: "MSCI World (IWDA)", symbol: "IWDA.AS", kind: "equity" },
  btc: { label: "Bitcoin", symbol: "BTCUSDT", kind: "crypto" },
  eth: { label: "Ethereum", symbol: "ETHUSDT", kind: "crypto" },
} as const;

export type BenchmarkKey = keyof typeof BENCHMARKS;

export type SameFlows = {
  finalValue: number;
  annualPct: number | null;
  series: SeriesPoint[];
};

export type Benchmark = {
  key: BenchmarkKey;
  label: string;
  points: ReturnPoint[];
  sameFlows?: SameFlows | null;
  /** Present only when the price feed failed; the caller draws nothing. */
  error?: string;
};

/**
 * A benchmark rebased to 100 at the start of the window, so it can be drawn
 * against a portfolio's time-weighted return index.
 *
 * It takes a window, not a range key: the caller is `series`' own answer, which
 * has already resolved the range into a `windowFrom` and a `barMs`. Handing it
 * a range key instead would have it re-derive a window from a clock that has
 * moved on since, and the two curves would no longer start on the same bar.
 */
export async function benchmark(
  store: Store,
  net: Net,
  opts: {
    key: BenchmarkKey;
    from: number;
    barMs?: number;
    /** When given, also simulate this portfolio's cash flows into the benchmark. */
    portfolioId?: string;
    /** Value already held when the window opened, treated as a day-one buy. */
    opening?: number;
  },
): Promise<Benchmark> {
  const { key, from, portfolioId, opening } = opts;
  const barMs = opts.barMs ?? DAY_MS;
  const bench = BENCHMARKS[key];

  try {
    const bars = await cached(
      `bench:${key}:${from}:${barMs}:${Math.floor(Date.now() / 900_000)}`,
      900_000,
      async () => {
        if (bench.kind === "crypto") {
          const raw = barMs === DAY_MS
            ? await fetchKlinesRange(net, { symbol: bench.symbol, interval: "1d", from, to: Date.now() })
            : await fetchKlines(net, { symbol: bench.symbol, interval: "1h", limit: 26 });
          return raw.map((b) => ({ t: Math.floor(b.t / barMs) * barMs, c: b.c }));
        }
        const settings = await store.settings.get();
        const source = makeEquitySource(net, settings.equityProvider, settings.equityApiKey);
        if (!source.history) return [];
        const years = Math.ceil((Date.now() - from) / (365 * DAY_MS));
        const range = barMs === DAY_MS ? `${Math.max(1, Math.min(10, years))}y` : "1d";
        const rows = await source.history(bench.symbol, range, barMs === DAY_MS ? "1d" : "60m");
        return rows
          .filter((r) => r.t >= from)
          .map((r) => ({ t: Math.floor(r.t / barMs) * barMs, c: r.c }));
      },
    );

    const sameFlows = portfolioId
      ? await simulateSameFlows(store, net, portfolioId, bars, from, barMs, opening ?? 0)
      : null;

    return { key, label: bench.label, points: indexSeries(bars), sameFlows };
  } catch (e) {
    return { key, label: bench.label, points: [], error: (e as Error).message };
  }
}

/**
 * Put the portfolio's own cash flows into the benchmark on the same days.
 * This is the fair long-horizon comparison: an index quote assumes a lump sum
 * on day one, which nobody actually did.
 */
async function simulateSameFlows(
  store: Store,
  net: Net,
  portfolioId: string,
  bars: { t: number; c: number }[],
  from: number,
  barMs: number,
  opening: number,
): Promise<SameFlows | null> {
  const portfolio = await store.portfolios.get(portfolioId);
  if (!portfolio || bars.length === 0) return null;

  const { currency, toDisplay } = await displayContext(store, net);
  // No relabel here, unlike `series` above: nothing in this response says what
  // currency its money figures are in. The caller draws them beside `series`
  // and takes the label from there, and a failed EUR lookup leaves both in
  // USD — so the two stay consistent. Adding a `currency` field would be a
  // new field on the wire, not the same fix.

  // Cash movements are not trades: buying euros is not investing them, and
  // counting a deposit as a benchmark purchase bought index units with money
  // that never left the bank.
  const txs = toDisplayTxs(
    portfolio.transactions.filter((t) => t.assetType !== "cash" && t.time >= from),
    currency,
    toDisplay,
  );

  const prices = new Map(bars.map((b) => [b.t, b.c]));
  const timeline = [...prices.keys()].sort((a, b) => a - b);
  if (timeline.length === 0) return null;

  // A window that opens mid-history starts with money already invested. Without
  // seeding it, the index is handed only the last year's deposits and compared
  // against a portfolio that had a decade's worth working for it.
  const flows = [
    ...(opening > 0 ? [{ t: timeline[0]!, amount: opening }] : []),
    ...[...flowsByBar(txs, barMs).entries()]
      .filter(([t]) => t > timeline[0]!)
      .map(([t, amount]) => ({ t, amount })),
  ];
  if (flows.length === 0) return null;
  const series = simulateFlowsInto(flows, prices, timeline);
  const finalValue = series[series.length - 1]?.value ?? 0;
  const annualPct = moneyWeightedReturn(flows, finalValue, timeline[timeline.length - 1] ?? Date.now());
  return { finalValue, annualPct, series };
}

/** Yahoo takes its own vocabulary for the same idea. */
function yahooRange(range: RangeKey): { range: string; interval: string } {
  switch (range) {
    case "1d": return { range: "1d", interval: "60m" };
    case "1w": return { range: "5d", interval: "60m" };
    case "1m": return { range: "1mo", interval: "1d" };
    case "ytd": return { range: "ytd", interval: "1d" };
    case "1y": return { range: "1y", interval: "1d" };
    case "2y": return { range: "2y", interval: "1d" };
    case "5y": return { range: "5y", interval: "1d" };
    default: return { range: "max", interval: "1wk" };
  }
}

export type History = {
  bars: { t: number; c: number }[];
  range: RangeKey;
  changePct: number | null;
  /** Present only when the price feed failed. */
  error?: string;
};

/**
 * Price history for one holding over the chosen period.
 *
 * It takes a `Store` for one reason: which equity provider to ask is a
 * persisted setting. Nothing else here is read from disk, and no portfolio is
 * involved — a symbol is all it needs.
 */
export async function history(
  store: Store,
  net: Net,
  symbol: string,
  assetType: "crypto" | "equity",
  range: RangeKey,
): Promise<History> {
  try {
    const bars = await cached(
      `hist:${symbol}:${assetType}:${range}:${Math.floor(Date.now() / 900_000)}`,
      900_000,
      async (): Promise<{ t: number; c: number }[]> => {
        if (assetType === "equity") {
          const settings = await store.settings.get();
          const source = makeEquitySource(net, settings.equityProvider, settings.equityApiKey);
          if (!source.history) return [];
          const y = yahooRange(range);
          return source.history(symbol, y.range, y.interval);
        }

        // Crypto only: `pricingPair` cannot tell a coin from a ticker, and
        // would answer ASML.ASUSDT for an equity — a symbol that does not
        // exist, charting the holding as nothing.
        const pair = pricingPair(symbol);
        // "all" here means everything the source will give, not the portfolio's
        // first transaction: this endpoint knows nothing about a portfolio.
        const from = windowStart(range, 0);
        const hourly = range === "1d" || range === "1w";
        if (hourly) {
          const limit = range === "1d" ? 25 : 168;
          const raw = await fetchKlines(net, { symbol: pair, interval: "1h", limit });
          return raw.map((b) => ({ t: b.t, c: b.c }));
        }
        // Daily bars: one page is enough for a year, longer windows paginate.
        if (from === 0 || Date.now() - from > 1000 * DAY_MS) {
          const raw = await fetchKlinesRange(net, {
            symbol: pair, interval: "1d", from: from || Date.parse("2017-01-01"), to: Date.now(),
          });
          return raw.map((b) => ({ t: b.t, c: b.c }));
        }
        const days = Math.ceil((Date.now() - from) / DAY_MS) + 1;
        const raw = await fetchKlines(net, {
          symbol: pair, interval: "1d", limit: Math.min(1000, days),
        });
        return raw.filter((b) => b.t >= from).map((b) => ({ t: b.t, c: b.c }));
      },
    );

    // A day's percentage comes from Binance's own rolling window, not from the
    // bars. The oldest of 25 hourly bars closes at the top of the hour, so a
    // figure derived from it covers 24 to 25 hours depending on when it is
    // asked — 0.58 points adrift on ETHUSDT at 12:35 UTC on 2026-08-25. The
    // bars still draw the line; only the number moved.
    //
    // It matters that this is the same call the header reads: the two figures
    // sit inches apart on the asset page, and agreeing by coincidence is how
    // they came to disagree in the first place.
    if (range === "1d" && assetType === "crypto" && bars.length > 0) {
      const pair = pricingPair(symbol);
      const stat = (await fetchDailyStats(net, [pair]))[pair];
      if (stat) {
        return { bars, range, changePct: ((stat.last - stat.open24h) / stat.open24h) * 100 };
      }
    }

    const first = bars.find((b) => b.c > 0)?.c;
    const last = bars[bars.length - 1]?.c;
    const changePct = first && last ? ((last - first) / first) * 100 : null;
    return { bars, range, changePct };
  } catch (e) {
    return { bars: [], range, changePct: null, error: (e as Error).message };
  }
}

/**
 * The portfolio's cash at each bar, in the display currency.
 *
 * Mirrors `valuation` exactly, and has to: the last point of the drawn line is
 * the figure printed above it, so any difference in how the two count cash
 * shows up as a chart that stops short of its own headline.
 *
 * That includes the awkward part. A currency whose balance is negative is left
 * out rather than allowed to subtract — `valuation` made that call, on the
 * grounds that an impossible balance should not reduce what the portfolio is
 * said to be worth. It hides a real problem, which is why `auditLedger` now
 * reports the same condition in plain words at import; but the chart's job is
 * to agree with the headline, not to disagree with it more accurately.
 */
async function cashOver(
  net: Net,
  transactions: Transaction[],
  times: number[],
  currency: "USD" | "EUR",
): Promise<number[]> {
  if (times.length === 0) return [];
  const balances = cashBalancesOver(transactions, times);
  const currencies = [...new Set(balances.flatMap((b) => Object.keys(b)))];
  if (currencies.length === 0) return times.map(() => 0);

  const rates = await currentCashRates(net, currencies, currency);
  return balances.map((b) =>
    Object.entries(b).reduce((total, [cur, amount]) => {
      const rate = rates.get(cur);
      // Negative balances excluded, as above; an unpriced currency likewise.
      if (rate === undefined || amount <= 0) return total;
      return total + amount * rate;
    }, 0),
  );
}
