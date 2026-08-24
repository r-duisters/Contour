import { beforeEach, describe, expect, it } from "vitest";
import { invalidate } from "@/core/cache";
import { FakeNet, respondWith } from "../testing/fake-net";
import { fetchIndexSeries, fetchScreener, fetchTopByMarketCap, usMarketOpen } from "./markets";
import { fetch24hTicker } from "./binance";

// These fetchers memoise through the process-local cache in @/core/cache, and
// a hit answers before the injected Net is consulted — a FakeNet proves
// nothing if a neighbouring test's value satisfies the call first. See the
// header of ./binance.ts.
beforeEach(() => invalidate());

const at = (iso: string) => Date.parse(iso);

describe("usMarketOpen", () => {
  it("is open inside the New York session on a weekday", () => {
    expect(usMarketOpen(at("2026-08-24T14:00:00Z"))).toBe(true); // 10:00 ET Monday
  });
  it("is closed before the open and after the close", () => {
    expect(usMarketOpen(at("2026-08-24T12:00:00Z"))).toBe(false);
    expect(usMarketOpen(at("2026-08-24T21:00:00Z"))).toBe(false);
  });
  it("is closed at the weekend", () => {
    expect(usMarketOpen(at("2026-08-22T14:00:00Z"))).toBe(false); // Saturday
    expect(usMarketOpen(at("2026-08-23T14:00:00Z"))).toBe(false); // Sunday
  });
});

describe("fetchTopByMarketCap", () => {
  it("maps CoinGecko rows and keeps the order it was given", async () => {
    const net = FakeNet({
      "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=2&page=1":
        [{ symbol: "btc", name: "Bitcoin", current_price: 65000, price_change_percentage_24h: 1.2, market_cap: 1.2e12 },
         { symbol: "eth", name: "Ethereum", current_price: 3200, price_change_percentage_24h: -0.4, market_cap: 3.8e11 }],
    });
    expect(await fetchTopByMarketCap(net, 2)).toEqual([
      { symbol: "BTC", name: "Bitcoin", price: 65000, changePct: 1.2, marketCap: 1.2e12 },
      { symbol: "ETH", name: "Ethereum", price: 3200, changePct: -0.4, marketCap: 3.8e11 },
    ]);
  });
});

describe("fetchScreener", () => {
  it("unwraps Yahoo's envelope", async () => {
    const net = FakeNet({
      "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=day_gainers&count=1":
        { finance: { result: [{ quotes: [{ symbol: "HOOD", shortName: "Robinhood",
            regularMarketPrice: 42.5, regularMarketChangePercent: 13.7, marketCap: 3.7e10 }] }] } },
    });
    expect(await fetchScreener(net, "day_gainers", 1)).toEqual([
      { symbol: "HOOD", name: "Robinhood", price: 42.5, changePct: 13.7, marketCap: 3.7e10 },
    ]);
  });

  it("answers an empty list rather than throwing when Yahoo returns no result", async () => {
    const net = FakeNet({
      "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=day_losers&count=1":
        { finance: { result: null, error: { code: "Unauthorized" } } },
    });
    expect(await fetchScreener(net, "day_losers", 1)).toEqual([]);
  });
});

describe("fetch24hTicker", () => {
  it("coerces Binance's string numbers", async () => {
    const net = FakeNet({
      "https://api.binance.com/api/v3/ticker/24hr":
        [{ symbol: "BTCUSDT", lastPrice: "65000.10", priceChangePercent: "1.20", quoteVolume: "9e8" }],
    });
    expect(await fetch24hTicker(net)).toEqual([
      { symbol: "BTCUSDT", lastPrice: 65000.10, priceChangePercent: 1.2, quoteVolume: 9e8 },
    ]);
  });
});

describe("fetchIndexSeries", () => {
  it("reads Yahoo's chart into closes, dropping the gaps", async () => {
    // A closed session comes back as a null close beside a real timestamp.
    const net = FakeNet({
      "query1.finance.yahoo.com/v8/finance/chart/%5EGSPC": {
        chart: { result: [{
          timestamp: [1, 2, 3],
          indicators: { quote: [{ close: [100, null, 102] }] },
        }] },
      },
    });
    expect(await fetchIndexSeries(net, { symbol: "^GSPC", label: "S&P 500", kind: "equity" }))
      .toEqual({ label: "S&P 500", points: [100, 102], changePct: 2 });
  });

  it("reads Binance klines for a coin, and carries the price", async () => {
    const net = FakeNet({
      "api.binance.com/api/v3/klines": [
        [1, "0", "0", "0", "100", "0", 2, "0", 0, "0", "0", "0"],
        [2, "0", "0", "0", "150", "0", 3, "0", 0, "0", "0", "0"],
      ],
    });
    expect(await fetchIndexSeries(net, { symbol: "BTCUSDT", label: "Bitcoin", kind: "crypto" }))
      .toEqual({ label: "Bitcoin", points: [100, 150], changePct: 50, price: 150 });
  });

  it("answers null rather than throwing when a venue is unreachable", async () => {
    // One index down must not take the whole board with it.
    const net = FakeNet({ "query1.finance.yahoo.com": respondWith(404, "no such symbol") });
    expect(await fetchIndexSeries(net, { symbol: "^NOPE", label: "Nope", kind: "equity" }))
      .toBeNull();
  });

  it("answers null for a series too short to have a shape", async () => {
    const net = FakeNet({
      "query1.finance.yahoo.com": {
        chart: { result: [{ timestamp: [1], indicators: { quote: [{ close: [100] }] } }] },
      },
    });
    expect(await fetchIndexSeries(net, { symbol: "^THIN", label: "Thin", kind: "equity" }))
      .toBeNull();
  });
});
