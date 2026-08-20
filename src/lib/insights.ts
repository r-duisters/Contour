import type { Tx, ValuedHolding } from "./portfolio";

export type TradeStats = {
  trades: number;
  buys: number;
  sells: number;
  transfers: number;
  firstTrade: number | null;
  lastTrade: number | null;
  totalBought: number;
  totalSold: number;
  fees: number;
  /** Fees as a percentage of everything ever bought. */
  feeRatePct: number | null;
  avgBuySize: number | null;
  busiestYear: { year: number; trades: number } | null;
  assetsTraded: number;
};

export function tradeStats(txs: Tx[]): TradeStats {
  const buys = txs.filter((t) => t.side === "buy");
  const sells = txs.filter((t) => t.side === "sell");
  const transfers = txs.filter((t) => t.side !== "buy" && t.side !== "sell");
  const totalBought = buys.reduce((a, t) => a + t.quantity * t.price, 0);
  const totalSold = sells.reduce((a, t) => a + t.quantity * t.price, 0);
  const fees = txs.reduce((a, t) => a + t.fee, 0);

  const perYear = new Map<number, number>();
  for (const t of txs) {
    const y = new Date(t.time).getUTCFullYear();
    perYear.set(y, (perYear.get(y) ?? 0) + 1);
  }
  const busiest = [...perYear.entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    trades: txs.length,
    buys: buys.length,
    sells: sells.length,
    transfers: transfers.length,
    firstTrade: txs.length ? Math.min(...txs.map((t) => t.time)) : null,
    lastTrade: txs.length ? Math.max(...txs.map((t) => t.time)) : null,
    totalBought,
    totalSold,
    fees,
    feeRatePct: totalBought > 0 ? (fees / totalBought) * 100 : null,
    avgBuySize: buys.length > 0 ? totalBought / buys.length : null,
    busiestYear: busiest ? { year: busiest[0], trades: busiest[1] } : null,
    assetsTraded: new Set(txs.map((t) => t.symbol)).size,
  };
}

/** Net money invested per calendar year: buys and priced transfers in, sales out. */
export function flowsByYear(txs: Tx[]): { year: number; net: number }[] {
  const perYear = new Map<number, number>();
  for (const t of txs) {
    const y = new Date(t.time).getUTCFullYear();
    const gross = t.quantity * t.price;
    let flow = 0;
    if (t.side === "buy") flow = gross + t.fee;
    else if (t.side === "sell") flow = -(gross - t.fee);
    else if (t.side === "transfer_in") flow = gross;
    else flow = -gross;
    perYear.set(y, (perYear.get(y) ?? 0) + flow);
  }
  return [...perYear.entries()].sort((a, b) => a[0] - b[0]).map(([y, net]) => ({ year: y, net }));
}

export type Concentration = {
  /** Share of total value held by the single largest position, 0-100. */
  topShare: number | null;
  top3Share: number | null;
  /** Herfindahl index over value weights: 1 is everything in one asset. */
  herfindahl: number | null;
  pricedCount: number;
};

export function concentration(holdings: ValuedHolding[]): Concentration {
  const valued = holdings.filter((h) => (h.value ?? 0) > 0).sort((a, b) => b.value! - a.value!);
  const total = valued.reduce((a, h) => a + h.value!, 0);
  if (total <= 0) return { topShare: null, top3Share: null, herfindahl: null, pricedCount: 0 };
  const weights = valued.map((h) => h.value! / total);
  return {
    topShare: weights[0]! * 100,
    top3Share: weights.slice(0, 3).reduce((a, w) => a + w, 0) * 100,
    herfindahl: weights.reduce((a, w) => a + w * w, 0),
    pricedCount: valued.length,
  };
}

export type Contribution = {
  symbol: string;
  assetType: "crypto" | "equity";
  realized: number;
  unrealized: number;
  total: number;
  /** Return on the money still in the position. */
  pct: number | null;
};

/** Which holdings actually made or lost the money, best first. */
export function contributions(holdings: (ValuedHolding & { assetType?: "crypto" | "equity" })[]): Contribution[] {
  return holdings
    .map((h) => ({
      symbol: h.symbol,
      assetType: h.assetType ?? ("crypto" as const),
      realized: h.realizedPnl,
      unrealized: h.unrealizedPnl ?? 0,
      total: h.realizedPnl + (h.unrealizedPnl ?? 0),
      pct: h.costBasis > 0 && h.unrealizedPnl !== null ? (h.unrealizedPnl / h.costBasis) * 100 : null,
    }))
    .sort((a, b) => b.total - a.total);
}

/** Value split between asset classes. */
export function classSplit(
  holdings: (ValuedHolding & { assetType?: "crypto" | "equity" })[],
): { label: string; value: number; share: number }[] {
  const totals = new Map<string, number>();
  for (const h of holdings) {
    const key = h.assetType === "equity" ? "Stocks & ETFs" : "Crypto";
    totals.set(key, (totals.get(key) ?? 0) + (h.value ?? 0));
  }
  const sum = [...totals.values()].reduce((a, b) => a + b, 0);
  return [...totals.entries()]
    .filter(([, v]) => v > 0)
    .map(([label, value]) => ({ label, value, share: sum > 0 ? (value / sum) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);
}
