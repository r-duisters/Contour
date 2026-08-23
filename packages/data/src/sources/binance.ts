import { cached } from "@/core/cache";
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
  const bucket = Math.floor(opts.to / 900_000); // 15-minute cache buckets
  return cached(`klines:${opts.symbol}:${opts.interval}:${opts.from}:${bucket}`, 900_000, () =>
    fetchKlinesRangeUncached(net, opts),
  );
}

async function fetchKlinesRangeUncached(net: Net, opts: {
  symbol: string;
  interval: Timeframe;
  from: number;
  to: number;
}): Promise<Bar[]> {
  const out: Bar[] = [];
  let cursor = opts.from;
  while (cursor < opts.to) {
    const batch = await fetchKlines(net, {
      symbol: opts.symbol,
      interval: opts.interval,
      startTime: cursor,
      endTime: opts.to,
      limit: 1000,
    });
    if (batch.length === 0) break;
    out.push(...batch);
    const last = batch[batch.length - 1]!.t;
    if (batch.length < 1000) break;
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
