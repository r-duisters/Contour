import { cached } from "@/core/cache";
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

export function fetchEcbRates(
  net: Net, base: string, quote: string, from: number, to: number,
): Promise<Map<number, number>> {
  return cached(`ecb:${base}:${quote}:${ISO(from)}:${ISO(to)}`, 3_600_000, () =>
    fetchEcbRatesUncached(net, base, quote, from, to),
  );
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
