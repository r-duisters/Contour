import { cached } from "@/core/cache";
import type { Net } from "../ports/net";

/**
 * Frankfurter/ECB rates, reached through an injected `Net` — both the dated
 * series and the latest EUR->USD spot, so the whole of this transport lives in
 * one place rather than half here and half in the pricing service.
 *
 * The `packages/core/src/fx.ts` original stays for the routes that keep inline
 * logic; see the note in `sources/binance.ts` for why both exist and why they
 * share a cache key.
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
 * Latest EUR->USD rate, or null if the lookup failed for any reason. The
 * original `fx.ts#fetchLatestEurUsdUncached` wrapped its whole body in
 * try/catch, so a non-2xx, a JSON-parse error and a transport exception
 * (host unreachable, DNS failure) were all `null` to the caller — none of the
 * six routes it fed ever distinguished them, and `insights` still doesn't.
 * `net.request()` only turns the first of those into a value; the other two
 * still throw (that split is the whole reason `request()` exists — see
 * `packages/data/src/ports/net.ts`), so the try/catch here is what restores
 * the old all-failures-are-null behaviour on top of it.
 */
export async function fetchLatestEurUsd(net: Net): Promise<number | null> {
  try {
    const res = await net.request("https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD");
    if (!res.ok) return null;
    const data = await res.json<{ rates?: { USD?: number } }>();
    return data.rates?.USD ?? null;
  } catch {
    return null;
  }
}
