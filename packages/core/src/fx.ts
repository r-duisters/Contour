import { cached } from "./cache";

const DAY_MS = 86_400_000;
const ISO = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * Historical fiat rates from the ECB via frankfurter.app (keyless, data from
 * 1999). Used where Binance has no market for a date — notably EUR trades
 * before EURUSDT listed in late 2020.
 */
export function fetchEcbRates(
  base: string, quote: string, from: number, to: number,
): Promise<Map<number, number>> {
  return cached(`ecb:${base}:${quote}:${ISO(from)}:${ISO(to)}`, 3_600_000, () =>
    fetchEcbRatesUncached(base, quote, from, to),
  );
}

async function fetchEcbRatesUncached(
  base: string,
  quote: string,
  from: number,
  to: number,
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const url =
    `https://api.frankfurter.dev/v1/${ISO(from)}..${ISO(to)}` +
    `?base=${base.toUpperCase()}&symbols=${quote.toUpperCase()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`frankfurter ${res.status}`);
  const data = (await res.json()) as { rates?: Record<string, Record<string, number>> };
  for (const [day, byCurrency] of Object.entries(data.rates ?? {})) {
    const rate = byCurrency[quote.toUpperCase()];
    if (typeof rate === "number") out.set(Date.parse(`${day}T00:00:00Z`), rate);
  }
  return out;
}

/** Latest EUR->USD rate, for display conversion when no live crypto rate is at hand. */
export function fetchLatestEurUsd(): Promise<number | null> {
  return cached("eurusd-latest", 3_600_000, fetchLatestEurUsdUncached);
}

async function fetchLatestEurUsdUncached(): Promise<number | null> {
  try {
    const res = await fetch("https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD");
    if (!res.ok) return null;
    const data = (await res.json()) as { rates?: { USD?: number } };
    return data.rates?.USD ?? null;
  } catch {
    return null;
  }
}

/** Nearest rate at or before `time`, tolerating weekend/holiday gaps. */
export function rateOn(rates: Map<number, number>, time: number, maxLookbackDays = 5): number | null {
  const day = Math.floor(time / DAY_MS) * DAY_MS;
  for (let d = 0; d <= maxLookbackDays; d++) {
    const r = rates.get(day - d * DAY_MS);
    if (r !== undefined) return r;
  }
  return null;
}
