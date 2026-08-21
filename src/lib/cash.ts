export type CashRelevantTx = {
  assetType: string;
  side: string;
  quantity: number;
  /** Currency the trade settled in, when known. */
  nativeCurrency: string | null;
  nativePrice: number | null;
  nativeFee: number | null;
};

/**
 * Fiat balances per currency.
 *
 * Deposits and withdrawals move cash directly. Trades move it too: buying an
 * asset for euros spends euros, selling returns them. Without that second half
 * every deposit would pile up forever and the balance would be meaningless.
 *
 * A negative balance is reported as-is rather than clamped: it means the export
 * is missing deposits, and hiding that would quietly overstate nothing while
 * quietly understating the truth.
 */
export function cashBalances(txs: CashRelevantTx[]): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (currency: string | null, amount: number) => {
    if (!currency || amount === 0) return;
    out[currency] = (out[currency] ?? 0) + amount;
  };

  for (const t of txs) {
    if (t.assetType === "cash") {
      // symbol is the currency itself; quantity is the amount moved
      const currency = t.nativeCurrency;
      if (t.side === "transfer_in" || t.side === "buy") add(currency, t.quantity);
      else add(currency, -t.quantity);
      continue;
    }
    // The cash leg of an asset trade, only when we know what it settled in.
    if (t.nativePrice === null || !t.nativeCurrency) continue;
    const gross = t.quantity * t.nativePrice;
    const fee = t.nativeFee ?? 0;
    if (t.side === "buy") add(t.nativeCurrency, -(gross + fee));
    else if (t.side === "sell") add(t.nativeCurrency, gross - fee);
  }

  for (const [currency, amount] of Object.entries(out)) {
    if (Math.abs(amount) < 0.005) delete out[currency];
  }
  return out;
}
