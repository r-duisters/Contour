import { pricingPair } from "@/core/symbols";

/**
 * What an asset page submits when someone asks to be told about a price.
 *
 * Pure and in its own module, for the reason `tx-fields.ts` is: the rules
 * worth getting right — what the symbol becomes, what counts as a usable
 * price — can then be checked without a component test stack, which this
 * repository does not have.
 */

export type AlertDraft = { direction: "above" | "below"; price: string };

export type AlertFieldsResult =
  | { ok: true; symbol: string; assetType: "crypto" | "equity"; direction: "above" | "below"; price: number }
  | { ok: false; error: string };

/**
 * The symbol an alert is stored under, which differs by kind on purpose.
 *
 * A coin's alert addresses a *Binance market*, so it keeps the pair —
 * `CLAUDE.md` names `Alert.symbol` as the documented exception to "a stored
 * symbol is an asset, not a pair", and the evaluator asks Binance for exactly
 * this string. A share has no pair: `pricingPair` would answer `ASML.ASUSDT`,
 * which is not a market and which nothing can price, so it keeps its bare
 * ticker and is priced through the equity provider instead.
 *
 * The asymmetry reads as arbitrary six months later, which is exactly why it
 * is one function with both directions pinned by tests rather than an
 * `if` inside a form.
 */
export function alertSymbol(symbol: string, assetType: "crypto" | "equity"): string {
  return assetType === "equity" ? symbol.toUpperCase() : pricingPair(symbol);
}

/**
 * Validate a draft, or say what is wrong with it in words a person can act on.
 *
 * A price of zero is rejected rather than accepted as "any price": an alert
 * that fires immediately and forever is not what anyone meant by it.
 */
export function alertFields(
  symbol: string,
  assetType: "crypto" | "equity" | null,
  draft: AlertDraft,
): AlertFieldsResult {
  if (assetType === null) {
    // The kind decides which venue prices it, and guessing from the ticker is
    // how `AMD` becomes `AMDUSDT`. Waiting is the correct answer.
    return { ok: false, error: "Still working out what this asset is." };
  }
  const price = Number(draft.price.replace(",", "."));
  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, error: "Enter a price above zero." };
  }
  return {
    ok: true,
    symbol: alertSymbol(symbol, assetType),
    assetType,
    direction: draft.direction,
    price,
  };
}
