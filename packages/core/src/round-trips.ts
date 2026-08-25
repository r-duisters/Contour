import type { Tx } from "./portfolio";

/**
 * Closed trades, reconstructed by matching each disposal to the oldest units
 * still open.
 *
 * The app accounts in average cost everywhere else, and average cost has no
 * round trips: a sale is matched against a running average, so *how long the
 * sold units were held* is destroyed by the method. It is not missing from the
 * ledger — it is simply not recoverable from an average. Every question worth
 * asking about a past trade needs an entry date, so this reads the same
 * transactions a second way.
 *
 * **Nothing here is ever totalled into a portfolio figure**, deliberately.
 * FIFO and average cost disagree about realised profit — €68,979 against
 * €67,681 on the live ledger, entirely from positions still open — and the app
 * states exactly one realised total, the average-cost one. This module answers
 * questions about individual trades: how many worked, how long they ran, which
 * was best and which was worst. It does not offer a second bottom line.
 */

export type RoundTrip = {
  symbol: string;
  quantity: number;
  /** When the sold units were acquired, and when they were sold. */
  inAt: number;
  outAt: number;
  /** Per-unit cost including the buy's fee, and per-unit proceeds. */
  buyPrice: number;
  sellPrice: number;
  /** Profit on these units, net of both fees. */
  pnl: number;
  /** How long the money was at work. */
  days: number;
};

type Lot = { qty: number; price: number; time: number };

const DAY_MS = 86_400_000;

export function roundTrips(txs: Tx[]): RoundTrip[] {
  const out: RoundTrip[] = [];

  for (const symbol of new Set(txs.map((t) => t.symbol))) {
    const lots: Lot[] = [];
    const ordered = txs.filter((t) => t.symbol === symbol).sort((a, b) => a.time - b.time);

    for (const tx of ordered) {
      if (tx.side === "buy" || tx.side === "transfer_in") {
        if (tx.quantity <= 0) continue;
        // The buy's fee belongs in what the units cost, matching how
        // `computeHoldings` folds it into cost basis. Without it every trip
        // overstates its profit by the fee.
        const cost = tx.quantity * tx.price + (tx.side === "buy" ? tx.fee : 0);
        lots.push({ qty: tx.quantity, price: cost / tx.quantity, time: tx.time });
        continue;
      }

      // A sale's fee is charged against the whole disposal, so each lot it
      // consumes carries its share rather than the first one carrying all.
      const feePerUnit = tx.quantity > 0 ? tx.fee / tx.quantity : 0;
      let left = tx.quantity;

      while (left > 1e-12 && lots.length > 0) {
        const lot = lots[0]!;
        const take = Math.min(left, lot.qty);

        // A transfer out takes the units and reports nothing: the coins moved,
        // they were not sold, and no profit was made by moving them.
        if (tx.side === "sell") {
          out.push({
            symbol,
            quantity: take,
            inAt: lot.time,
            outAt: tx.time,
            buyPrice: lot.price,
            sellPrice: tx.price,
            pnl: take * (tx.price - lot.price) - take * feePerUnit,
            days: (tx.time - lot.time) / DAY_MS,
          });
        }

        lot.qty -= take;
        left -= take;
        if (lot.qty <= 1e-12) lots.shift();
      }
      // Anything still unmatched sold units the ledger never recorded buying.
      // `auditLedger` reports that separately; inventing a lot here would hide
      // it behind a fabricated profit.
    }
  }

  return out;
}

export type TripStats = {
  trips: number;
  /** Share that made money. A scratch counts as a loss: it did not. */
  winRatePct: number | null;
  medianWinnerDays: number | null;
  medianLoserDays: number | null;
  best: RoundTrip | null;
  worst: RoundTrip | null;
};

/**
 * Median rather than mean for the holding periods. One position held eight
 * years drags a mean far past anything typical, and the question these answer
 * — do I run winners longer than losers — is about the ordinary trade.
 */
export function tripStats(trips: RoundTrip[]): TripStats {
  if (trips.length === 0) {
    return {
      trips: 0, winRatePct: null, medianWinnerDays: null,
      medianLoserDays: null, best: null, worst: null,
    };
  }
  const winners = trips.filter((t) => t.pnl > 0);
  const losers = trips.filter((t) => t.pnl <= 0);
  const median = (xs: number[]): number | null => {
    if (xs.length === 0) return null;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)]!;
  };
  const byPnl = [...trips].sort((a, b) => b.pnl - a.pnl);

  return {
    trips: trips.length,
    winRatePct: (winners.length / trips.length) * 100,
    medianWinnerDays: median(winners.map((t) => t.days)),
    medianLoserDays: median(losers.map((t) => t.days)),
    best: byPnl[0] ?? null,
    worst: byPnl[byPnl.length - 1] ?? null,
  };
}
