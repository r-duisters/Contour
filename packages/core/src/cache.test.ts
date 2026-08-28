import { describe, expect, it } from "vitest";
import { cacheSize, cached, invalidate } from "./cache";

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
