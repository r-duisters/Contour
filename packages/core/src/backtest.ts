import type { Bar, Signal } from "./types";

export type Trade = {
  kind: "buy" | "sell";
  time: number;
  price: number;
  units: number;
  cashDelta: number; // negative on buy, positive on sell
  tag?: string;
};

export type BacktestStats = {
  trades: Trade[];
  initialCapital: number;
  finalEquity: number;
  totalReturnPct: number;
  winRate: number;        // share of sells that closed at higher avg-entry than received
  maxDrawdownPct: number;
  equityCurve: { t: number; equity: number }[];
};

export type SimulateOptions = {
  initialCapital?: number;
  /** If true, size fractions multiply *current* portfolio equity; if false, only initial capital. */
  compounding?: boolean;
};

/**
 * DCA-aware simulator. Each Signal's `sizeFraction` is applied to either current equity (compounding)
 * or the initial capital. Buys add units, sells reduce units (clipped at zero — no shorting here).
 * `kind: "exit"` is treated as a sell; `kind: "short"` is ignored (this script never shorts).
 */
export function simulate(
  bars: Bar[],
  signals: Signal[],
  opts: SimulateOptions = {},
): BacktestStats {
  const initialCapital = opts.initialCapital ?? 10_000;
  const compounding = opts.compounding ?? true;

  const sigByBar = new Map<number, Signal[]>();
  for (const s of signals) {
    const arr = sigByBar.get(s.barIndex) ?? [];
    arr.push(s);
    sigByBar.set(s.barIndex, arr);
  }

  let cash = initialCapital;
  let units = 0;
  let costBasis = 0; // total cash spent on units currently held (FIFO-ish for win/loss accounting)
  const trades: Trade[] = [];
  const equityCurve: { t: number; equity: number }[] = [];
  let peak = initialCapital;
  let maxDD = 0;
  let wins = 0, sells = 0;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]!;
    const sigs = sigByBar.get(i) ?? [];

    for (const s of sigs) {
      const equity = cash + units * bar.c;
      const baseCapital = compounding ? equity : initialCapital;
      const frac = s.sizeFraction ?? 1;

      if (s.kind === "long") {
        const spend = baseCapital * frac;
        if (spend <= 0 || cash <= 0) continue;
        const actual = Math.min(spend, cash);
        const u = actual / bar.c;
        cash -= actual;
        units += u;
        costBasis += actual;
        trades.push({ kind: "buy", time: bar.t, price: bar.c, units: u, cashDelta: -actual, tag: s.tag });
      } else if (s.kind === "exit") {
        if (units <= 0) continue;
        // Pine's `qty = tradingCapital / close * 0.5` translates to "sell units worth 50% of capital".
        const targetCash = baseCapital * frac;
        const targetUnits = Math.min(units, targetCash / bar.c);
        const proceeds = targetUnits * bar.c;
        const avgCost = units > 0 ? costBasis / units : 0;
        const costOut = avgCost * targetUnits;
        cash += proceeds;
        units -= targetUnits;
        costBasis -= costOut;
        if (units < 1e-12) { units = 0; costBasis = 0; }
        sells++;
        if (proceeds > costOut) wins++;
        trades.push({ kind: "sell", time: bar.t, price: bar.c, units: targetUnits, cashDelta: proceeds, tag: s.tag });
      }
    }

    const equity = cash + units * bar.c;
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? (peak - equity) / peak : 0;
    if (dd > maxDD) maxDD = dd;
    equityCurve.push({ t: bar.t, equity });
  }

  const finalEquity = bars.length ? cash + units * bars[bars.length - 1]!.c : initialCapital;
  return {
    trades,
    initialCapital,
    finalEquity,
    totalReturnPct: (finalEquity - initialCapital) / initialCapital,
    winRate: sells > 0 ? wins / sells : 0,
    maxDrawdownPct: maxDD,
    equityCurve,
  };
}
