import { describe, it, expect } from "vitest";
import {
  RANGES, RANGE_KEYS, EVERYDAY_RANGES, PERFORMANCE_RANGES, hiddenOnPhone, rangeLabel, type RangeKey,
} from "./ranges";

describe("ranges", () => {
  it("has unique keys and no gaps between keys and labels", () => {
    expect(new Set(RANGE_KEYS).size).toBe(RANGES.length);
    for (const r of RANGES) {
      expect(r.label.length).toBeGreaterThan(0);
      expect(r.long.length).toBeGreaterThan(0);
    }
  });

  it("orders periods from shortest to longest", () => {
    expect(RANGE_KEYS).toEqual(["1d", "1w", "1m", "ytd", "1y", "2y", "5y", "all"]);
  });

  it("only offers subsets that exist in the canonical list", () => {
    for (const subset of [EVERYDAY_RANGES, PERFORMANCE_RANGES]) {
      for (const k of subset) expect(RANGE_KEYS).toContain(k);
    }
  });

  it("excludes day and week from performance, where a time-weighted return says nothing", () => {
    expect(PERFORMANCE_RANGES).not.toContain("1d");
    expect(PERFORMANCE_RANGES).not.toContain("1w");
  });

  it("keeps every performance period reachable — everyday plus the rest covers the subset", () => {
    // A period offered by a screen but in neither group would be unreachable
    // on a phone, since only non-everyday periods hide behind More.
    for (const k of PERFORMANCE_RANGES) expect(RANGE_KEYS).toContain(k);
  });

  it("labels short by default and long on request", () => {
    expect(rangeLabel("ytd")).toBe("YTD");
    expect(rangeLabel("ytd", true)).toBe("Year to date");
    expect(rangeLabel("all")).toBe("All");
  });

  it("falls back to the key rather than throwing on an unknown period", () => {
    expect(rangeLabel("7y" as RangeKey)).toBe("7y");
  });
});

describe("hiddenOnPhone", () => {
  it("keeps the everyday periods visible", () => {
    for (const k of EVERYDAY_RANGES) expect(hiddenOnPhone(k, "1d")).toBe(false);
  });

  it("collapses the rest behind More", () => {
    expect(hiddenOnPhone("ytd", "1d")).toBe(true);
    expect(hiddenOnPhone("2y", "1d")).toBe(true);
    expect(hiddenOnPhone("5y", "1d")).toBe(true);
  });

  it("never hides the selected period, even when it is a collapsed one", () => {
    // Otherwise the row shows no active button at all, which reads as a bug.
    expect(hiddenOnPhone("5y", "5y")).toBe(false);
    expect(hiddenOnPhone("2y", "2y")).toBe(false);
  });

  it("leaves at least one visible period on the performance subset", () => {
    for (const selected of PERFORMANCE_RANGES) {
      const visible = PERFORMANCE_RANGES.filter((k) => !hiddenOnPhone(k, selected));
      expect(visible.length).toBeGreaterThan(0);
      expect(visible).toContain(selected);
    }
  });
});
