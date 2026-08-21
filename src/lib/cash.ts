export type CashRelevantTx = {
  assetType: string;
  side: string;
  quantity: number;
  /** Currency of the movement, for cash rows this is the currency itself. */
  nativeCurrency: string | null;
};

/**
 * Fiat balances per currency, summed from the cash movements the export
 * records — deposits and withdrawals in, transfers out.
 *
 * Deliberately does NOT deduct what purchases cost: Delta writes the cash leg
 * of a trade as its own fiat row, so subtracting the trade as well would count
 * every purchase twice. Cash and invested value are separate figures, and the
 * ledger already contains both sides.
 */
export function cashBalances(txs: CashRelevantTx[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of txs) {
    if (t.assetType !== "cash") continue;
    const currency = t.nativeCurrency;
    if (!currency) continue;
    const signed = t.side === "transfer_in" || t.side === "buy" ? t.quantity : -t.quantity;
    out[currency] = (out[currency] ?? 0) + signed;
  }
  for (const [currency, amount] of Object.entries(out)) {
    if (Math.abs(amount) < 0.005) delete out[currency];
  }
  return out;
}
