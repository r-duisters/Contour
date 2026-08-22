import type { Bar, Signal } from "../types";
import { sma, stdev } from "./primitives";
import { dailyToWeekly, projectWeeklyOntoDaily } from "./resample";

/**
 * Port of Oakley Wood's "Risk Metric Strategy" (PineScript v5).
 *
 *   riskMetric = mean of three sub-metrics, all expected in [0, 1]:
 *     riskOne   = ((close - sma(close, 1460)) / stdev(close, 1460)) / maxRiskOne
 *     riskTwo   = (ln(close / w20_sma) + minRiskTwo) / maxRiskTwo
 *     riskThree = (sma(close, 50) / sma(close_weekly, 50)) / maxRiskThree
 *
 * The original `maxRiskN` / `minRiskN` are hard-coded functions of bar open-time-in-ms — kept
 * verbatim so values line up with TradingView. The strategy expects DAILY bars; weekly closes
 * are derived by resampling daily bars (Monday anchor, matching Binance).
 *
 * Signals are latched DCA buys at riskMetric < 0.30 / 0.25 / 0.20 / 0.10 (size fractions
 * 0.30 / 0.30 / 0.40 / 0.80 of available capital) and tiered sells at > 0.80 / 0.90 / 0.95
 * (size fraction 0.50 of current position). A sell resets all buy latches and vice-versa.
 */

export type IndicatorParams = {
  /** Buy threshold for plotting (does not affect signals — those use the script's fixed levels). */
  buyLimit?: number;
  /** Sell threshold for plotting. */
  sellLimit?: number;
};

export type IndicatorResult = {
  signals: Signal[];
  series: {
    riskMetric: number[];
    riskOne: number[];
    riskTwo: number[];
    riskThree: number[];
  };
};

export function run(bars: Bar[], _params: IndicatorParams = {}): IndicatorResult {
  const n = bars.length;
  const closes = bars.map((b) => b.c);
  const times = bars.map((b) => b.t);

  // Daily sub-series (Pine's `request.security(..., "D", ...)` on a daily chart is identity).
  const d1460_sma = sma(closes, 1460);
  const d1460_stdev = stdev(closes, 1460);
  const d50_sma = sma(closes, 50);

  // Weekly sub-series via resampling.
  const weekly = dailyToWeekly(bars);
  const wCloses = weekly.map((b) => b.c);
  const w20_sma_w = sma(wCloses, 20);
  const w50_sma_w = sma(wCloses, 50);
  const w20_sma = projectWeeklyOntoDaily(bars, weekly, w20_sma_w);
  const w50_sma = projectWeeklyOntoDaily(bars, weekly, w50_sma_w);

  const riskOne = new Array<number>(n).fill(NaN);
  const riskTwo = new Array<number>(n).fill(NaN);
  const riskThree = new Array<number>(n).fill(NaN);
  const riskMetric = new Array<number>(n).fill(NaN);

  for (let i = 0; i < n; i++) {
    const t = times[i]!;
    const ln_t = Math.log(t);

    // Hard-coded "max risk" curves — kept verbatim from the Pine source.
    const maxRiskOne = -38.12 * ln_t + 1078.5;
    const minRiskTwo = -3.719 * ln_t + 105;
    const maxRiskTwo = -6e-12 * t + 10.93;
    const maxRiskThree = -12.55 * ln_t + 355.15;

    const c = closes[i]!;
    if (Number.isFinite(d1460_sma[i]) && Number.isFinite(d1460_stdev[i])) {
      riskOne[i] = ((c - d1460_sma[i]!) / d1460_stdev[i]!) / maxRiskOne;
    }
    if (Number.isFinite(w20_sma[i]) && w20_sma[i]! > 0 && c > 0) {
      riskTwo[i] = (Math.log(c / w20_sma[i]!) + minRiskTwo) / maxRiskTwo;
    }
    if (Number.isFinite(d50_sma[i]) && Number.isFinite(w50_sma[i]) && w50_sma[i]! > 0) {
      riskThree[i] = (d50_sma[i]! / w50_sma[i]!) / maxRiskThree;
    }
    if (Number.isFinite(riskOne[i]) && Number.isFinite(riskTwo[i]) && Number.isFinite(riskThree[i])) {
      riskMetric[i] = (riskOne[i]! + riskTwo[i]! + riskThree[i]!) / 3;
    }
  }

  // Latched DCA signal logic, mirroring the Pine state machine.
  let filled30 = false, filled25 = false, filled20 = false, filled10 = false;
  let sold80 = false, sold90 = false;
  const signals: Signal[] = [];

  const resetBuyLatches = () => { filled30 = filled25 = filled20 = filled10 = false; };
  const resetSellLatches = () => { sold80 = sold90 = false; };

  for (let i = 0; i < n; i++) {
    const r = riskMetric[i];
    if (!Number.isFinite(r)) continue;
    const price = closes[i]!;
    const time = times[i]!;

    // Buys — strongest signal first so the strictest threshold wins on the same bar.
    if (r! < 0.10 && !filled10) {
      signals.push({ barIndex: i, barTime: time, kind: "long", price, sizeFraction: 0.80, tag: "risk<0.10" });
      filled10 = true; resetSellLatches();
    } else if (r! < 0.20 && !filled20) {
      signals.push({ barIndex: i, barTime: time, kind: "long", price, sizeFraction: 0.40, tag: "risk<0.20" });
      filled20 = true; resetSellLatches();
    } else if (r! < 0.25 && !filled25) {
      signals.push({ barIndex: i, barTime: time, kind: "long", price, sizeFraction: 0.30, tag: "risk<0.25" });
      filled25 = true; resetSellLatches();
    } else if (r! < 0.30 && !filled30) {
      signals.push({ barIndex: i, barTime: time, kind: "long", price, sizeFraction: 0.30, tag: "risk<0.30" });
      filled30 = true; resetSellLatches();
    }

    // Sells — latched at >0.80 and >0.90; the >0.95 tier fires every bar above that level.
    if (r! > 0.80 && !sold80) {
      signals.push({ barIndex: i, barTime: time, kind: "exit", price, sizeFraction: 0.50, tag: "risk>0.80" });
      sold80 = true; resetBuyLatches();
    }
    if (r! > 0.90 && !sold90) {
      signals.push({ barIndex: i, barTime: time, kind: "exit", price, sizeFraction: 0.50, tag: "risk>0.90" });
      sold90 = true; resetBuyLatches();
    }
    if (r! > 0.95) {
      signals.push({ barIndex: i, barTime: time, kind: "exit", price, sizeFraction: 0.50, tag: "risk>0.95" });
      resetBuyLatches();
    }
  }

  return {
    signals,
    series: { riskMetric, riskOne, riskTwo, riskThree },
  };
}
