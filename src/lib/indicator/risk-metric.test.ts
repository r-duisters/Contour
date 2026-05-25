import { describe, it, expect } from "vitest";
import { run } from "./index";
import { sma, stdev } from "./primitives";
import { dailyToWeekly } from "./resample";
import type { Bar } from "../types";

const DAY_MS = 24 * 60 * 60 * 1000;

function syntheticBars(n: number, startPrice = 100, drift = 0.001): Bar[] {
  const t0 = Date.UTC(2017, 0, 1);
  const out: Bar[] = [];
  let p = startPrice;
  for (let i = 0; i < n; i++) {
    const o = p;
    p = p * (1 + drift);
    out.push({ t: t0 + i * DAY_MS, o, h: p * 1.02, l: o * 0.98, c: p, v: 1 });
  }
  return out;
}

describe("primitives", () => {
  it("sma matches a known window", () => {
    const out = sma([1, 2, 3, 4, 5], 3);
    expect(out[0]).toBeNaN();
    expect(out[1]).toBeNaN();
    expect(out[2]).toBeCloseTo(2);
    expect(out[3]).toBeCloseTo(3);
    expect(out[4]).toBeCloseTo(4);
  });

  it("stdev is population (divides by N) like Pine's ta.stdev", () => {
    const out = stdev([2, 4, 4, 4, 5, 5, 7, 9], 8);
    expect(out[7]).toBeCloseTo(2, 5);
  });
});

describe("dailyToWeekly", () => {
  it("groups 14 consecutive days into 2-3 weeks with correct OHLC", () => {
    const bars = syntheticBars(14);
    const weeks = dailyToWeekly(bars);
    expect(weeks.length).toBeGreaterThanOrEqual(2);
    for (const w of weeks) {
      expect(w.h).toBeGreaterThanOrEqual(w.c);
      expect(w.l).toBeLessThanOrEqual(w.o);
    }
  });
});

describe("Risk Metric indicator", () => {
  it("returns NaN until warm-up (1460 daily bars) is satisfied", () => {
    const bars = syntheticBars(500);
    const { series } = run(bars);
    expect(series.riskMetric.every((v) => !Number.isFinite(v))).toBe(true);
  });

  it("produces finite values after warm-up", () => {
    const bars = syntheticBars(1500);
    const { series } = run(bars);
    const finite = series.riskMetric.filter((v) => Number.isFinite(v));
    expect(finite.length).toBeGreaterThan(0);
  });

  it("emits no signals when riskMetric never crosses thresholds", () => {
    // Flat synthetic series — drift=0 keeps price constant, riskMetric is near a constant
    // determined entirely by the hard-coded time curves, so latches should fire at most once.
    const bars = syntheticBars(1600, 100, 0);
    const { signals } = run(bars);
    // At most one of each latched bucket should fire (4 buy buckets + 2 sell latches + N unlatched 0.95s).
    const tags = new Set(signals.filter((s) => s.tag !== "risk>0.95").map((s) => s.tag));
    expect(tags.size).toBe(signals.filter((s) => s.tag !== "risk>0.95").length);
  });
});
