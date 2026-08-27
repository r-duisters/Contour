import { currencyForTicker } from "@/core/equity";

/**
 * The transaction a form describes. It lives here rather than in `TxForm`
 * because `TxForm` imports this module — the other direction would be a cycle,
 * and a type-only cycle is still a cycle waiting for someone to add a value to
 * it. `TxForm` re-exports it so existing importers do not move.
 */
/**
 * Which of two quite different things the form is describing.
 *
 * `"trade"` is an asset changing hands at a price. `"cash"` is money itself
 * moving — a deposit, a withdrawal, a dividend — where there is no price to
 * type because one euro is worth one euro.
 */
export type TxMode = "trade" | "cash";

export type NewTx = {
  symbol: string;
  assetType: "crypto" | "equity" | "cash";
  side: "buy" | "sell" | "transfer_in" | "transfer_out" | "income";
  quantity: number;
  price: number;
  fee: number;
  time: number;
  /** What the price was quoted in; null means it was already USD. */
  nativeCurrency: string | null;
  nativePrice: number;
  nativeFee: number;
  /** The security an `income` row is attributed to; null for anything else. */
  sourceSymbol: string | null;
};

export type TxFields = {
  mode: TxMode;
  symbol: string;
  side: NewTx["side"];
  quantity: string;
  price: string;
  fee: string;
  /** A `datetime-local` value, in the device's own timezone. */
  when: string;
  /**
   * In trade mode, the quote chosen for a coin (ignored for an equity). In
   * cash mode it is the currency itself, and there is nothing else it could be.
   */
  currency: string | null;
  /** Free text; only read when the side is `income`. */
  sourceSymbol: string;
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
  if (f.mode === "cash") return toCashTx(f);
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
    // The form has never distinguished a coin from a share, and the route's
    // default has always been "crypto"; the importer is what classifies
    // equities. Saying it explicitly here changes nothing and keeps the field
    // from being the one thing `toNewTx` leaves for a caller to remember.
    assetType: "crypto",
    side: f.side,
    quantity, price, fee, time,
    nativeCurrency: f.currency,
    nativePrice: price,
    nativeFee: fee,
    sourceSymbol: null,
  };
}

/**
 * A cash row is money itself: one unit is worth one unit, so `price` is 0 and
 * `nativePrice` is 1 — the shape the importer has written for fiat deposits
 * since it was first written, and the shape every cash consumer reads.
 *
 * The amount goes in `quantity`. That is why the cash mode hides the price
 * field entirely rather than defaulting it: a price box beside an amount box
 * is an invitation to type the amount twice.
 */
function toCashTx(f: TxFields): NewTx | null {
  const quantity = Number(f.quantity);
  const time = new Date(f.when).getTime();
  if (f.quantity.trim() === "" || !Number.isFinite(quantity) || quantity <= 0) return null;
  if (!Number.isFinite(time)) return null;
  // No fallback: a cash row with a guessed currency is a wrong balance in a
  // currency nobody chose.
  if (!f.currency) return null;
  const source = f.sourceSymbol.trim().toUpperCase();
  return {
    symbol: f.currency,
    assetType: "cash",
    side: f.side,
    quantity,
    price: 0,
    fee: 0,
    time,
    nativeCurrency: f.currency,
    nativePrice: 1,
    nativeFee: 0,
    sourceSymbol: f.side === "income" && source ? source : null,
  };
}
