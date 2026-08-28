import { cached } from "@/core/cache";
import { QUOTE_ASSETS } from "@/core/symbols";
import type { Bar, Timeframe } from "@/core/types";
import type { Net } from "../ports/net";

/**
 * Binance's public REST surface, and the only copy of it — the `fetch`-based
 * original in `packages/core/src/binance.ts` was deleted once every caller,
 * `candles` / `risk` / `backtest` / the alert evaluator included, was passing a
 * `Net` from `@/lib/deps`.
 *
 * ## The shared cache, and the trap it sets
 *
 * These functions memoise through `packages/core/src/cache.ts`, one
 * process-local map shared with everything else that caches. The keys are
 * unchanged from core's copy, so the deletion cost no warm entries.
 *
 * The cost of caching at all is that a hit answers before the `Net` is ever
 * consulted, so the injected transport is bypassed entirely. Harmless in
 * production, where the alternative was fetching the same bytes again.
 *
 * **In a test it is a live trap.** A `FakeNet` proves nothing if a real value
 * left over from another test satisfies the call first, and the test still
 * passes. Every suite exercising these must call `invalidate()` from
 * `@/core/cache` in `beforeEach`; `services/valuation.test.ts` and
 * `services/pricing.test.ts` both do. Adding a suite that touches `sources/`
 * without that is how a green test starts meaning nothing.
 */
const REST = "https://api.binance.com";

type RawKline = [
  number, string, string, string, string, string,
  number, string, number, string, string, string,
];

function toBar(k: RawKline): Bar {
  return {
    t: k[0],
    o: Number(k[1]),
    h: Number(k[2]),
    l: Number(k[3]),
    c: Number(k[4]),
    v: Number(k[5]),
  };
}

export async function fetchKlines(net: Net, opts: {
  symbol: string;
  interval: Timeframe;
  startTime?: number;
  endTime?: number;
  limit?: number; // max 1000
}): Promise<Bar[]> {
  const params = new URLSearchParams({
    symbol: opts.symbol.toUpperCase(),
    interval: opts.interval,
    limit: String(opts.limit ?? 1000),
  });
  if (opts.startTime) params.set("startTime", String(opts.startTime));
  if (opts.endTime) params.set("endTime", String(opts.endTime));

  const raw = await net.json<RawKline[]>(`${REST}/api/v3/klines?${params}`);
  return raw.map(toBar);
}

/** Paginated fetch covering [from, to] in ms. Cached: daily history barely moves. */
export function fetchKlinesRange(net: Net, opts: {
  symbol: string;
  interval: Timeframe;
  from: number;
  to: number;
}): Promise<Bar[]> {
  /*
   * No time bucket in the key. The TTL already says how long this is good
   * for, and putting the same fact in the key as well is what stopped a cold
   * start ever reusing anything: the entry survived the restart and was not
   * expired, but fifteen minutes later it was looked up under a different
   * name. Freshness expressed twice, and the key's copy defeated the cache
   * the TTL was keeping alive.
   */
  return cached(`klines:${opts.symbol}:${opts.interval}:${opts.from}`, 900_000, () =>
    fetchKlinesRangeUncached(net, opts),
  );
}

/**
 * How long one bar lasts, for the intervals whose length is fixed.
 *
 * `1M` is absent on purpose: a month is 28 to 31 days, so a page of them
 * cannot be placed arithmetically. Anything not here falls back to walking the
 * cursor, which is always correct and merely slower.
 */
const BAR_MS: Partial<Record<Timeframe, number>> = {
  "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
  "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "6h": 21_600_000,
  "8h": 28_800_000, "12h": 43_200_000,
  "1d": 86_400_000, "3d": 259_200_000, "1w": 604_800_000,
};

const PAGE = 1000;

async function fetchKlinesRangeUncached(net: Net, opts: {
  symbol: string;
  interval: Timeframe;
  from: number;
  to: number;
}): Promise<Bar[]> {
  const barMs = BAR_MS[opts.interval];
  const span = opts.to - opts.from;

  /*
   * Ask for the pages at once when their boundaries can be computed.
   *
   * The cursor loop below is correct and sequential: each page is awaited
   * before the next is requested, so five years of daily bars is four round
   * trips in series — 1,472ms on a desktop and most of the four to five
   * seconds a phone saw, where every trip pays mobile latency (#50).
   *
   * For a fixed-length interval the windows need no cursor: page `i` starts at
   * `from + i * PAGE * barMs`. Binance weights a 1000-bar klines request at 5
   * against a 6,000-per-minute budget, so four at once is 20 — the concurrency
   * is not what a rate limit is for. Pages are merged by open time rather than
   * concatenated, because a gap (a coin that had not listed yet) means a page
   * can come back short or empty without being the end of the data.
   */
  if (barMs !== undefined && span > PAGE * barMs) {
    const pages = Math.ceil(span / (PAGE * barMs));
    const batches = await Promise.all(
      Array.from({ length: pages }, (_, i) => {
        const start = opts.from + i * PAGE * barMs;
        return fetchKlines(net, {
          symbol: opts.symbol,
          interval: opts.interval,
          startTime: start,
          endTime: Math.min(opts.to, start + PAGE * barMs - 1),
          limit: PAGE,
        });
      }),
    );
    const byTime = new Map<number, Bar>();
    for (const batch of batches) for (const bar of batch) byTime.set(bar.t, bar);
    return [...byTime.values()].sort((a, b) => a.t - b.t);
  }

  const out: Bar[] = [];
  let cursor = opts.from;
  while (cursor < opts.to) {
    const batch = await fetchKlines(net, {
      symbol: opts.symbol,
      interval: opts.interval,
      startTime: cursor,
      endTime: opts.to,
      limit: PAGE,
    });
    if (batch.length === 0) break;
    out.push(...batch);
    const last = batch[batch.length - 1]!.t;
    if (batch.length < PAGE) break;
    cursor = last + 1;
  }
  return out;
}

/**
 * Every USDT spot pair Binance currently trades. The importer uses it to tell a
 * coin from an equity ticker, and the payload is ~2MB, so it is cached for an
 * hour under "usdt-symbols".
 */
export function fetchUsdtSymbols(net: Net): Promise<string[]> {
  return cached("usdt-symbols", 3_600_000, () => fetchUsdtSymbolsUncached(net));
}

async function fetchUsdtSymbolsUncached(net: Net): Promise<string[]> {
  const raw = await net.json<{
    symbols: { symbol: string; status: string; quoteAsset: string; isSpotTradingAllowed: boolean }[];
  }>(`${REST}/api/v3/exchangeInfo`);
  return raw.symbols
    .filter((s) => s.status === "TRADING" && s.quoteAsset === "USDT" && s.isSpotTradingAllowed)
    .map((s) => s.symbol)
    .sort();
}

/**
 * Quote assets Binance lists this base against — ETH -> ["USDT", "EUR", "BTC"].
 *
 * Filtered to `QUOTE_ASSETS` so the form never offers a pair the rest of the
 * app cannot read back: `assetOf` strips a known quote to recover the asset,
 * and one it does not know would make ETHNGN parse as the asset ETHN.
 *
 * USDT leads because it is what a price usually means; the rest keep
 * `exchangeInfo`'s order, which is stable.
 */
export function fetchQuotesFor(net: Net, base: string): Promise<string[]> {
  const b = base.toUpperCase();
  return cached(`quotes:${b}`, 3_600_000, async () => {
    const raw = await net.json<{
      symbols: {
        baseAsset: string; quoteAsset: string; status: string; isSpotTradingAllowed: boolean;
      }[];
    }>(`${REST}/api/v3/exchangeInfo`);
    const known = new Set<string>(QUOTE_ASSETS);
    const found = raw.symbols
      .filter((s) => s.baseAsset === b && s.status === "TRADING" && s.isSpotTradingAllowed)
      .map((s) => s.quoteAsset)
      .filter((q) => known.has(q));
    return [...new Set(found)].sort((x, y) => (x === "USDT" ? -1 : y === "USDT" ? 1 : 0));
  });
}

/** Current spot prices for the given symbols, as symbol -> price. Unknown symbols are omitted. */
export async function fetchPrices(net: Net, symbols: string[]): Promise<Record<string, number>> {
  if (symbols.length === 0) return {};
  const params = new URLSearchParams({
    symbols: JSON.stringify(symbols.map((s) => s.toUpperCase())),
  });
  const raw = await net.json<{ symbol: string; price: string }[]>(
    `${REST}/api/v3/ticker/price?${params}`,
  );
  return Object.fromEntries(raw.map((r) => [r.symbol, Number(r.price)]));
}

/** Like fetchPrices, but tolerant: one bad symbol 400s the whole batch, so fall back to per-symbol lookups. */
export function fetchPricesSafe(net: Net, symbols: string[]): Promise<Record<string, number>> {
  if (symbols.length === 0) return Promise.resolve({});
  return cached(`prices:${[...symbols].sort().join(",")}`, 30_000, () =>
    fetchPricesSafeUncached(net, symbols),
  );
}

async function fetchPricesSafeUncached(net: Net, symbols: string[]): Promise<Record<string, number>> {
  try {
    return await fetchPrices(net, symbols);
  } catch {
    const out: Record<string, number> = {};
    const results = await Promise.allSettled(symbols.map((s) => fetchPrices(net, [s])));
    for (const r of results) {
      if (r.status === "fulfilled") Object.assign(out, r.value);
    }
    return out;
  }
}

/** What a pair costs now, and what it cost exactly twenty-four hours ago. */
export type DailyStat = { last: number; open24h: number };

/**
 * Rolling 24-hour open and last price for named pairs, in one request.
 *
 * `openPrice` is Binance's own rolling-window open, accurate to the second.
 * What this replaced read 25 hourly klines and took the oldest bar's close —
 * but a bar close is hour-aligned, so that window ran anywhere from 24 to 25
 * hours depending on when it was asked. Measured on ETHUSDT at 12:35 UTC on
 * 2026-08-25, the two disagreed by 0.58 percentage points: −1.088% against
 * −1.672%.
 *
 * `type=MINI` drops the fields nobody here reads. Roughly 293 bytes a symbol
 * against 4,439 for a klines call, and one request instead of one per symbol —
 * for the twenty-three crypto symbols in the live ledger, 6.7 KB and one
 * request against 102 KB and twenty-three.
 *
 * Distinct from `fetch24hTicker` below, which pulls every spot pair (~1MB) for
 * the movers board. Asking that for three symbols would be a megabyte to
 * answer a question worth a kilobyte.
 *
 * Cached for five minutes, matching the basis it replaces: the figure moves
 * slowly and every screen that shows a day change asks for it.
 */
export function fetchDailyStats(net: Net, pairs: string[]): Promise<Record<string, DailyStat>> {
  if (pairs.length === 0) return Promise.resolve({});
  const symbols = pairs.map((s) => s.toUpperCase());
  return cached(
    `daily:${[...symbols].sort().join(",")}:${Math.floor(Date.now() / 300_000)}`,
    300_000,
    () => fetchDailyStatsTolerant(net, symbols),
  );
}

/**
 * Tolerant, for the same reason `fetchPricesSafe` is: Binance rejects the
 * whole request with `{"code":-1121,"msg":"Invalid symbol."}` if one symbol is
 * unknown to it, and a real ledger carries coins that have since been
 * delisted. One of those must not cost the others their prices.
 *
 * Found by running against the live ledger — every unit test passed with a
 * fake that answered whatever it was asked.
 */
async function fetchDailyStatsTolerant(
  net: Net,
  symbols: string[],
): Promise<Record<string, DailyStat>> {
  try {
    return await fetchDailyStatsBatch(net, symbols);
  } catch {
    const out: Record<string, DailyStat> = {};
    const results = await Promise.allSettled(
      symbols.map((s) => fetchDailyStatsBatch(net, [s])),
    );
    for (const r of results) if (r.status === "fulfilled") Object.assign(out, r.value);
    return out;
  }
}

async function fetchDailyStatsBatch(
  net: Net,
  symbols: string[],
): Promise<Record<string, DailyStat>> {
  const params = new URLSearchParams({ symbols: JSON.stringify(symbols), type: "MINI" });
  const raw = await net.json<{ symbol: string; openPrice: string; lastPrice: string }[]>(
    `${REST}/api/v3/ticker/24hr?${params}`,
  );
  const out: Record<string, DailyStat> = {};
  for (const r of raw) {
    const open24h = Number(r.openPrice);
    const last = Number(r.lastPrice);
    // A zero or unparseable open divides by zero downstream. Absent lets the
    // caller show no change, which is what every price path here does.
    if (!(open24h > 0) || !Number.isFinite(last)) continue;
    out[r.symbol] = { last, open24h };
  }
  return out;
}

/** One pair's rolling 24-hour statistics, with Binance's strings coerced to numbers. */
export type Ticker = {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  quoteVolume: number;
};

/**
 * Rolling 24-hour statistics for every spot pair — around 3,000 rows and
 * ~1MB, which is why the Markets board takes one of these rather than a price
 * lookup per coin.
 *
 * A minute: the movers board is a browsing surface, not a trading one, and a
 * shorter window would refetch a megabyte on every category toggle.
 */
export function fetch24hTicker(net: Net): Promise<Ticker[]> {
  return cached("binance:ticker24h", 60_000, async () => {
    const raw = await net.json<{
      symbol: string;
      lastPrice: string;
      priceChangePercent: string;
      quoteVolume: string;
    }[]>(`${REST}/api/v3/ticker/24hr`);
    return raw.map((r) => ({
      symbol: r.symbol,
      lastPrice: Number(r.lastPrice),
      priceChangePercent: Number(r.priceChangePercent),
      quoteVolume: Number(r.quoteVolume),
    }));
  });
}
