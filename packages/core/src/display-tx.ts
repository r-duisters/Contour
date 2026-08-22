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
  /**
   * Prisma hands these back as BigInt; the `Store` port hands them back as
   * number (see `packages/data/src/ports/store.ts`). `Number()` below accepts
   * either, so both callers can pass their rows straight in.
   */
  time: bigint | number;
};

/**
 * Stored transactions expressed in the display currency. Trades settled in that
 * currency keep the amount actually paid; the rest convert from USD at the
 * current rate. Re-converting an old EUR purchase through today's USD rate
 * would misstate what it cost.
 */
export function toDisplayTxs(rows: StoredTx[], currency: string, toDisplay: number): Tx[] {
  return rows.map((t) => {
    const native = t.nativeCurrency === currency && t.nativePrice !== null;
    return {
      symbol: t.symbol,
      side: t.side as TxSide,
      quantity: t.quantity,
      price: native ? t.nativePrice! : t.price * toDisplay,
      fee: native && t.nativeFee !== null ? t.nativeFee! : t.fee * toDisplay,
      time: Number(t.time),
    };
  });
}
