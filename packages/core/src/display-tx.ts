import { rateOn } from "./fx";
import type { Tx, TxSide } from "./portfolio";

type StoredTx = {
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  fee: number;
  nativeCurrency: string | null;
  nativePrice: number | null;
  nativeFee: number | null;
  sourceSymbol?: string | null;
  /**
   * Prisma hands these back as BigInt; the `Store` port hands them back as
   * number (see `packages/data/src/ports/store.ts`). `Number()` below accepts
   * either, so both callers can pass their rows straight in.
   */
  time: bigint | number;
};

/**
 * Stored transactions expressed in the display currency.
 *
 * A trade settled in the display currency keeps the amount actually paid.
 * Everything else converts from USD — **at the rate on the day of the trade**,
 * which `rates` carries as a USD->display map by UTC day.
 *
 * That map is the whole point of this function's fourth argument. It used to
 * convert every non-native row at *today's* rate, which meant the reported
 * cost of a 2021 dollar purchase changed every morning: on the live ledger,
 * thirty such rows worth $68,019 moved their euro cost basis by €13,060 across
 * the range the rate has taken, with no transaction behind the movement. Cost
 * basis, unrealised P&L and every insight built on them inherited it, and any
 * attempt to separate an asset's gain from the currency's was hopeless while
 * the cost itself floated with the currency.
 *
 * `rates` is null when the display currency is USD (nothing to convert) or
 * when the rate feed could not be reached; `toDisplay` is then the fallback,
 * which is what this function did unconditionally before.
 */
export function toDisplayTxs(
  rows: StoredTx[],
  currency: string,
  toDisplay: number,
  rates: Map<number, number> | null,
): Tx[] {
  return rows.map((t) => {
    const native = t.nativeCurrency === currency && t.nativePrice !== null;
    const time = Number(t.time);
    const rate = rates ? (rateOn(rates, time) ?? toDisplay) : toDisplay;
    return {
      symbol: t.symbol,
      side: t.side as TxSide,
      quantity: t.quantity,
      price: native ? t.nativePrice! : t.price * rate,
      fee: native && t.nativeFee !== null ? t.nativeFee! : t.fee * rate,
      time,
      // Carried through rather than zipped back on by index afterwards: the
      // caller would have to rebuild the same filtered array in the same order
      // to do that, and any divergence attributes a dividend to the wrong
      // security silently.
      sourceSymbol: t.sourceSymbol ?? null,
    };
  });
}

/**
 * The same rows in USD, which is the currency they are stored in.
 *
 * Pairing this with `toDisplayTxs` is what makes currency attribution
 * possible: run both through `computeHoldings` and a position has a cost
 * basis in dollars and a cost basis in the display currency struck at the
 * rates of the days it was actually bought. The ratio between them is the
 * average rate the position was acquired at, and everything the currency has
 * done since is the difference between that and today's.
 */
export function toUsdTxs(rows: StoredTx[]): Tx[] {
  return rows.map((t) => ({
    symbol: t.symbol,
    side: t.side as TxSide,
    quantity: t.quantity,
    price: t.price,
    fee: t.fee,
    time: Number(t.time),
  }));
}
