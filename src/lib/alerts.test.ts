import { describe, expect, it } from "vitest";
import { evaluatePctMove, evaluatePriceTarget, utcDayOpen } from "./alerts";

describe("evaluatePriceTarget", () => {
  it("fires above when the live price reaches the target", () => {
    expect(evaluatePriceTarget({ direction: "above", price: 100 }, 100)).toBe(true);
    expect(evaluatePriceTarget({ direction: "above", price: 100 }, 150)).toBe(true);
    expect(evaluatePriceTarget({ direction: "above", price: 100 }, 99.9)).toBe(false);
  });

  it("fires below when the live price reaches the target", () => {
    expect(evaluatePriceTarget({ direction: "below", price: 100 }, 100)).toBe(true);
    expect(evaluatePriceTarget({ direction: "below", price: 100 }, 50)).toBe(true);
    expect(evaluatePriceTarget({ direction: "below", price: 100 }, 100.1)).toBe(false);
  });
});

describe("evaluatePctMove", () => {
  it("fires on a move at or beyond the threshold, either direction", () => {
    expect(evaluatePctMove({ threshold: 5 }, 100, 105)).toEqual({ direction: "up", pct: 5 });
    expect(evaluatePctMove({ threshold: 5 }, 100, 94)).toEqual({ direction: "down", pct: -6 });
  });

  it("stays quiet below the threshold", () => {
    expect(evaluatePctMove({ threshold: 5 }, 100, 104.9)).toBeNull();
    expect(evaluatePctMove({ threshold: 5 }, 100, 95.2)).toBeNull();
  });

  it("returns null for a non-positive previous close", () => {
    expect(evaluatePctMove({ threshold: 5 }, 0, 100)).toBeNull();
    expect(evaluatePctMove({ threshold: 5 }, NaN, 100)).toBeNull();
  });
});

describe("utcDayOpen", () => {
  it("truncates to the UTC day boundary", () => {
    const noon = Date.UTC(2026, 0, 15, 12, 34, 56);
    expect(utcDayOpen(noon)).toBe(Date.UTC(2026, 0, 15));
    expect(utcDayOpen(Date.UTC(2026, 0, 15))).toBe(Date.UTC(2026, 0, 15));
  });
});
