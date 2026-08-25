import { annotateTransactions, type Tx, type ValuedHolding } from "./portfolio";

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

/**
 * Profit actually taken, per calendar year.
 *
 * Distinct from `flowsByYear` above, and the distinction is the point: that
 * one is money moving *in and out*, this one is money *made*. A year of heavy
 * buying and a year of heavy selling both show large flows, and neither tells
 * you whether the year went well.
 *
 * Each asset is replayed on its own through `annotateTransactions`, because
 * average cost is per-asset — pooling the ledger would value an ETH sale
 * against a basis that included bitcoin. The per-sale figure is that
 * function's `realized`, which nets the sale's own fee and is null for
 * anything that is not a disposal.
 *
 * Years with no sale are absent rather than zero. A year of accumulation
 * realised nothing, and a row of €0 reads like a flat year rather than a quiet
 * one. A caller drawing a chart across a span can fill the gaps; a caller
 * listing them should not have to explain the noughts.
 *
 * Under average cost, and it matters: the same ledger read FIFO allocates
 * profit to different years. Whatever renders this has to say which convention
 * produced it — see #47.
 */
export function realisedByYear(txs: Tx[]): { year: number; realised: number }[] {
  const perYear = new Map<number, number>();
  for (const symbol of new Set(txs.map((t) => t.symbol))) {
    for (const row of annotateTransactions(txs.filter((t) => t.symbol === symbol))) {
      if (row.realized === null) continue;
      const y = new Date(row.time).getUTCFullYear();
      perYear.set(y, (perYear.get(y) ?? 0) + row.realized);
    }
  }
  return [...perYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, realised]) => ({ year, realised }));
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
  /**
   * What the position returned on every euro ever put into it — realised and
   * unrealised together, over `invested`.
   *
   * This used to be `unrealized / costBasis`, the return on the stake still
   * held, which had two failures. A closed position has neither term and
   * reported nothing at all: eleven of them in the live ledger, carrying real
   * profit and ranking with a blank. And a position sold down in part showed
   * the *remainder's* return while its `total` included the sale — so the
   * column meant to rank the best decisions was quietest about the ones acted
   * on.
   */
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
      pct: returnPct(h),
    }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Null rather than a guess in two cases. Nothing was ever invested, so there
 * is no denominator; or the position is still open and its price lookup
 * failed, where treating the unknown gain as zero would report a loss the
 * position has not made.
 */
function returnPct(h: ValuedHolding): number | null {
  if (!(h.invested > 0)) return null;
  if (h.quantity > 1e-12 && h.unrealizedPnl === null) return null;
  return ((h.realizedPnl + (h.unrealizedPnl ?? 0)) / h.invested) * 100;
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
