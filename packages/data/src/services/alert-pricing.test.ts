import { beforeEach, describe, expect, it } from "vitest";
import { invalidate } from "@/core/cache";
import { FakeNet } from "../testing/fake-net";
import { assetTypeOf, baselines, priceSymbols } from "./alert-pricing";

beforeEach(() => invalidate());

/**
 * An alert on ASML.AS saved, listed, and never evaluated: everything was
 * priced through Binance, `pricingPair` answered ASML.ASUSDT, and
 * `fetchPricesSafe` omits what it cannot price. No error, no event, no sign.
 */
const net = () => FakeNet({
  "/api/v3/ticker/price": [
    { symbol: "BTCUSDT", price: "65000" },
    { symbol: "ETHUSDT", price: "3200" },
  ],
  "/api/v3/ticker/24hr": [
    { symbol: "BTCUSDT", lastPrice: "65000", openPrice: "60000" },
    { symbol: "ETHUSDT", lastPrice: "3200", openPrice: "3300" },
  ],
  "query1.finance.yahoo.com/v8/finance/chart/ASML.AS": {
    chart: { result: [{ meta: { regularMarketPrice: 640, chartPreviousClose: 620, currency: "EUR" } }] },
  },
  "query1.finance.yahoo.com/v8/finance/chart/AMD": {
    chart: { result: [{ meta: { regularMarketPrice: 150, chartPreviousClose: 145, currency: "USD" } }] },
  },
});

describe("assetTypeOf", () => {
  it("believes the alert's own column", () => {
    expect(assetTypeOf({ assetType: "equity", symbol: "AMD" })).toBe("equity");
    expect(assetTypeOf({ assetType: "crypto", symbol: "BTC" })).toBe("crypto");
  });

  it("does not guess a US ticker into a coin when the column says otherwise", () => {
    // The whole reason the column exists. AMD has no exchange suffix, so shape
    // alone would send it to Binance as AMDUSDT — a symbol that may answer
    // with an unrelated token's price.
    expect(assetTypeOf({ assetType: "equity", symbol: "AMD" })).toBe("equity");
  });

  it("falls back to the ticker's shape for rows written before the column", () => {
    expect(assetTypeOf({ assetType: null, symbol: "ASML.AS" })).toBe("equity");
    expect(assetTypeOf({ assetType: null, symbol: "BTC" })).toBe("crypto");
    expect(assetTypeOf({ symbol: "ASML.AS" })).toBe("equity");
  });
});

describe("priceSymbols", () => {
  it("prices a share through the equity source, not Binance", async () => {
    const prices = await priceSymbols(net(), {}, [{ symbol: "ASML.AS", assetType: "equity" }]);
    expect(prices["ASML.AS"]).toEqual({ price: 640, currency: "EUR" });
  });

  it("prices a coin by its pair, and keys the answer by the stored symbol", async () => {
    // Keyed as the caller asked, because that is what a notification names.
    const prices = await priceSymbols(net(), {}, [{ symbol: "BTC", assetType: "crypto" }]);
    // The currency travels with the figure. Without it every notification
    // downstream said "Now 65000" and left the reader to guess.
    expect(prices).toEqual({ BTC: { price: 65000, currency: "USDT" } });
  });

  it("prices both kinds in one call", async () => {
    const prices = await priceSymbols(net(), {}, [
      { symbol: "BTC", assetType: "crypto" },
      { symbol: "ASML.AS", assetType: "equity" },
      { symbol: "AMD", assetType: "equity" },
    ]);
    // Three assets, three currencies, and the difference is the whole reason
    // this carries one: AMD is quoted in dollars and ASML.AS in euros, and a
    // notification that printed either as a bare number would be a figure
    // somebody could act on and be wrong about.
    expect(prices).toEqual({
      BTC: { price: 65000, currency: "USDT" },
      "ASML.AS": { price: 640, currency: "EUR" },
      AMD: { price: 150, currency: "USD" },
    });
  });

  it("omits what it cannot price rather than reporting zero", async () => {
    const prices = await priceSymbols(net(), {}, [{ symbol: "NOPE", assetType: "crypto" }]);
    expect(prices.NOPE).toBeUndefined();
  });

  it("lets one venue fail without taking the other with it", async () => {
    const half = FakeNet({
      "/api/v3/ticker/price": [{ symbol: "BTCUSDT", price: "65000" }],
      // Yahoo unscripted: the equity half throws and is caught.
    });
    const prices = await priceSymbols(half, {}, [
      { symbol: "BTC", assetType: "crypto" },
      { symbol: "ASML.AS", assetType: "equity" },
    ]);
    expect(prices.BTC).toEqual({ price: 65000, currency: "USDT" });
    expect(prices["ASML.AS"]).toBeUndefined();
  });
});

describe("baselines", () => {
  it("gives a coin its rolling day and a share its previous close", async () => {
    // Deliberately different: a stock market is shut overnight, so there is no
    // such thing as its price twenty-four hours ago on a Sunday.
    const base = await baselines(net(), {}, [
      { symbol: "BTC", assetType: "crypto" },
      { symbol: "ASML.AS", assetType: "equity" },
    ]);
    expect(base.BTC).toBe(60000);
    expect(base["ASML.AS"]).toBe(620);
  });

  it("drops a non-positive baseline instead of dividing by it", async () => {
    const zeroed = FakeNet({
      "/api/v3/ticker/24hr": [{ symbol: "BTCUSDT", lastPrice: "65000", openPrice: "0" }],
    });
    const base = await baselines(zeroed, {}, [{ symbol: "BTC", assetType: "crypto" }]);
    expect(base.BTC).toBeUndefined();
  });
});
