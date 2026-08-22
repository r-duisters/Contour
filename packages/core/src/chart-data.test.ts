import { describe, it, expect } from "vitest";
import { thin, targetPoints, type Pt } from "./chart-data";

const ramp = (n: number): Pt[] =>
  Array.from({ length: n }, (_, i) => ({ t: i * 1000, v: i }));

describe("thin", () => {
  it("leaves a series shorter than the target untouched", () => {
    const p = ramp(10);
    expect(thin(p, 50)).toBe(p);
  });

  it("never exceeds the target", () => {
    for (const target of [2, 5, 40, 200]) {
      expect(thin(ramp(2500), target).length).toBeLessThanOrEqual(target);
    }
  });

  it("keeps the first and last observations exactly", () => {
    const p = ramp(2500);
    const out = thin(p, 100);
    expect(out[0]).toEqual(p[0]);
    expect(out[out.length - 1]).toEqual(p[p.length - 1]);
  });

  it("preserves the endpoint even when it is a spike", () => {
    const p = [...ramp(500), { t: 500_000, v: 9999 }];
    const out = thin(p, 50);
    expect(out[out.length - 1]!.v).toBe(9999);
  });

  it("averages within buckets rather than sampling", () => {
    // Alternating 0/100 averages to 50; decimation would return 0s and 100s.
    const p: Pt[] = Array.from({ length: 402 }, (_, i) => ({ t: i, v: i % 2 === 0 ? 0 : 100 }));
    const out = thin(p, 12);
    for (const q of out.slice(1, -1)) expect(q.v).toBeGreaterThan(20);
    for (const q of out.slice(1, -1)) expect(q.v).toBeLessThan(80);
  });

  it("keeps time strictly increasing", () => {
    const out = thin(ramp(2500), 173);
    for (let i = 1; i < out.length; i++) expect(out[i]!.t).toBeGreaterThan(out[i - 1]!.t);
  });

  it("holds the average of the whole series roughly steady", () => {
    const p = ramp(2000);
    const out = thin(p, 200);
    const mean = (xs: Pt[]) => xs.reduce((a, b) => a + b.v, 0) / xs.length;
    expect(Math.abs(mean(out) - mean(p))).toBeLessThan(5);
  });
});

describe("targetPoints", () => {
  it("scales with width inside sane bounds", () => {
    expect(targetPoints(360)).toBe(120);
    expect(targetPoints(20)).toBe(40);
    expect(targetPoints(4000)).toBe(400);
  });
});
