import { beforeEach, describe, expect, it } from "vitest";
import { invalidate } from "@/core/cache";
import { QUOTE_ASSETS } from "@/core/symbols";
import { FakeNet } from "../testing/fake-net";
import { fetchQuotesFor } from "./binance";

/**
 * `exchangeInfo` is memoised for an hour under a key this module shares with
 * `fetchUsdtSymbols`. Without this, the second test in the file reads the
 * first test's scripted payload and passes for the wrong reason.
 */
beforeEach(() => invalidate());

const EXCHANGE_INFO = {
  symbols: [
    { symbol: "ETHUSDT", baseAsset: "ETH", quoteAsset: "USDT", status: "TRADING", isSpotTradingAllowed: true },
    { symbol: "ETHEUR",  baseAsset: "ETH", quoteAsset: "EUR",  status: "TRADING", isSpotTradingAllowed: true },
    { symbol: "ETHBTC",  baseAsset: "ETH", quoteAsset: "BTC",  status: "TRADING", isSpotTradingAllowed: true },
    { symbol: "ETHNGN",  baseAsset: "ETH", quoteAsset: "NGN",  status: "TRADING", isSpotTradingAllowed: true },
    { symbol: "ETHRUB",  baseAsset: "ETH", quoteAsset: "RUB",  status: "BREAK",   isSpotTradingAllowed: true },
    { symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", status: "TRADING", isSpotTradingAllowed: true },
  ],
};

describe("fetchQuotesFor", () => {
  it("lists the quotes this base trades against, in quotes the app knows", async () => {
    const net = FakeNet({ "/api/v3/exchangeInfo": EXCHANGE_INFO });
    const quotes = await fetchQuotesFor(net, "ETH");
    // NGN is dropped for being outside QUOTE_ASSETS, RUB for not trading.
    expect([...quotes].sort()).toEqual(["BTC", "EUR", "USDT"]);
  });

  it("puts USDT first, because it is the one people mean", async () => {
    const net = FakeNet({ "/api/v3/exchangeInfo": EXCHANGE_INFO });
    expect((await fetchQuotesFor(net, "ETH"))[0]).toBe("USDT");
  });

  it("answers an empty list for a base with no listed pair", async () => {
    // Not an error: an equity reaches here through no path, but a delisted or
    // misspelled coin does, and the form must draw something.
    const net = FakeNet({ "/api/v3/exchangeInfo": EXCHANGE_INFO });
    expect(await fetchQuotesFor(net, "NOSUCH")).toEqual([]);
  });

  it("offers nothing outside the shared quote list", async () => {
    // A quote `assetOf` does not know would make ETHNGN parse as the asset
    // ETHN, so the picker must never offer one.
    const net = FakeNet({ "/api/v3/exchangeInfo": EXCHANGE_INFO });
    for (const q of await fetchQuotesFor(net, "ETH")) {
      expect(QUOTE_ASSETS as readonly string[]).toContain(q);
    }
  });

  it("is case-insensitive on the base", async () => {
    const net = FakeNet({ "/api/v3/exchangeInfo": EXCHANGE_INFO });
    expect((await fetchQuotesFor(net, "eth")).length).toBe(3);
  });
});
