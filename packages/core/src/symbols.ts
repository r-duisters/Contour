/**
 * The two directions between what a person owns and what a venue prices.
 *
 * `Transaction.symbol` records the asset — `ETH`, `ASML.AS`. Binance prices
 * pairs — `ETHUSDT`. Those are different facts, and conflating them is what
 * this module exists to stop: 172 of 261 crypto rows once carried a `USDT`
 * suffix that contradicted the `nativeCurrency` beside them.
 *
 * Both functions are idempotent, deliberately. They run over a database that
 * is half-migrated during the rename and over user input that may be either
 * form, so applying one twice must not change the answer.
 */

/**
 * Quote assets, longest first so `FDUSD` is matched before `USD` would be.
 *
 * Kept in step with `QUOTE_ASSETS` in `packages/ui/src/CoinIcon.tsx`, which is
 * the older copy and the one the icons use. `symbols.test.ts` asserts the two
 * agree rather than trusting a comment to keep them together.
 */
export const QUOTE_ASSETS = [
  "FDUSD", "USDT", "USDC", "BUSD", "TUSD", "BNB", "BTC", "ETH", "EUR", "TRY",
] as const;

/** What is owned: `ETHUSDT` -> `ETH`, `ETH` -> `ETH`, `ASML.AS` -> `ASML.AS`. */
export function assetOf(symbol: string): string {
  const s = symbol.toUpperCase();
  for (const q of QUOTE_ASSETS) {
    // `s.length > q.length` is what stops USDT becoming the empty string.
    if (s.endsWith(q) && s.length > q.length) return s.slice(0, -q.length);
  }
  return s;
}

/**
 * What Binance prices: `ETH` -> `ETHUSDT`, and a pair passed straight through.
 *
 * **Crypto only.** It has no way to recognise an equity, so `pricingPair`
 * would happily answer `AMDUSDT` for AMD and `ASML.ASUSDT` for ASML — neither
 * exists, and both would silently price a holding at nothing. Every caller
 * must have split equities off first; `valuation` does it with `equitySymbols`
 * and `series` inside `if (!equitySymbols.has(s))`.
 */
export function pricingPair(asset: string): string {
  const s = asset.toUpperCase();
  return assetOf(s) === s && s !== "USDT" ? `${s}USDT` : s;
}
