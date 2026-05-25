export type Bar = {
  t: number; // open time in ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

export type Timeframe =
  | "1m" | "3m" | "5m" | "15m" | "30m"
  | "1h" | "2h" | "4h" | "6h" | "8h" | "12h"
  | "1d" | "3d" | "1w" | "1M";

export type Signal = {
  barIndex: number;
  barTime: number;
  kind: "long" | "short" | "exit";
  price: number;
  /**
   * Fraction of current portfolio value to allocate (buy) or de-allocate (sell/exit) at this signal.
   * 0 < sizeFraction <= 1. When omitted, the simulator treats the signal as full-position long/short.
   */
  sizeFraction?: number;
  /** Free-form label so the UI/log can show *which* condition fired (e.g. "risk<0.10", "risk>0.95"). */
  tag?: string;
  meta?: Record<string, unknown>;
};
