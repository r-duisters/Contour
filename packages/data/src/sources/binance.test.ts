import { beforeEach, describe, expect, it } from "vitest";
import { invalidate } from "@/core/cache";
import { QUOTE_ASSETS } from "@/core/symbols";
import { FakeNet, respondWith } from "../testing/fake-net";
import { fetchDailyStats, fetchQuotesFor } from "./binance";

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

describe("fetchDailyStats", () => {
  const TICKER = "https://api.binance.com/api/v3/ticker/24hr";

  it("reads Binance's own rolling 24h open, not an hour-aligned approximation", async () => {
    invalidate();
    const net = FakeNet({
      [TICKER]: [{ symbol: "ETHUSDT", openPrice: "2497.70", lastPrice: "2470.53" }],
    });

    const stats = await fetchDailyStats(net, ["ETHUSDT"]);

    // `openPrice` is the price exactly 24 hours ago, to the second. The klines
    // basis this replaced took the close of the bar 24 hours ago, which is
    // hour-aligned, so its window ran 24 to 25 hours and read 0.58 points
    // differently on this pair at 12:35 UTC on 2026-08-25.
    expect(stats["ETHUSDT"]).toEqual({ last: 2470.53, open24h: 2497.7 });
  });

  it("asks for every pair in one request, in the MINI form", async () => {
    invalidate();
    const net = FakeNet({ [TICKER]: [] });

    await fetchDailyStats(net, ["BTCUSDT", "ETHUSDT", "ADAUSDT"]);

    expect(net.calls).toHaveLength(1);
    const url = net.calls[0]!.url;
    // MINI drops the fields nobody here reads: ~293 bytes a symbol against
    // 4,439 for a 25-bar klines call, and one request rather than one each.
    expect(url).toContain("type=MINI");
    expect(decodeURIComponent(url)).toContain('["BTCUSDT","ETHUSDT","ADAUSDT"]');
  });

  it("omits a pair with no usable open rather than reporting zero", async () => {
    invalidate();
    const net = FakeNet({
      [TICKER]: [
        { symbol: "DEADUSDT", openPrice: "0", lastPrice: "0" },
        { symbol: "ETHUSDT", openPrice: "2000", lastPrice: "2100" },
      ],
    });

    const stats = await fetchDailyStats(net, ["DEADUSDT", "ETHUSDT"]);

    // A zero open would divide by zero downstream; absent lets the caller show
    // no change, which is what every other price path here does.
    expect(stats["DEADUSDT"]).toBeUndefined();
    expect(stats["ETHUSDT"]).toEqual({ last: 2100, open24h: 2000 });
  });

  it("answers nothing, and asks nothing, for an empty list", async () => {
    invalidate();
    const net = FakeNet({ [TICKER]: [] });
    expect(await fetchDailyStats(net, [])).toEqual({});
    expect(net.calls).toHaveLength(0);
  });
});

describe("fetchDailyStats, when the batch is rejected", () => {
  const TICKER = "https://api.binance.com/api/v3/ticker/24hr";

  it("falls back to per-symbol lookups rather than losing every symbol", async () => {
    invalidate();
    // Binance 400s the whole request if any one symbol is unknown to it —
    // `{"code":-1121,"msg":"Invalid symbol."}`. A real ledger carries delisted
    // coins, so one of them must not cost the other twenty-two their prices.
    // This is the same tolerance `fetchPricesSafe` has, for the same reason.
    let sawBatch = false;
    const net = FakeNet({
      [TICKER]: (url: string) => {
        const asked: string[] = JSON.parse(new URL(url).searchParams.get("symbols")!);
        if (asked.length > 1) { sawBatch = true; return respondWith(400, { code: -1121, msg: "Invalid symbol." }); }
        if (asked[0] === "DELISTEDUSDT") return respondWith(400, { code: -1121, msg: "Invalid symbol." });
        return [{ symbol: asked[0], openPrice: "100", lastPrice: "110" }];
      },
    });

    const stats = await fetchDailyStats(net, ["ETHUSDT", "DELISTEDUSDT", "BTCUSDT"]);

    expect(sawBatch).toBe(true);
    expect(stats["ETHUSDT"]).toEqual({ last: 110, open24h: 100 });
    expect(stats["BTCUSDT"]).toEqual({ last: 110, open24h: 100 });
    expect(stats["DELISTEDUSDT"]).toBeUndefined();
  });

  it("answers empty rather than throwing when every symbol fails", async () => {
    invalidate();
    const net = FakeNet({ [TICKER]: respondWith(400, { code: -1121, msg: "Invalid symbol." }) });
    expect(await fetchDailyStats(net, ["NOPEUSDT"])).toEqual({});
  });
});
