import { describe, expect, it } from "vitest";
import { MemoryStore } from "../testing/memory-store";
import { FakeNet, respondWith } from "../testing/fake-net";
import { displayContext } from "./pricing";

const EURUSD = "https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD";

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
