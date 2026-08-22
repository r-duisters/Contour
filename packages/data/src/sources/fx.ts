import { cached } from "@/core/cache";
import type { Net } from "../ports/net";

/**
 * Historical fiat rates from the ECB via frankfurter.app (keyless, data from
 * 1999), reached through an injected `Net`. The `packages/core/src/fx.ts`
 * original stays for the routes that keep inline logic; see the note in
 * `sources/binance.ts` for why both exist and why they share a cache key.
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
