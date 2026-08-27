import { describe, it, expect } from "vitest";
import { shapePoints, thin, thinKeepingExtremes, targetPoints, type Pt, valueAtNearest } from "./chart-data";

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

describe("shapePoints", () => {
  it("stays between twenty and forty at any width", () => {
    for (const w of [200, 390, 640, 960, 1600, 4000]) {
      const n = shapePoints(w);
      expect(n).toBeGreaterThanOrEqual(20);
      expect(n).toBeLessThanOrEqual(40);
    }
  });

  it("is coarser than the record budget, which is the whole point", () => {
    expect(shapePoints(960)).toBeLessThan(targetPoints(960));
  });
});

describe("thinKeepingExtremes", () => {
  // A peak one bucket wide is exactly what averaging destroys.
  const spike: Pt[] = Array.from({ length: 200 }, (_, i) => ({
    t: i * 1000,
    v: i === 137 ? 9999 : 100 + (i % 7),
  }));

  it("keeps a peak that plain thinning averages away", () => {
    const plain = thin(spike, 20);
    const kept = thinKeepingExtremes(spike, 20);
    expect(Math.max(...plain.map((p) => p.v))).toBeLessThan(9999);
    expect(Math.max(...kept.map((p) => p.v))).toBe(9999);
  });

  it("keeps the low as well, at its own timestamp", () => {
    const dip: Pt[] = spike.map((p, i) => (i === 42 ? { t: p.t, v: -5 } : p));
    const kept = thinKeepingExtremes(dip, 20);
    const low = kept.find((p) => p.v === -5);
    expect(low?.t).toBe(42 * 1000);
  });

  it("stays in time order", () => {
    const kept = thinKeepingExtremes(spike, 20);
    const times = kept.map((p) => p.t);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("leaves a series shorter than the target alone", () => {
    const few: Pt[] = [{ t: 1, v: 1 }, { t: 2, v: 3 }, { t: 3, v: 2 }];
    expect(thinKeepingExtremes(few, 20)).toEqual(few);
  });

  it("does not duplicate a flat series' single extreme", () => {
    const flat: Pt[] = Array.from({ length: 100 }, (_, i) => ({ t: i, v: 7 }));
    const kept = thinKeepingExtremes(flat, 20);
    expect(new Set(kept.map((p) => p.t)).size).toBe(kept.length);
  });
});

describe("valueAtNearest", () => {
  const pts = [{ t: 100, v: 1 }, { t: 200, v: 2 }, { t: 300, v: 3 }];

  it("finds an exact hit", () => {
    expect(valueAtNearest(pts, 200)).toBe(2);
  });

  it("takes the closer of the two neighbours", () => {
    expect(valueAtNearest(pts, 140)).toBe(1);
    expect(valueAtNearest(pts, 160)).toBe(2);
  });

  it("clamps to the ends rather than returning nothing", () => {
    expect(valueAtNearest(pts, 0)).toBe(1);
    expect(valueAtNearest(pts, 9_999)).toBe(3);
  });

  it("has nothing to say about an empty series", () => {
    expect(valueAtNearest([], 100)).toBeNull();
  });

  it("answers for a series whose own points are nowhere near the asked time", () => {
    // The case this exists for: the crosshair snapped to the *other* line's
    // point, so this one is being asked about a moment it has no sample at.
    expect(valueAtNearest([{ t: 0, v: 7 }, { t: 1_000, v: 9 }], 480)).toBe(7);
  });
});
