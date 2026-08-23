import { describe, expect, it } from "vitest";
import {
  readCachedValuation, valuationKey, writeCachedValuation, type KeyValueStore,
} from "./valuation-cache";

function memory(seed: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...seed };
  return {
    data,
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => { data[k] = v; },
  };
}

/** A store that throws the way a browser in private mode does. */
const hostile: KeyValueStore = {
  getItem() { throw new Error("blocked"); },
  setItem() { throw new Error("blocked"); },
};

describe("valuation cache", () => {
  it("round-trips a valuation with the time it was taken", () => {
    const store = memory();
    writeCachedValuation(store, "p1", { totals: { costBasis: 10 } }, 1_700_000_000_000);
    expect(readCachedValuation(store, "p1")).toEqual({
      at: 1_700_000_000_000, valuation: { totals: { costBasis: 10 } },
    });
  });

  it("keeps one entry per portfolio", () => {
    const store = memory();
    writeCachedValuation(store, "p1", { n: 1 }, 1);
    writeCachedValuation(store, "p2", { n: 2 }, 2);
    expect(readCachedValuation<{ n: number }>(store, "p1")?.valuation.n).toBe(1);
    expect(readCachedValuation<{ n: number }>(store, "p2")?.valuation.n).toBe(2);
  });

  it("answers null for a portfolio never cached", () => {
    expect(readCachedValuation(memory(), "nobody")).toBeNull();
  });

  it("answers null rather than throwing on a corrupt entry", () => {
    expect(readCachedValuation(memory({ "valuation:p1": "{not json" }), "p1")).toBeNull();
  });

  it("answers null on an entry shaped by an older version", () => {
    // The whole valuation, written without the { at, valuation } envelope.
    expect(readCachedValuation(memory({ "valuation:p1": '{"totals":{}}' }), "p1")).toBeNull();
  });

  it("survives storage that throws, in both directions", () => {
    expect(readCachedValuation(hostile, "p1")).toBeNull();
    expect(() => writeCachedValuation(hostile, "p1", { n: 1 }, 1)).not.toThrow();
  });

  /** Renaming this strands every entry already written. See the source. */
  it("keys entries by the spelling already in the field", () => {
    expect(valuationKey("abc")).toBe("valuation:abc");
  });
});
