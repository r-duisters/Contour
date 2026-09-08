import { cached, invalidate, peek, put } from "@/core/cache";
import { QUOTE_ASSETS } from "@/core/symbols";
import type { Bar, Timeframe } from "@/core/types";
import { NetError, type Net } from "../ports/net";

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

/**
 * Binance's public market-data host, and the way around a blocked network.
 *
 * `api.binance.com` refuses whole IP addresses — geo-restriction (451), WAF
 * blocks (403), and rate-limit bans (418/429) earned collectively by everyone
 * behind a hotel or office NAT. Observed 2026-09-08 from a hotel: every price
 * on every screen quietly stopped, which is issue #23. `data-api.binance.vision`
 * is Binance's own host for exactly this data — verified identical for every
 * endpoint this file calls, payloads and error codes included — and, being a
 * different domain, it also survives networks that block `binance.com` in DNS.
 *
 * So every request goes through `binanceJson`: the primary first, and on a
 * refusal that means "this network" rather than "this request", the same path
 * on the fallback. A host that answered is remembered for ten minutes through
 * the shared cache — `peek`/`put` rather than a module variable, so tests
 * reset it with the `invalidate()` they already call, and the persisted copy
 * carries a hotel stay across an app restart. When *both* hosts refuse, the
 * refusal is recorded the same way for `binanceRefusal()` below.
 */
const FALLBACK = "https://data-api.binance.vision";
const HOST_STICKY_MS = 600_000;
const REFUSAL_TTL_MS = 120_000;

/** A refusal of the network or IP, as opposed to a request that is wrong. */
function refusesNetwork(e: unknown): e is NetError {
  if (!(e instanceof NetError)) return false;
  if (e.kind === "unreachable") return true;
  return e.status === 403 || e.status === 418 || e.status === 429 || e.status === 451;
}

/**
 * The last time both hosts refused, if it was recent — for the valuation to
 * say "this network refuses prices" instead of quietly excluding holdings.
 * Null once anything succeeds, or after two minutes without a retry.
 */
export function binanceRefusal(): { status?: number; at: number } | null {
  return peek<{ status?: number; at: number }>("binance:refusal") ?? null;
}

async function binanceJson<T>(net: Net, path: string): Promise<T> {
  const sticky = peek<string>("binance:host");
  const first = sticky ?? REST;
  const second = first === REST ? FALLBACK : REST;
  try {
    const out = await net.json<T>(`${first}${path}`);
    invalidate("binance:refusal");
    return out;
  } catch (e) {
    if (!refusesNetwork(e)) throw e;
    try {
      const out = await net.json<T>(`${second}${path}`);
      put("binance:host", second, HOST_STICKY_MS);
      invalidate("binance:refusal");
      return out;
    } catch (e2) {
      if (refusesNetwork(e2)) {
        put("binance:refusal", { status: e2.status, at: Date.now() }, REFUSAL_TTL_MS);
      }
      throw e2;
    }
  }
}

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

  const raw = await binanceJson<RawKline[]>(net, `/api/v3/klines?${params}`);
  return raw.map(toBar);
}

/**
 * Paginated fetch covering [from, to] in ms — and the reason it is cheap to
 * call again.
 *
 * A closed bar never changes, so re-downloading five years of daily closes
 * every fifteen minutes was paying for immutable data on a schedule. This
 * keeps one long-lived entry per (symbol, interval) — every history this pair
 * has ever been asked for, widening when a caller wants earlier bars — and on
 * a warm call fetches only from the last held bar forward: one small request
 * that re-reads the still-forming bar and appends what closed since.
 *
 * `freshAt` is the freshness rule, kept inside the value rather than as the
 * entry's TTL, because expiry would throw the immutable bars away with the
 * staleness. The TTL is long instead: it exists so a pair nobody asks about
 * eventually leaves the persisted cache, not to say when the data is stale.
 *
 * The predecessor's lesson still applies (no time bucket in the key — the TTL
 * key'd freshness twice and a restart could never reuse anything); here the
 * key carries no `from` either, so 1M and All stop being different entries.
 */
const KLINES_FRESH_MS = 900_000;
const KLINES_STORE_TTL_MS = 30 * 86_400_000;

/**
 * `[from, until]` is what the bars cover: `until` is the `to` of the fetch
 * that produced them, so a request wholly inside it needs no network at all —
 * a closed bar cannot have changed. Only a request past `until` asks how old
 * the entry is, and then only the tail is fetched.
 */
type HeldKlines = { from: number; until: number; bars: Bar[] };

const inflightKlines = new Map<string, Promise<void>>();

function coversKlines(held: HeldKlines, from: number, to: number): boolean {
  return held.from <= from && (to <= held.until || Date.now() - held.until < KLINES_FRESH_MS);
}

export async function fetchKlinesRange(net: Net, opts: {
  symbol: string;
  interval: Timeframe;
  from: number;
  to: number;
}): Promise<Bar[]> {
  const key = `klinestore:${opts.symbol.toUpperCase()}:${opts.interval}`;
  const slice = (held: HeldKlines) => held.bars.filter((b) => b.t >= opts.from && b.t <= opts.to);

  // Loops because a concurrent refresh may have been for a narrower window
  // than this caller wants: await it, re-check coverage, and only then start
  // one of our own. A refresh that throws propagates, so this cannot spin.
  for (;;) {
    const held = peek<HeldKlines>(key);
    if (held && coversKlines(held, opts.from, opts.to)) return slice(held);
    let pending = inflightKlines.get(key);
    if (!pending) {
      pending = refreshKlines(net, key, opts).finally(() => inflightKlines.delete(key));
      inflightKlines.set(key, pending);
    }
    await pending;
    const after = peek<HeldKlines>(key);
    if (after && coversKlines(after, opts.from, opts.to)) return slice(after);
  }
}

async function refreshKlines(net: Net, key: string, opts: {
  symbol: string;
  interval: Timeframe;
  from: number;
  to: number;
}): Promise<void> {
  const held = peek<HeldKlines>(key);
  const last = held?.bars[held.bars.length - 1];

  if (held && last && held.from <= opts.from) {
    // Covered on the left but stale on the right: fetch from the last held
    // bar's open, inclusive, so the bar that was still forming when it was
    // stored is replaced by its current state rather than kept at a close it
    // never had.
    const to = Math.max(opts.to, held.until);
    const tail = await fetchKlinesRangeUncached(net, {
      symbol: opts.symbol, interval: opts.interval, from: last.t, to,
    });
    const cut = tail[0]?.t ?? Number.POSITIVE_INFINITY;
    const bars = [...held.bars.filter((b) => b.t < cut), ...tail];
    put(key, { from: held.from, until: to, bars }, KLINES_STORE_TTL_MS);
    return;
  }

  // Nothing held, or the caller wants earlier bars than the entry covers:
  // fetch the whole widened window once. This is the only path that pages,
  // and it runs at most once per widening, never on a schedule.
  const from = Math.min(opts.from, held?.from ?? opts.from);
  const to = Math.max(opts.to, held?.until ?? opts.to);
  const bars = await fetchKlinesRangeUncached(net, {
    symbol: opts.symbol, interval: opts.interval, from, to,
  });
  put(key, { from, until: to, bars }, KLINES_STORE_TTL_MS);
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
  const raw = await binanceJson<{
    symbols: { symbol: string; status: string; quoteAsset: string; isSpotTradingAllowed: boolean }[];
  }>(net, `/api/v3/exchangeInfo`);
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
    const raw = await binanceJson<{
      symbols: {
        baseAsset: string; quoteAsset: string; status: string; isSpotTradingAllowed: boolean;
      }[];
    }>(net, `/api/v3/exchangeInfo`);
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
  const raw = await binanceJson<{ symbol: string; price: string }[]>(net, `/api/v3/ticker/price?${params}`);
  return Object.fromEntries(raw.map((r) => [r.symbol, Number(r.price)]));
}

/**
 * Every spot price Binance publishes, in one request that asks for nothing in
 * particular.
 *
 * The point is the request, not the response. `ticker/price?symbols=[…]` names
 * the exact set of coins somebody holds, to a company that keeps the log; this
 * one names none of them, because it names nothing. Measured on 2026-08-30:
 * 26 KB gzipped against 150 bytes for a portfolio of eight, and the same
 * latency to the millisecond — the cost is bytes, not waiting.
 *
 * One cache key for the whole board, so a valuation, an alert check and a
 * second screen inside the window share the one answer rather than each
 * paying 26 KB. The keyed-by-symbols cache below cannot do that: two callers
 * wanting overlapping sets miss each other entirely.
 */
export function fetchAllPrices(net: Net): Promise<Record<string, number>> {
  return cached("prices:all", 30_000, async () => {
    const raw = await binanceJson<{ symbol: string; price: string }[]>(net, `/api/v3/ticker/price`);
    return Object.fromEntries(raw.map((r) => [r.symbol, Number(r.price)]));
  });
}

/**
 * Like fetchPrices, but tolerant: one bad symbol 400s the whole batch, so fall
 * back to per-symbol lookups.
 *
 * `everything` asks for the whole board instead and picks the answer out of
 * it — same result, 26 KB, and Binance learns nothing. It is a parameter
 * rather than a mode because the two paths must be able to run in one process:
 * the setting is per install, and this module is shared with a server that has
 * many.
 */
export function fetchPricesSafe(
  net: Net, symbols: string[], everything = false,
): Promise<Record<string, number>> {
  if (symbols.length === 0) return Promise.resolve({});
  if (everything) return fetchAllPrices(net).then((all) => pick(all, symbols));
  return cached(`prices:${[...symbols].sort().join(",")}`, 30_000, () =>
    fetchPricesSafeUncached(net, symbols),
  );
}

/** The requested symbols, out of a whole-board answer. Unknown ones stay absent. */
function pick<T>(all: Record<string, T>, symbols: string[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const s of symbols) {
    const v = all[s.toUpperCase()];
    if (v !== undefined) out[s.toUpperCase()] = v;
  }
  return out;
}

async function fetchPricesSafeUncached(net: Net, symbols: string[]): Promise<Record<string, number>> {
  try {
    return await fetchPrices(net, symbols);
  } catch (e) {
    return singlesUntilHopeless(symbols, (s) => fetchPrices(net, [s]), e);
  }
}

/**
 * The per-symbol fallback, with a stop for the case it cannot fix.
 *
 * The fallback exists for one bad symbol in the batch. When the *network* is
 * what failed — both hosts refusing, issue #23 — every single fails the same
 * way, and pressing on turns one blocked request into dozens. That is not
 * just waste: Binance's 418 ban escalates for traffic that keeps arriving, so
 * the retries lengthen the ban that caused them. Two matching failures, not
 * one, so a genuinely delisted symbol at the front of the list cannot mask a
 * feed that works.
 *
 * Sequential where it used to fan out, for the same reason: an early stop is
 * only possible for requests that have not been sent yet.
 */
async function singlesUntilHopeless<T>(
  symbols: string[],
  fetchOne: (symbol: string) => Promise<Record<string, T>>,
  batchError: unknown,
): Promise<Record<string, T>> {
  const batchStatus = batchError instanceof NetError ? batchError.status : undefined;
  const out: Record<string, T> = {};
  let matching = 0;
  for (const symbol of symbols) {
    try {
      Object.assign(out, await fetchOne(symbol));
    } catch (e) {
      const status = e instanceof NetError ? e.status : undefined;
      const sameAsBatch = status === batchStatus &&
        (refusesNetwork(e) || refusesNetwork(batchError));
      if (sameAsBatch && ++matching >= 2) break;
    }
  }
  return out;
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
export function fetchDailyStats(
  net: Net, pairs: string[], everything = false,
): Promise<Record<string, DailyStat>> {
  if (pairs.length === 0) return Promise.resolve({});
  const symbols = pairs.map((s) => s.toUpperCase());
  // The whole board, for the same reason as `fetchPricesSafe` — and here it is
  // the request the app already makes for the movers page, so an install with
  // the setting on and Markets open pays for it once.
  if (everything) return fetchAllDailyStats(net).then((all) => pick(all, symbols));
  return cached(
    `daily:${[...symbols].sort().join(",")}:${Math.floor(Date.now() / 300_000)}`,
    300_000,
    () => fetchDailyStatsTolerant(net, symbols),
  );
}

/**
 * The 24-hour open and last for every pair, in one request that names none.
 *
 * Its own function rather than a mapping over `fetch24hTicker`, which returns
 * `lastPrice` and `priceChangePercent` and no open at all. The open could be
 * recovered from those two — `last / (1 + pct/100)` — and that is arithmetic
 * standing in for a number the endpoint already reports. This asks for the
 * reported one.
 *
 * Five minutes, matching `fetchDailyStats`, and one key for everybody.
 */
export function fetchAllDailyStats(net: Net): Promise<Record<string, DailyStat>> {
  return cached("daily:all", 300_000, async () => {
    const raw = await binanceJson<{ symbol: string; openPrice: string; lastPrice: string }[]>(net, `/api/v3/ticker/24hr`);
    const out: Record<string, DailyStat> = {};
    for (const r of raw) {
      const open24h = Number(r.openPrice);
      const last = Number(r.lastPrice);
      if (!(open24h > 0) || !Number.isFinite(last)) continue;
      out[r.symbol] = { last, open24h };
    }
    return out;
  });
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
  } catch (e) {
    // Same stop as `fetchPricesSafeUncached`: a blocked network fails every
    // single the same way, and retrying extends the ban doing the blocking.
    return singlesUntilHopeless(symbols, (s) => fetchDailyStatsBatch(net, [s]), e);
  }
}

async function fetchDailyStatsBatch(
  net: Net,
  symbols: string[],
): Promise<Record<string, DailyStat>> {
  const params = new URLSearchParams({ symbols: JSON.stringify(symbols), type: "MINI" });
  const raw = await binanceJson<{ symbol: string; openPrice: string; lastPrice: string }[]>(net, `/api/v3/ticker/24hr?${params}`);
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
    const raw = await binanceJson<{
      symbol: string;
      lastPrice: string;
      priceChangePercent: string;
      quoteVolume: string;
    }[]>(net, `/api/v3/ticker/24hr`);
    return raw.map((r) => ({
      symbol: r.symbol,
      lastPrice: Number(r.lastPrice),
      priceChangePercent: Number(r.priceChangePercent),
      quoteVolume: Number(r.quoteVolume),
    }));
  });
}
