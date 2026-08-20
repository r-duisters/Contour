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
