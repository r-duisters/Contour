import { cached, peek, put } from "@/core/cache";
import type { Net } from "../ports/net";

/**
 * Frankfurter/ECB rates, reached through an injected `Net` — both the dated
 * series and the latest EUR->USD spot, so the whole of this transport lives in
 * one place rather than half here and half in the pricing service.
 *
 * The `fetch`-based original in `packages/core/src/fx.ts` is gone; only its
 * pure `rateOn` stayed behind. The cache key is the one that original used —
 * see the note in `sources/binance.ts` about caching in front of a `Net`.
 */
const ISO = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * A published ECB rate never changes, so the whole multi-year series was the
 * wrong thing to refetch every hour. One long-lived entry per pair instead,
 * widening when a caller wants earlier days; a warm call fetches only from
 * the last held day forward — a request for a handful of rows. Same shape and
 * reasons as the klines store in `sources/binance.ts`: freshness lives in the
 * value (`freshAt`, an hour, what the old TTL was), and the entry's own TTL
 * only retires pairs nobody asks about.
 */
const FX_FRESH_MS = 3_600_000;
const FX_STORE_TTL_MS = 30 * 86_400_000;

/**
 * `[from, until]` is what the rates cover, `until` being the `to` of the
 * fetch that produced them. A request wholly inside it costs no network — a
 * published rate never changes — and a request past `until` fetches only the
 * missing days, unless `until` is under an hour old (the old TTL) in which
 * case the entry answers as it stands.
 */
type HeldRates = { from: number; until: number; rates: Map<number, number> };

const inflightFx = new Map<string, Promise<void>>();

function coversRates(held: HeldRates, from: number, to: number): boolean {
  return held.from <= from && (to <= held.until || Date.now() - held.until < FX_FRESH_MS);
}

export async function fetchEcbRates(
  net: Net, base: string, quote: string, from: number, to: number,
): Promise<Map<number, number>> {
  const key = `fxstore:${base.toUpperCase()}:${quote.toUpperCase()}`;
  const slice = (held: HeldRates) =>
    new Map([...held.rates].filter(([t]) => t >= from && t <= to));

  // The same loop as the klines store: a concurrent refresh may cover less
  // than this caller needs, so coverage is re-checked after awaiting it.
  for (;;) {
    const held = peek<HeldRates>(key);
    if (held && coversRates(held, from, to)) return slice(held);
    let pending = inflightFx.get(key);
    if (!pending) {
      pending = refreshRates(net, key, base, quote, from, to).finally(() => inflightFx.delete(key));
      inflightFx.set(key, pending);
    }
    await pending;
    const after = peek<HeldRates>(key);
    if (after && coversRates(after, from, to)) return slice(after);
  }
}

async function refreshRates(
  net: Net, key: string, base: string, quote: string, from: number, to: number,
): Promise<void> {
  const held = peek<HeldRates>(key);
  const lastDay = held && held.rates.size > 0 ? Math.max(...held.rates.keys()) : null;

  if (held && lastDay !== null && held.from <= from) {
    // Covered on the left: only the days since the last held rate are asked
    // for. Weekends and holidays publish nothing, so the tail may well come
    // back empty — that is an answer, and `until` records it was given.
    const wantedTo = Math.max(to, held.until);
    const tail = await fetchEcbRatesUncached(net, base, quote, lastDay, wantedTo);
    const rates = new Map([...held.rates, ...tail]);
    put(key, { from: held.from, until: wantedTo, rates }, FX_STORE_TTL_MS);
    return;
  }

  const wantedFrom = Math.min(from, held?.from ?? from);
  const wantedTo = Math.max(to, held?.until ?? to);
  const fetched = await fetchEcbRatesUncached(net, base, quote, wantedFrom, wantedTo);
  const rates = held ? new Map([...held.rates, ...fetched]) : fetched;
  put(key, { from: wantedFrom, until: wantedTo, rates }, FX_STORE_TTL_MS);
}

async function fetchEcbRatesUncached(
  net: Net,
  base: string,
  quote: string,
  from: number,
  to: number,
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const url =
    `https://api.frankfurter.dev/v1/${ISO(from)}..${ISO(to)}` +
    `?base=${base.toUpperCase()}&symbols=${quote.toUpperCase()}`;
  // A non-2xx throws, as the original's `if (!res.ok) throw` did: every caller
  // wraps this in a catch and answers with "no rate", which is not the same
  // answer as an empty map.
  const data = await net.json<{ rates?: Record<string, Record<string, number>> }>(url);
  for (const [day, byCurrency] of Object.entries(data.rates ?? {})) {
    const rate = byCurrency[quote.toUpperCase()];
    if (typeof rate === "number") out.set(Date.parse(`${day}T00:00:00Z`), rate);
  }
  return out;
}

/**
 * Latest rate for one unit of `currency` in USD, or null if the lookup failed
 * for any reason. The original `fetchLatestEurUsdUncached` wrapped its whole
 * body in try/catch, so a non-2xx, a JSON-parse error and a transport
 * exception (host unreachable, DNS failure) were all `null` to the caller —
 * none of the six routes it fed ever distinguished them, and `insights` still
 * doesn't. `net.request()` only turns the first of those into a value; the
 * other two still throw (that split is the whole reason `request()` exists —
 * see `packages/data/src/ports/net.ts`), so the try/catch here is what
 * restores the old all-failures-are-null behaviour on top of it.
 *
 * It took a `currency` argument when the display currency stopped being a
 * choice between two. For EUR it issues exactly the URL its EUR-only
 * predecessor did.
 *
 * The cache is not only about round trips. `cached()` also collapses
 * *concurrent* callers of one key onto a single in-flight promise, and the
 * portfolio page fires `valuation` and `series` together, each of which
 * resolves its own display context. Without the shared entry the value panel
 * and the history chart could be converted at two different rates within one
 * render.
 */
export function fetchLatestUsdPer(net: Net, currency: string): Promise<number | null> {
  const c = currency.toUpperCase();
  if (c === "USD") return Promise.resolve(1);
  return cached(`usd-per:${c}`, 3_600_000, () => fetchLatestUsdPerUncached(net, c));
}

async function fetchLatestUsdPerUncached(net: Net, currency: string): Promise<number | null> {
  try {
    const res = await net.request(
      `https://api.frankfurter.dev/v1/latest?base=${currency}&symbols=USD`,
    );
    if (!res.ok) return null;
    const data = await res.json<{ rates?: { USD?: number } }>();
    return data.rates?.USD ?? null;
  } catch {
    return null;
  }
}
