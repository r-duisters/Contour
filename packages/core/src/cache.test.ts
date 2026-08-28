import { describe, expect, it } from "vitest";
import { attachCacheStore, cacheSize, cached, detachCacheStore, invalidate } from "./cache";

describe("cached, on a process that does not restart", () => {
  it("stays bounded as time-bucketed keys accumulate", async () => {
    // The server this was written for restarts; an Android process lives for
    // weeks, and every hour adds keys that can never be read again. Without a
    // bound this grows for as long as the app is installed.
    invalidate();
    for (let i = 0; i < 2_500; i++) await cached(`bucket:${i}`, 60_000, async () => i);
    expect(cacheSize()).toBeLessThanOrEqual(1000);
  });

  it("takes the entries closest to expiry, not whatever the Map iterates first", async () => {
    invalidate();
    // Written first, so insertion order would evict it — but it outlives
    // everything, which for time-bucketed keys is what "still wanted" means.
    await cached("long-lived", 600_000, async () => "fresh");
    for (let i = 0; i < 1_200; i++) await cached(`filler:${i}`, 60_000, async () => i);
    expect(await cached("long-lived", 600_000, async () => "recomputed")).toBe("fresh");
    expect(cacheSize()).toBeLessThanOrEqual(1000);
    invalidate();
  });
});

/**
 * A phone's process is killed whenever Android decides to, so every launch is
 * a cold start. Without this, each one re-fetched everything the last had —
 * including a three-year daily FX series, which is history and cannot change.
 */
describe("cached, across a restart", () => {
  const memory = () => {
    const held = new Map<string, string>();
    return {
      getItem: (k: string) => held.get(k) ?? null,
      setItem: (k: string, v: string) => { held.set(k, v); },
      removeItem: (k: string) => { held.delete(k); },
      held,
    };
  };

  it("answers from the previous run without asking again", async () => {
    const store = memory();
    invalidate();
    attachCacheStore(store);
    await cached("fx:2024", 60_000, async () => "rates");

    // A new process: the Map is empty and only the store survives.
    detachCacheStore();
    invalidate();
    attachCacheStore(store);

    let asked = false;
    const value = await cached("fx:2024", 60_000, async () => { asked = true; return "refetched"; });
    expect(value).toBe("rates");
    expect(asked).toBe(false);
    detachCacheStore();
    invalidate();
  });

  it("does not resurrect an entry whose time was up", async () => {
    // A TTL means the same thing across a restart as within one; yesterday's
    // prices coming back to life would be worse than an empty cache.
    const store = memory();
    invalidate();
    attachCacheStore(store);
    await cached("price:BTC", 1_000, async () => 100);

    detachCacheStore();
    invalidate();
    attachCacheStore(store, Date.now() + 60_000);

    let asked = false;
    const value = await cached("price:BTC", 1_000, async () => { asked = true; return 200; });
    expect(asked).toBe(true);
    expect(value).toBe(200);
    detachCacheStore();
    invalidate();
  });

  it("survives a store holding something it cannot read", async () => {
    const store = memory();
    store.setItem("contour:cache", "{not json");
    invalidate();
    expect(() => attachCacheStore(store)).not.toThrow();
    expect(await cached("k", 1_000, async () => "fresh")).toBe("fresh");
    detachCacheStore();
    invalidate();
  });
});

/**
 * The regression that made a portfolio screen render nothing but its
 * transaction count.
 *
 * `fetchEcbRates` caches a `Map<number, number>`, and plain JSON destroys a Map
 * more quietly than almost anything else: `JSON.stringify(new Map([[1, 2]]))`
 * is `"{}"`. After a restart the rates came back as an empty object with no
 * `.get`, so every valuation threw and the screen fell back to showing
 * nothing at all.
 */
describe("what survives being written down", () => {
  const memory = () => {
    const held = new Map<string, string>();
    return {
      getItem: (k: string) => held.get(k) ?? null,
      setItem: (k: string, v: string) => { held.set(k, v); },
      removeItem: (k: string) => { held.delete(k); },
      held,
    };
  };

  it("brings a Map back as a Map, with its entries", async () => {
    const store = memory();
    invalidate();
    attachCacheStore(store);
    await cached("ecb", 60_000, async () => new Map([[1, 0.9], [2, 0.91]]));

    detachCacheStore();
    invalidate();
    attachCacheStore(store);

    const rates = await cached<Map<number, number>>("ecb", 60_000, async () => new Map());
    expect(rates).toBeInstanceOf(Map);
    expect(rates.get(2)).toBe(0.91);
    detachCacheStore();
    invalidate();
  });

  it("brings a Set back as a Set", async () => {
    const store = memory();
    invalidate();
    attachCacheStore(store);
    await cached("symbols", 60_000, async () => new Set(["BTCUSDT"]));

    detachCacheStore();
    invalidate();
    attachCacheStore(store);

    const symbols = await cached<Set<string>>("symbols", 60_000, async () => new Set());
    expect(symbols).toBeInstanceOf(Set);
    expect(symbols.has("BTCUSDT")).toBe(true);
    detachCacheStore();
    invalidate();
  });

  it("throws away a blob written by an older version", async () => {
    // This is what heals a device that already holds one: version 1 stored a
    // Map as `{}`, and reading it back is what broke the valuation.
    const store = memory();
    store.setItem("contour:cache", JSON.stringify({ "ecb": { value: {}, expires: Date.now() + 60_000 } }));
    invalidate();
    attachCacheStore(store);

    let asked = false;
    const rates = await cached<Map<number, number>>("ecb", 60_000, async () => {
      asked = true;
      return new Map([[1, 0.9]]);
    });
    expect(asked).toBe(true);
    expect(rates).toBeInstanceOf(Map);
    detachCacheStore();
    invalidate();
  });
});
