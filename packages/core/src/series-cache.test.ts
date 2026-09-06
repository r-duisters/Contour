import { describe, expect, it } from "vitest";
import { readCachedSeries, seriesKey, writeCachedSeries, forgetSeries } from "./series-cache";
import { forgetPortfolio, type KeyValueStore } from "./valuation-cache";

function memory(seed: Record<string, string> = {}) {
  const data = { ...seed };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k]! : null),
    setItem: (k: string, v: string) => { data[k] = v; },
    removeItem: (k: string) => { delete data[k]; },
  };
}

/** A store that throws the way a browser in private mode does. */
const hostile: KeyValueStore = {
  getItem() { throw new Error("blocked"); },
  setItem() { throw new Error("blocked"); },
};

const LINE = [{ t: 1, value: 100 }, { t: 2, value: 110 }];
const CHANGE = { abs: 10, pct: 10 };

describe("series cache", () => {
  it("round-trips a series with its change and the time it was drawn", () => {
    const store = memory();
    writeCachedSeries(store, "p1", "1m", LINE, CHANGE, 1_700_000_000_000);
    expect(readCachedSeries(store, "p1", "1m")).toEqual({
      at: 1_700_000_000_000, series: LINE, change: CHANGE,
    });
  });

  it("keeps ranges apart — a 1M line under a 1Y button is a mislabelled chart", () => {
    const store = memory();
    writeCachedSeries(store, "p1", "1m", LINE, CHANGE, 1);
    expect(readCachedSeries(store, "p1", "1y")).toBeNull();
  });

  it("answers null for a malformed or missing entry rather than throwing", () => {
    expect(readCachedSeries(memory(), "p1", "1m")).toBeNull();
    expect(readCachedSeries(memory({ [seriesKey("p1", "1m")]: "{not json" }), "p1", "1m")).toBeNull();
    expect(readCachedSeries(memory({ [seriesKey("p1", "1m")]: '{"at":"x"}' }), "p1", "1m")).toBeNull();
  });

  it("survives a store that throws, because caching is an optimisation", () => {
    expect(() => writeCachedSeries(hostile, "p1", "1m", LINE, CHANGE, 1)).not.toThrow();
    expect(readCachedSeries(hostile, "p1", "1m")).toBeNull();
  });

  it("forgets every range for one portfolio and no other's", () => {
    const store = memory();
    writeCachedSeries(store, "dead", "1m", LINE, CHANGE, 1);
    writeCachedSeries(store, "dead", "all", LINE, CHANGE, 1);
    writeCachedSeries(store, "alive", "1m", LINE, CHANGE, 1);
    forgetSeries(store, "dead");
    expect(readCachedSeries(store, "dead", "1m")).toBeNull();
    expect(readCachedSeries(store, "dead", "all")).toBeNull();
    expect(readCachedSeries(store, "alive", "1m")).not.toBeNull();
  });

  it("is cleared by forgetPortfolio alongside the valuation", () => {
    // Deleting a portfolio drops everything remembered about it in one call —
    // a cached line for a deleted portfolio is as wrong as its cached total.
    const store = memory();
    writeCachedSeries(store, "dead", "1y", LINE, CHANGE, 1);
    forgetPortfolio(store, "dead", "last");
    expect(readCachedSeries(store, "dead", "1y")).toBeNull();
  });
});
