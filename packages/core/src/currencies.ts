/**
 * What a currency is, for the purpose of turning a price into USD.
 *
 * Two questions, and only two: does this already equal a dollar, and if not,
 * where does the rate come from. Three overlapping copies of the answer used
 * to live in `delta-csv.ts` and `transfer.ts`; the importer and the manual
 * entry form now read the same one, because a trade typed by hand and the
 * same trade imported must price identically.
 */

/** Quotes already worth one USD, so a price in them is already a USD price. */
export const STABLES: ReadonlySet<string> = new Set([
  "USD", "USDT", "USDC", "BUSD", "DAI", "FDUSD", "TUSD",
]);

/** Currencies the ECB publishes a reference rate for. */
export const FIAT: ReadonlySet<string> = new Set([
  "EUR", "GBP", "CHF", "JPY", "AUD", "CAD", "SEK", "NOK", "DKK", "PLN",
]);

/**
 * True when a figure in this currency has to be converted before the rest of
 * the app can treat it as dollars.
 *
 * A coin quote (BTC, ETH) answers true and is not in `FIAT`: its rate comes
 * from Binance rather than the ECB, and the caller decides which to ask.
 */
export function needsRate(currency: string): boolean {
  return !STABLES.has(currency.toUpperCase());
}

/**
 * Fiat, including the one the ECB quotes *against*.
 *
 * `FIAT` is "currencies with an ECB reference rate", which by construction
 * excludes USD — useful for deciding where a rate comes from, wrong for
 * deciding whether something is real-world money. Four call sites wanted the
 * second question and three of them wrote `FIAT.has(c) || c === "USD"` by hand.
 */
export function isFiat(currency: string): boolean {
  const c = currency.toUpperCase();
  return c === "USD" || FIAT.has(c);
}
