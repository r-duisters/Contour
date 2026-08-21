import type { Bar } from "./types";

export type TxSide = "buy" | "sell" | "transfer_in" | "transfer_out";

export type Tx = {
  symbol: string;
  side: TxSide;
  quantity: number;
  /** Quote units per base unit. For transfers this is the assumed cost-basis price. */
  price: number;
  /** Fee in quote units. */
  fee: number;
  /** ms timestamp */
  time: number;
};

export type Holding = {
  symbol: string;
  quantity: number;
  /** Average cost per unit of the current position (fees included). */
  avgCost: number;
  /** Total cost of the current position (quantity * avgCost). */
  costBasis: number;
  /** Realized P&L from sells, net of sell fees. */
  realizedPnl: number;
  /** Sum of all fees paid on this symbol. */
  fees: number;
};

export type ValuedHolding = Holding & {
  price: number | null;
  value: number | null;
  unrealizedPnl: number | null;
};

export type ValuePoint = { t: number; value: number };

/**
 * Average-cost accounting over a transaction log.
 *
 * - buy / transfer_in add to the position at the given price (+ buy fee into cost basis).
 * - sell realizes (price - avgCost) * qty - fee.
 * - transfer_out removes quantity at avgCost without realizing P&L (it's not a disposal).
 * - Disposals are clamped to the held quantity: the ledger can't go short.
 */
export function computeHoldings(txs: Tx[]): Holding[] {
  const bySymbol = new Map<string, Holding>();
  const sorted = [...txs].sort((a, b) => a.time - b.time);

  for (const tx of sorted) {
    let h = bySymbol.get(tx.symbol);
    if (!h) {
      h = { symbol: tx.symbol, quantity: 0, avgCost: 0, costBasis: 0, realizedPnl: 0, fees: 0 };
      bySymbol.set(tx.symbol, h);
    }
    h.fees += tx.fee;

    if (tx.side === "buy" || tx.side === "transfer_in") {
      const cost = tx.quantity * tx.price + (tx.side === "buy" ? tx.fee : 0);
      h.costBasis += cost;
      h.quantity += tx.quantity;
      h.avgCost = h.quantity > 0 ? h.costBasis / h.quantity : 0;
    } else {
      const qty = Math.min(tx.quantity, h.quantity);
      if (tx.side === "sell") {
        h.realizedPnl += qty * (tx.price - h.avgCost) - tx.fee;
      }
      h.quantity -= qty;
      h.costBasis = h.quantity * h.avgCost;
      if (h.quantity === 0) h.avgCost = 0;
    }
  }

  return [...bySymbol.values()].filter(
    (h) => h.quantity > 1e-12 || h.realizedPnl !== 0 || h.fees !== 0,
  );
}

/** Attach live prices to holdings. `prices` maps symbol -> current price in quote units. */
export function valueHoldings(
  holdings: Holding[],
  prices: Record<string, number>,
): ValuedHolding[] {
  return holdings.map((h) => {
    const price = prices[h.symbol];
    if (price === undefined || !Number.isFinite(price)) {
      return { ...h, price: null, value: null, unrealizedPnl: null };
    }
    const value = h.quantity * price;
    return { ...h, price, value, unrealizedPnl: value - h.costBasis };
  });
}

/**
 * Reconstruct portfolio value from the transaction log and candles per symbol.
 * For each bar time in the union of all series, values quantity-held-at-that-time
 * at that bar's close. Bars before the first transaction are omitted.
 * `barMs` is the candle width — one day by default, smaller for intraday ranges.
 */
export function portfolioValueSeries(
  txs: Tx[],
  candlesBySymbol: Record<string, Bar[]>,
  barMs: number = DAY_MS,
): ValuePoint[] {
  if (txs.length === 0) return [];
  const sorted = [...txs].sort((a, b) => a.time - b.time);
  const firstTime = sorted[0]!.time;

  const times = new Set<number>();
  for (const bars of Object.values(candlesBySymbol)) {
    for (const b of bars) if (b.t + barMs > firstTime) times.add(b.t);
  }
  const timeline = [...times].sort((a, b) => a - b);

  const closes = new Map<string, Map<number, number>>();
  for (const [symbol, bars] of Object.entries(candlesBySymbol)) {
    closes.set(symbol, new Map(bars.map((b) => [b.t, b.c])));
  }

  const symbols = [...new Set(sorted.map((tx) => tx.symbol))];
  const qty = new Map<string, number>(symbols.map((s) => [s, 0]));
  const lastClose = new Map<string, number>();
  let txIdx = 0;

  const out: ValuePoint[] = [];
  for (const t of timeline) {
    // apply all transactions that happened before this bar closed
    const barClose = t + barMs;
    while (txIdx < sorted.length && sorted[txIdx]!.time < barClose) {
      const tx = sorted[txIdx]!;
      const held = qty.get(tx.symbol) ?? 0;
      const delta =
        tx.side === "buy" || tx.side === "transfer_in"
          ? tx.quantity
          : -Math.min(tx.quantity, held);
      qty.set(tx.symbol, held + delta);
      txIdx++;
    }
    let value = 0;
    for (const s of symbols) {
      const q = qty.get(s)!;
      if (q <= 0) continue;
      const close = closes.get(s)?.get(t);
      if (close !== undefined) lastClose.set(s, close);
      const px = close ?? lastClose.get(s);
      if (px !== undefined) value += q * px;
    }
    out.push({ t, value });
  }
  return out;
}

const DAY_MS = 86_400_000;

export type AnnotatedTx<T extends Tx> = T & {
  /** Units held once this transaction settled. */
  positionAfter: number;
  /** Average cost of the position at that moment. */
  avgCostAfter: number;
  /** Profit realised by this sale, net of its fee. Null for anything else. */
  realized: number | null;
};

/**
 * Replay a single asset's transactions oldest-first, so each one can say what
 * it left behind: the position after it, the average cost at that point, and
 * for a sale what it actually made. The arithmetic matches computeHoldings —
 * the same average-cost rules, applied one row at a time.
 */
export function annotateTransactions<T extends Tx>(txs: T[]): AnnotatedTx<T>[] {
  let quantity = 0;
  let costBasis = 0;
  const out: AnnotatedTx<T>[] = [];

  for (const tx of [...txs].sort((a, b) => a.time - b.time)) {
    let realized: number | null = null;
    if (tx.side === "buy" || tx.side === "transfer_in") {
      costBasis += tx.quantity * tx.price + (tx.side === "buy" ? tx.fee : 0);
      quantity += tx.quantity;
    } else {
      const avgCost = quantity > 0 ? costBasis / quantity : 0;
      const sold = Math.min(tx.quantity, quantity);
      if (tx.side === "sell") realized = sold * (tx.price - avgCost) - tx.fee;
      quantity -= sold;
      costBasis = quantity * avgCost;
    }
    out.push({
      ...tx,
      positionAfter: quantity,
      avgCostAfter: quantity > 0 ? costBasis / quantity : 0,
      realized,
    });
  }
  return out;
}
