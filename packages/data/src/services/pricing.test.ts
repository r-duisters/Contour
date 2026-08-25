import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "../testing/memory-store";
import { FakeNet, rejectWith, respondWith } from "../testing/fake-net";
import { invalidate } from "@/core/cache";
import { displayContext, displayContextAt, fetchCrypto24hAgo } from "./pricing";

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

  it("shares one EUR rate across concurrent callers, so a page rendering two panels converts both at the same number", async () => {
    const store = MemoryStore({ settings: { displayCurrency: "EUR" } });
    const net = FakeNet({ [EURUSD]: { rates: { USD: 1.08 } } });

    // The portfolio page resolves a context for `valuation` and one for
    // `series` at once. `cached()` collapses them onto one in-flight request;
    // without that the two panels could be converted at two different rates.
    const [a, b] = await Promise.all([displayContext(store, net), displayContext(store, net)]);

    expect(a.displayUsd).toBe(b.displayUsd);
    expect(net.calls.map((c) => c.url)).toEqual([EURUSD]);
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

describe("fetchCrypto24hAgo", () => {
  const TICKER = "https://api.binance.com/api/v3/ticker/24hr";

  it("reads Binance's own rolling 24h open", async () => {
    invalidate();
    const net = FakeNet({
      [TICKER]: [{ symbol: "ETHUSDT", openPrice: "2497.70", lastPrice: "2470.53" }],
    });

    // Was 25 hourly klines and the oldest bar's close — hour-aligned, so the
    // window ran 24 to 25 hours. 0.58 points adrift on this pair at 12:35 UTC
    // on 2026-08-25.
    expect((await fetchCrypto24hAgo(net, ["ETHUSDT"]))["ETHUSDT"]).toBe(2497.7);
  });

  it("prices every symbol in one request", async () => {
    invalidate();
    const net = FakeNet({ [TICKER]: [] });

    await fetchCrypto24hAgo(net, ["BTCUSDT", "ETHUSDT", "ADAUSDT"]);

    // One request for three symbols, where the klines basis made three.
    expect(net.calls).toHaveLength(1);
    expect(net.calls[0]!.url).toContain("type=MINI");
  });

  it("omits a symbol whose open is zero rather than reporting it", async () => {
    invalidate();
    const net = FakeNet({
      [TICKER]: [
        { symbol: "DEADUSDT", openPrice: "0", lastPrice: "0" },
        { symbol: "ADAUSDT", openPrice: "42", lastPrice: "43" },
      ],
    });

    const out = await fetchCrypto24hAgo(net, ["DEADUSDT", "ADAUSDT"]);
    expect(out["DEADUSDT"]).toBeUndefined();
    expect(out["ADAUSDT"]).toBe(42);
  });

  it("omits a symbol it could not price, leaving the caller to show no change", async () => {
    invalidate();
    const net = FakeNet({ [TICKER]: rejectWith("down") });
    // Tolerant, like `fetchPricesSafe`: an unreachable feed costs the figure,
    // never the screen. A throw here would take the whole valuation down.
    expect(await fetchCrypto24hAgo(net, ["XRPUSDT"])).toEqual({});
  });

  it("agrees with the window the chart's own 1D figure uses", async () => {
    // The point of the change: header and chart read the same rolling window
    // from the same request, so they cannot drift apart.
    invalidate();
    const net = FakeNet({
      [TICKER]: [{ symbol: "ETHUSDT", openPrice: "2400", lastPrice: "2496" }],
    });

    const open = (await fetchCrypto24hAgo(net, ["ETHUSDT"]))["ETHUSDT"]!;
    expect(((2496 - open) / open) * 100).toBeCloseTo(4, 10);
  });
});
