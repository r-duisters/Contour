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
