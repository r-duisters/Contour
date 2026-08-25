import type { Tx, ValuePoint } from "./portfolio";

const DAY_MS = 86_400_000;

/**
 * Money entering or leaving the invested pool, bucketed to the bar grid.
 *
 * A purchase is an inflow of its cost, a sale an outflow of its proceeds, so
 * buying does not read as a gain and selling does not read as a loss. Transfers
 * priced at zero (staking rewards, airdrops) are deliberately NOT flows: they
 * arrived for free, so they belong in the return.
 */
export function flowsByBar(txs: Tx[], barMs: number = DAY_MS): Map<number, number> {
  const out = new Map<number, number>();
  for (const tx of txs) {
    const slot = Math.floor(tx.time / barMs) * barMs;
    const gross = tx.quantity * tx.price;
    let flow = 0;
    if (tx.side === "buy") flow = gross + tx.fee;
    else if (tx.side === "sell") flow = -(gross - tx.fee);
    else if (tx.side === "transfer_in") flow = gross; // 0 when the asset was free
    else if (tx.side === "transfer_out") flow = -gross;
    else if (tx.side === "income") flow = 0; // arrived as a return; belongs in it
    if (flow !== 0) out.set(slot, (out.get(slot) ?? 0) + flow);
  }
  return out;
}

export type ReturnPoint = { t: number; index: number };

/**
 * Time-weighted return: the growth of one unit invested, immune to how much
 * money was added or withdrawn along the way — the basis on which funds and
 * indexes quote performance.
 *
 * Each bar's return is (V_end - flow) / V_start, chained across bars. Bars
 * whose starting value is zero contribute nothing, which is what happens
 * before the first purchase settles.
 */
export function timeWeightedSeries(
  series: ValuePoint[],
  flows: Map<number, number>,
): { points: ReturnPoint[]; totalPct: number | null } {
  const points: ReturnPoint[] = [];
  let index = 100;
  let prevValue: number | null = null;

  for (const p of series) {
    const flow = flows.get(p.t) ?? 0;
    if (prevValue !== null && prevValue > 0) {
      const growth = (p.value - flow) / prevValue;
      // A wholly liquidated portfolio (or a bad price) would poison the chain.
      if (Number.isFinite(growth) && growth > 0) index *= growth;
    }
    prevValue = p.value;
    points.push({ t: p.t, index });
  }

  const first = points[0];
  const last = points[points.length - 1];
  const totalPct = first && last && points.length >= 2 ? last.index - 100 : null;
  return { points, totalPct };
}

/** Rebase a price series so it starts at 100, for comparison against a return index. */
export function indexSeries(bars: { t: number; c: number }[]): ReturnPoint[] {
  const base = bars.find((b) => b.c > 0)?.c;
  if (base === undefined) return [];
  return bars.map((b) => ({ t: b.t, index: (b.c / base) * 100 }));
}

const YEAR_MS = 365 * DAY_MS;

export type CashFlow = { t: number; amount: number };

/**
 * Money-weighted return (XIRR): the annualised rate that makes the actual cash
 * flows and the final value balance. Unlike a time-weighted return it rewards
 * or punishes timing — putting money in before a rally counts.
 *
 * Flows are signed as investments: positive money in, negative money out. The
 * ending value is added as a final outflow.
 */
export function moneyWeightedReturn(
  flows: CashFlow[],
  finalValue: number,
  finalTime: number,
): number | null {
  const all = [...flows, { t: finalTime, amount: -finalValue }]
    .filter((f) => f.amount !== 0)
    .sort((a, b) => a.t - b.t);
  if (all.length < 2) return null;
  const hasIn = all.some((f) => f.amount > 0);
  const hasOut = all.some((f) => f.amount < 0);
  if (!hasIn || !hasOut) return null; // no sign change: no rate can balance it

  const t0 = all[0]!.t;
  const npv = (rate: number) =>
    all.reduce((acc, f) => acc + f.amount / Math.pow(1 + rate, (f.t - t0) / YEAR_MS), 0);

  // Bisection: robust where Newton diverges, which it does on ragged flows.
  let lo = -0.9999;
  let hi = 10;
  let fLo = npv(lo);
  let fHi = npv(hi);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo * fHi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (!Number.isFinite(fMid)) return null;
    if (Math.abs(fMid) < 1e-9 || hi - lo < 1e-9) return mid * 100;
    if (fLo * fMid <= 0) { hi = mid; fHi = fMid; } else { lo = mid; fLo = fMid; }
  }
  return ((lo + hi) / 2) * 100;
}

/**
 * What the same money, moved on the same days, would be worth in a single
 * instrument — the fair way to compare a portfolio built up over years
 * against an index, since both then face identical timing.
 *
 * Returns the counterfactual value at every bar. Sales withdraw proportionally;
 * the simulated position cannot go negative.
 */
export function simulateFlowsInto(
  flows: CashFlow[],
  prices: Map<number, number>,
  timeline: number[],
): ValuePoint[] {
  const byBar = new Map<number, number>();
  for (const f of flows) byBar.set(f.t, (byBar.get(f.t) ?? 0) + f.amount);

  let units = 0;
  let lastPrice: number | null = null;
  const out: ValuePoint[] = [];
  for (const t of timeline) {
    const price: number | null = prices.get(t) ?? lastPrice;
    if (price !== null && price !== undefined && price > 0) {
      lastPrice = price;
      const flow = byBar.get(t) ?? 0;
      if (flow !== 0) units = Math.max(0, units + flow / price);
    }
    out.push({ t, value: lastPrice !== null ? units * lastPrice : 0 });
  }
  return out;
}
