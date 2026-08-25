import { describe, expect, it } from "vitest";
import { changeFromPct } from "./change";

describe("changeFromPct", () => {
  it("works backwards from the value on screen", () => {
    // Worth 52,110 after rising 5.2% => it was 49,534.22, so 2,575.78 was made.
    expect(changeFromPct(52_110, 5.2)).toBeCloseTo(2_575.78, 2);
  });

  it("is negative when the price fell", () => {
    // Worth 900 after falling 10% => it was 1,000.
    expect(changeFromPct(900, -10)).toBeCloseTo(-100, 6);
  });

  it("is zero for no move", () => {
    expect(changeFromPct(1_234.56, 0)).toBe(0);
  });

  it("round-trips against the forward calculation", () => {
    // The property that matters: before * (1 + pct/100) === value.
    for (const [value, pct] of [[52_110, 5.2], [900, -10], [1, 0.01], [1e6, 250]] as const) {
      const delta = changeFromPct(value, pct)!;
      expect((value - delta) * (1 + pct / 100)).toBeCloseTo(value, 6);
    }
  });

  it("declines to divide by zero on a total wipeout", () => {
    // -100% means it was worth infinitely more, which is not a figure.
    expect(changeFromPct(0, -100)).toBeNull();
    expect(changeFromPct(500, -100)).toBeNull();
    expect(changeFromPct(500, -140)).toBeNull();
  });

  it("declines when either input is missing or not a number", () => {
    expect(changeFromPct(null, 5)).toBeNull();
    expect(changeFromPct(500, null)).toBeNull();
    expect(changeFromPct(NaN, 5)).toBeNull();
    expect(changeFromPct(500, Infinity)).toBeNull();
  });
});
