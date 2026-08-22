import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "../testing/memory-store";
import { FakeNet, rejectWith, respondWith } from "../testing/fake-net";
import { invalidate } from "@/core/cache";
import { displayContext, displayContextAt } from "./pricing";

const EURUSD = "https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD";
// The dated endpoint, whose whole point is that it is *not* the latest one.
const ECB_RANGE = "https://api.frankfurter.dev/v1/2025-12-22..2026-01-02?base=USD&symbols=EUR";
const AT = Date.parse("2026-01-01T00:00:00Z");

// sources/fx memoises through packages/core/src/cache.ts, a map shared by
// every test in the process; two cases asking for the same pair would
// otherwise see whichever rate ran first.
beforeEach(() => invalidate());

describe("displayContext", () => {
  it("USD settings need no rate lookup: currency USD, toDisplay 1, displayUsd 1", async () => {
    const store = MemoryStore({ settings: { displayCurrency: "USD" } });
    const net = FakeNet({ [EURUSD]: { rates: { USD: 999 } } });

    const ctx = await displayContext(store, net);

    expect(ctx.currency).toBe("USD");
    expect(ctx.toDisplay).toBe(1);
    expect(ctx.displayUsd).toBe(1);
    expect(net.calls).toEqual([]);
  });

  it("EUR settings convert at the fetched rate: displayUsd 1.08, toDisplay 1/1.08", async () => {
    const store = MemoryStore({ settings: { displayCurrency: "EUR" } });
    const net = FakeNet({ [EURUSD]: { rates: { USD: 1.08 } } });

    const ctx = await displayContext(store, net);

    expect(ctx.currency).toBe("EUR");
    expect(ctx.displayUsd).toBe(1.08);
    expect(ctx.toDisplay).toBe(1 / 1.08);
  });

  it("EUR settings with a failed rate lookup fall back to displayUsd 0 and toDisplay 1, leaving currency EUR for the route to relabel", async () => {
    const store = MemoryStore({ settings: { displayCurrency: "EUR" } });
    const net = FakeNet({ [EURUSD]: respondWith(500, "upstream down") });

    const ctx = await displayContext(store, net);

    expect(ctx.currency).toBe("EUR");
    expect(ctx.displayUsd).toBe(0);
    expect(ctx.toDisplay).toBe(1);
  });

  it("EUR settings with an unreachable rate host (transport rejection, not a bad status) fall back to displayUsd 0 and toDisplay 1 too, the same as old fx.ts's blanket try/catch", async () => {
    const store = MemoryStore({ settings: { displayCurrency: "EUR" } });
    const net = FakeNet({ [EURUSD]: rejectWith(new TypeError("fetch failed")) });

    const ctx = await displayContext(store, net);

    expect(ctx.currency).toBe("EUR");
    expect(ctx.displayUsd).toBe(0);
    expect(ctx.toDisplay).toBe(1);
  });

  it("passes the equity provider and API key through from settings", async () => {
    const store = MemoryStore({
      settings: { displayCurrency: "USD", equityProvider: "stooq", equityApiKey: "key-1" },
    });
    const net = FakeNet({});

    const ctx = await displayContext(store, net);

    expect(ctx.equityProvider).toBe("stooq");
    expect(ctx.equityApiKey).toBe("key-1");
  });
});

describe("displayContextAt", () => {
  it("USD settings need no rate lookup at any date", async () => {
    const store = MemoryStore({ settings: { displayCurrency: "USD" } });
    const net = FakeNet({});

    const ctx = await displayContextAt(store, net, AT);

    expect(ctx).toEqual({
      currency: "USD", toDisplay: 1, equityProvider: "yahoo", equityApiKey: null,
    });
    expect(net.calls).toEqual([]);
  });

  it("EUR settings use the rate on that date, not today's", async () => {
    const store = MemoryStore({ settings: { displayCurrency: "EUR" } });
    const net = FakeNet({
      [EURUSD]: { rates: { USD: 999 } },
      [ECB_RANGE]: { rates: { "2026-01-01": { EUR: 0.9 } } },
    });

    const ctx = await displayContextAt(store, net, AT);

    expect(ctx.currency).toBe("EUR");
    expect(ctx.toDisplay).toBe(0.9);
    // The latest-rate endpoint is not what a point-in-time valuation asks.
    expect(net.calls.map((c) => c.url)).toEqual([ECB_RANGE]);
  });

  it("falls back through the weekend to the last published rate", async () => {
    const store = MemoryStore({ settings: { displayCurrency: "EUR" } });
    // 2026-01-01 is a holiday; the ECB last published on 2025-12-31.
    const net = FakeNet({ [ECB_RANGE]: { rates: { "2025-12-31": { EUR: 0.85 } } } });

    const ctx = await displayContextAt(store, net, AT);

    expect(ctx.toDisplay).toBe(0.85);
  });

  it("falls back to 1, not 0, when the dated lookup fails — what snapshot has always done", async () => {
    const store = MemoryStore({ settings: { displayCurrency: "EUR" } });
    const net = FakeNet({ [ECB_RANGE]: respondWith(503, "frankfurter down") });

    const ctx = await displayContextAt(store, net, AT);

    expect(ctx.currency).toBe("EUR");
    expect(ctx.toDisplay).toBe(1);
  });

  it("treats an unreachable rate host the same as a bad status", async () => {
    const store = MemoryStore({ settings: { displayCurrency: "EUR" } });
    const net = FakeNet({ [ECB_RANGE]: rejectWith(new TypeError("fetch failed")) });

    expect((await displayContextAt(store, net, AT)).toDisplay).toBe(1);
  });
});
