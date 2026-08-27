export type CashRelevantTx = {
  assetType: string;
  side: string;
  quantity: number;
  /**
   * Withheld from the amount. Optional because every caller predating income
   * passed rows whose fee was zero; a dividend's withholding is the only
   * non-zero value this has ever seen.
   */
  fee?: number;
  /**
   * Currency of the movement; for cash rows this is the currency itself.
   * Undefined as well as null, so a freshly parsed `ParsedTx` — where an
   * absent field is undefined rather than null — can be balanced without
   * being mapped to a stored row first.
   */
  nativeCurrency?: string | null;
};

/**
 * Fiat balances per currency, summed from the cash movements the export
 * records — deposits and withdrawals in, transfers out.
 *
 * Deliberately does NOT deduct what purchases cost: Delta writes the cash leg
 * of a trade as its own fiat row, so subtracting the trade as well would count
 * every purchase twice. Cash and invested value are separate figures, and the
 * ledger already contains both sides.
 *
 * `income` — a dividend, interest, a staking payout in fiat — is a credit like
 * any other. It is listed explicitly rather than left to fall through, because
 * the fall-through is the withdrawal branch.
 */
export function cashBalances(txs: CashRelevantTx[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of txs) {
    if (t.assetType !== "cash") continue;
    const currency = t.nativeCurrency;
    if (!currency) continue;
    // Net of any fee. A dividend carries a withholding, recorded as `fee` so
    // the gross stays visible; every other cash row has fee 0, so this is a
    // no-op everywhere except the rows income introduced.
    const credit = t.quantity - (t.fee ?? 0);
    const signed =
      t.side === "transfer_in" || t.side === "buy" || t.side === "income"
        ? credit
        : -t.quantity;
    out[currency] = (out[currency] ?? 0) + signed;
  }
  for (const [currency, amount] of Object.entries(out)) {
    if (Math.abs(amount) < 0.005) delete out[currency];
  }
  return out;
}

/** A cash movement with the moment it happened, for the running-balance form. */
export type TimedCashTx = CashRelevantTx & { time: number };

/**
 * The same balances as `cashBalances`, but as they stood at each of the given
 * moments — what the value chart needs to draw cash alongside the holdings.
 *
 * `times` must be ascending; the transactions need not be. One pass over each,
 * rather than re-filtering the ledger per bar.
 *
 * A negative balance is reported, not suppressed. The caller decides what an
 * impossible balance means — `valuation` declines to let one subtract from the
 * portfolio's worth — and hiding it here would leave no way to tell "no cash"
 * from "the ledger is missing its deposits".
 */
export function cashBalancesOver(
  txs: TimedCashTx[],
  times: number[],
): Record<string, number>[] {
  const moves = txs
    .filter((t) => t.assetType === "cash" && t.nativeCurrency)
    .sort((a, b) => a.time - b.time);

  const running: Record<string, number> = {};
  const out: Record<string, number>[] = [];
  let i = 0;
  for (const at of times) {
    while (i < moves.length && moves[i]!.time <= at) {
      const m = moves[i]!;
      const signed =
        m.side === "transfer_in" || m.side === "buy" || m.side === "income"
          ? m.quantity - (m.fee ?? 0)
          : -m.quantity;
      running[m.nativeCurrency!] = (running[m.nativeCurrency!] ?? 0) + signed;
      i++;
    }
    out.push(prune(running));
  }
  return out;
}

/** A copy with the dust dropped, matching what `cashBalances` returns. */
function prune(balances: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [currency, amount] of Object.entries(balances)) {
    if (Math.abs(amount) >= 0.005) out[currency] = amount;
  }
  return out;
}
