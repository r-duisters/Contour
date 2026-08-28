import { beforeEach, describe, expect, it } from "vitest";
import { invalidate } from "@/core/cache";
import { FakeNet, respondWith } from "../testing/fake-net";
import { searchAssets } from "./search";

beforeEach(() => invalidate());

const YAHOO = {
  quotes: [
    { symbol: "ASML", shortname: "ASML Holding N.V.", quoteType: "EQUITY", exchDisp: "NASDAQ" },
    { symbol: "ASML.AS", shortname: "ASML HOLDING", quoteType: "EQUITY", exchDisp: "Amsterdam" },
    { symbol: "VOO", shortname: "Vanguard S&P 500 ETF", quoteType: "ETF", exchDisp: "NYSEArca" },
    { symbol: "VGHCX", shortname: "Vanguard Specialized", quoteType: "MUTUALFUND", exchDisp: "NASDAQ" },
    { symbol: "BTC=F", shortname: "Bitcoin Futures", quoteType: "FUTURE", exchDisp: "CME" },
    { symbol: "BTC-USD", shortname: "Bitcoin USD", quoteType: "CRYPTOCURRENCY", exchDisp: "CCC" },
  ],
};

const net = (pairs = ["BTCUSDT", "ETHUSDT", "ETHFIUSDT", "SETHUSDT", "ASMLUSDT"]) =>
  FakeNet({
    "/api/v3/exchangeInfo": {
      symbols: pairs.map((s) => ({
        symbol: s, status: "TRADING", quoteAsset: "USDT", isSpotTradingAllowed: true,
      })),
    },
    "query1.finance.yahoo.com/v1/finance/search": YAHOO,
  });

describe("searching for an asset", () => {
  it("offers only what this app can price", async () => {
    // A fund or a future would open a page with a name and no numbers, which
    // is the silent-failure shape this app keeps designing against.
    const hits = await searchAssets(net(), "asml");
    const symbols = hits.map((h) => h.symbol);
    expect(symbols).toContain("ASML.AS");
    expect(symbols).not.toContain("VGHCX");
    expect(symbols).not.toContain("BTC=F");
  });

  it("prices coins by this app's spelling, not Yahoo's", async () => {
    // Yahoo calls it BTC-USD; nothing here can look that up. The Binance list
    // is the authority on which coins are priceable at all.
    const hits = await searchAssets(net(), "BTC");
    expect(hits.some((h) => h.symbol === "BTC" && h.assetType === "crypto")).toBe(true);
    expect(hits.some((h) => h.symbol === "BTC-USD")).toBe(false);
  });

  it("ranks an exact ticker above one that merely contains it", async () => {
    // Without this, ETH finds ETHFI and SETH before Ethereum.
    const hits = await searchAssets(net(), "ETH");
    const coins = hits.filter((h) => h.assetType === "crypto").map((h) => h.symbol);
    expect(coins[0]).toBe("ETH");
  });

  it("keeps the listed half when Binance is unreachable, and the reverse", async () => {
    const noBinance = FakeNet({
      "/api/v3/exchangeInfo": respondWith(503, "down"),
      "query1.finance.yahoo.com/v1/finance/search": YAHOO,
    });
    expect((await searchAssets(noBinance, "asml")).length).toBeGreaterThan(0);

    invalidate();
    const noYahoo = FakeNet({
      "/api/v3/exchangeInfo": {
        symbols: [{ symbol: "BTCUSDT", status: "TRADING", quoteAsset: "USDT", isSpotTradingAllowed: true }],
      },
      "query1.finance.yahoo.com/v1/finance/search": respondWith(429, "no"),
    });
    expect((await searchAssets(noYahoo, "BTC")).length).toBeGreaterThan(0);
  });

  it("says nothing for a query too short to mean anything", async () => {
    // One letter matches most of the market; answering it wastes a request
    // and shows noise.
    expect(await searchAssets(net(), "a")).toEqual([]);
    expect(await searchAssets(net(), " ")).toEqual([]);
  });

  it("tells four listings of one company apart by exchange", async () => {
    const hits = await searchAssets(net(), "asml");
    expect(hits.find((h) => h.symbol === "ASML.AS")?.exchange).toBe("Amsterdam");
    // By kind as well as symbol: a ticker can exist in both worlds — the
    // fixture has an ASML coin beside the share — and the two are different
    // assets that merely spell themselves the same.
    const share = hits.find((h) => h.symbol === "ASML" && h.assetType === "equity");
    expect(share?.exchange).toBe("NASDAQ");
    expect(hits.find((h) => h.symbol === "ASML" && h.assetType === "crypto")).toBeDefined();
  });
});
