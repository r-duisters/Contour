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
  name?: string | null;
  assetType: "crypto" | "equity" | "cash";
  realized: number;
  unrealized: number;
  total: number;
  /** Return on the money still in the position. */
  pct: number | null;
};

/** Which holdings actually made or lost the money, best first. */
export function contributions(
  holdings: (ValuedHolding & {
    assetType?: "crypto" | "equity" | "cash"; name?: string | null;
  })[],
): Contribution[] {
  // Cash never made or lost anything; it would only dilute the ranking.
  return holdings
    .filter((h) => h.assetType !== "cash")
    .map((h) => ({
      symbol: h.symbol,
      name: h.name,
      assetType: h.assetType ?? ("crypto" as const),
      realized: h.realizedPnl,
      unrealized: h.unrealizedPnl ?? 0,
      total: h.realizedPnl + (h.unrealizedPnl ?? 0),
      pct: h.costBasis > 0 && h.unrealizedPnl !== null ? (h.unrealizedPnl / h.costBasis) * 100 : null,
    }))
    .sort((a, b) => b.total - a.total);
}

export type AssetClass = "Crypto" | "Stocks" | "ETFs" | "Cash";

export type AllocationPosition = {
  symbol: string;
  name?: string | null;
  value: number;
  /** Of the whole portfolio, not of the class — so a row can be read alone. */
  share: number;
};

export type AllocationClass = {
  label: AssetClass;
  value: number;
  share: number;
  /** Largest first. Empty only when the class itself has no priced holding. */
  positions: AllocationPosition[];
};

/**
 * Which asset class a holding belongs to.
 *
 * `assetType` in the database has three values, and its `equity` covers both
 * a share and a fund. The distinction comes from the price provider instead —
 * Yahoo reports `instrumentType` beside the name — and is used for grouping
 * only: nothing is written back, so the schema, the Delta importer and the
 * `Store` port all stay as they are.
 *
 * A provider that reports nothing yields `Stocks`. Guessing a fund from a
 * ticker is how an equity ends up in the wrong class on a screen whose whole
 * job is to say where the money is.
 */
function assetClass(assetType: string | undefined, instrumentType: string | null | undefined): AssetClass {
  if (assetType === "cash") return "Cash";
  if (assetType !== "equity") return "Crypto";
  return instrumentType?.toUpperCase() === "ETF" ? "ETFs" : "Stocks";
}

const CLASS_ORDER: AssetClass[] = ["Crypto", "Stocks", "ETFs", "Cash"];

/**
 * Value by asset class, each class carrying the positions inside it.
 *
 * One structure rather than two: the page used to draw a class bar list and a
 * per-asset donut side by side, which answered "where is the money" twice and
 * disagreed about how to show it.
 *
 * Unpriced holdings are absent rather than zero. A holding whose price could
 * not be fetched has an unknown value, and drawing it as nothing would quietly
 * understate a class — the totals elsewhere already say how many are unpriced.
 */
export function allocation(
  holdings: (ValuedHolding & {
    assetType?: "crypto" | "equity" | "cash";
    name?: string | null;
    instrumentType?: string | null;
  })[],
): AllocationClass[] {
  const priced = holdings.filter((h) => (h.value ?? 0) > 0);
  const sum = priced.reduce((a, h) => a + h.value!, 0);
  if (sum <= 0) return [];

  const byClass = new Map<AssetClass, AllocationPosition[]>();
  for (const h of priced) {
    const key = assetClass(h.assetType, h.instrumentType);
    const share = (h.value! / sum) * 100;
    byClass.set(key, [...(byClass.get(key) ?? []), {
      symbol: h.symbol, name: h.name, value: h.value!, share,
    }]);
  }

  return CLASS_ORDER
    .filter((label) => byClass.has(label))
    .map((label) => {
      const positions = byClass.get(label)!.sort((a, b) => b.value - a.value);
      const value = positions.reduce((a, p) => a + p.value, 0);
      return { label, value, share: (value / sum) * 100, positions };
    })
    .sort((a, b) => b.value - a.value);
}
