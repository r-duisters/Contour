import { currencyForTicker } from "@/core/equity";

/**
 * The transaction a form describes. It lives here rather than in `TxForm`
 * because `TxForm` imports this module — the other direction would be a cycle,
 * and a type-only cycle is still a cycle waiting for someone to add a value to
 * it. `TxForm` re-exports it so existing importers do not move.
 */
export type NewTx = {
  symbol: string;
  side: "buy" | "sell" | "transfer_in" | "transfer_out";
  quantity: number;
  price: number;
  fee: number;
  time: number;
  /** What the price was quoted in; null means it was already USD. */
  nativeCurrency: string | null;
  nativePrice: number;
  nativeFee: number;
};

export type TxFields = {
  symbol: string;
  side: NewTx["side"];
  quantity: string;
  price: string;
  fee: string;
  /** A `datetime-local` value, in the device's own timezone. */
  when: string;
  /** The quote chosen for a coin; ignored for an equity. */
  currency: string | null;
};

/**
 * What the price field is denominated in.
 *
 * A coin can be bought with several things and the picker says which. A listed
 * security is priced in its venue's currency and has no choice about it, so a
 * quote left over from the last coin must not follow it there.
 */
export function priceCurrency(
  symbol: string,
  assetType: "crypto" | "equity",
  chosen: string | null,
): string {
  if (assetType === "equity") return currencyForTicker(symbol);
  return chosen ?? "USDT";
}

/**
 * The transaction a filled-in form describes, or null if it does not describe
 * one yet.
 *
 * `price` and `nativePrice` are the same number on purpose: the figure typed
 * is the figure paid, and turning it into USD happens in the service at the
 * rate on the trade's date. A browser has no business knowing that rate, and
 * two screens that each converted would eventually disagree.
 */
export function toNewTx(f: TxFields): NewTx | null {
  const quantity = Number(f.quantity);
  const price = Number(f.price);
  const fee = f.fee === "" ? 0 : Number(f.fee);
  const time = new Date(f.when).getTime();
  if (!f.symbol) return null;
  if (f.quantity.trim() === "" || !Number.isFinite(quantity) || quantity <= 0) return null;
  if (f.price.trim() === "" || !Number.isFinite(price) || price < 0) return null;
  if (!Number.isFinite(fee) || fee < 0) return null;
  if (!Number.isFinite(time)) return null;
  return {
    symbol: f.symbol.toUpperCase(),
    side: f.side,
    quantity, price, fee, time,
    nativeCurrency: f.currency,
    nativePrice: price,
    nativeFee: fee,
  };
}
