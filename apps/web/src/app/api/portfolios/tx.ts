import { z } from "zod";
import type { Transaction } from "@/data/ports/store";

export const TxInput = z.object({
  symbol: z.string().min(1).max(20),
  side: z.enum(["buy", "sell", "transfer_in", "transfer_out"]),
  quantity: z.number().positive(),
  price: z.number().nonnegative(),
  fee: z.number().nonnegative().default(0),
  time: z.number().int().positive(), // ms timestamp
  note: z.string().max(500).optional(),
});

/**
 * The body of a PATCH, which is not a partial `TxInput`.
 *
 * `.partial()` makes every key optional and leaves its default in place, so
 * `TxInput.partial().parse({ price: 5 })` returns `{ price: 5, fee: 0 }`. A
 * body that never mentioned the fee arrived carrying one, and the update
 * wrote that zero over whatever was stored — editing a price silently erased
 * the fee, and with it part of the cost basis.
 *
 * Overriding `fee` here strips the default, so absent means absent. The
 * default itself is right where it is: a created row needs a number, and
 * `TxInput` is still what POST parses.
 */
export const TxPatch = TxInput.partial().extend({
  fee: z.number().nonnegative().optional(),
});

export function serializeTx(tx: Transaction) {
  return {
    id: tx.id,
    portfolioId: tx.portfolioId,
    symbol: tx.symbol,
    side: tx.side,
    quantity: tx.quantity,
    price: tx.price,
    fee: tx.fee,
    time: Number(tx.time),
    note: tx.note,
  };
}
