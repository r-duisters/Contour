import { describe, expect, it } from "vitest";
import { changeFromPct, positionChangeOverWindow } from "./change";

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

describe("positionChangeOverWindow", () => {
  const HELD_SINCE = Date.parse("2026-01-23T00:00:00Z");

  it("keeps the figure for a window the position lived through", () => {
    expect(positionChangeOverWindow({
      value: 1325, pct: -10,
      heldSince: HELD_SINCE, windowStart: Date.parse("2026-06-01T00:00:00Z"),
    })).toBeCloseTo(-147.22, 2);
  });

  it("withholds it for a window that began before the position did", () => {
    // 250 Ubisoft shares bought in January 2026, shown against the price back
    // to 2000, read as a €4,288 loss beside a €1,000 cost basis. That money
    // was never at stake.
    expect(positionChangeOverWindow({
      value: 1325, pct: -76.41,
      heldSince: HELD_SINCE, windowStart: Date.parse("2000-01-01T00:00:00Z"),
    })).toBeNull();
  });

  it("shows it when a bound is unknown, which cannot disprove anything", () => {
    expect(positionChangeOverWindow({
      value: 1325, pct: -10, heldSince: null, windowStart: 0,
    })).toBeCloseTo(-147.22, 2);
    expect(positionChangeOverWindow({
      value: 1325, pct: -10, heldSince: HELD_SINCE, windowStart: null,
    })).toBeCloseTo(-147.22, 2);
  });

  it("still refuses what changeFromPct refuses", () => {
    expect(positionChangeOverWindow({
      value: 500, pct: -100, heldSince: null, windowStart: null,
    })).toBeNull();
  });
});
