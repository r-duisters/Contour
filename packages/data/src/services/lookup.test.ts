import { beforeEach, describe, expect, it } from "vitest";
import { invalidate } from "@/core/cache";
import { FakeNet, rejectWith, respondWith } from "../testing/fake-net";
import { assetInfo, symbols } from "./lookup";

const EXCHANGE_INFO = "https://api.binance.com/api/v3/exchangeInfo";

// sources/binance's fetchUsdtSymbols memoises through packages/core/src/cache.ts
// under the key "usdt-symbols", shared with core's own copy — a leftover entry
// from another test (or from core, if anything in the same process warmed it)
// would answer before FakeNet is ever consulted.
beforeEach(() => invalidate());

const EXCHANGE_INFO_BODY = {
  symbols: [
    { symbol: "BTCUSDT", status: "TRADING", quoteAsset: "USDT", isSpotTradingAllowed: true },
    { symbol: "ETHUSDT", status: "TRADING", quoteAsset: "USDT", isSpotTradingAllowed: true },
    // Filtered out by sources/binance's fetchUsdtSymbols: not TRADING.
    { symbol: "DELISTEDUSDT", status: "BREAK", quoteAsset: "USDT", isSpotTradingAllowed: true },
    // Filtered out: not quoted in USDT.
    { symbol: "BTCEUR", status: "TRADING", quoteAsset: "EUR", isSpotTradingAllowed: true },
  ],
};

describe("symbols", () => {
  it("returns the current shape: every TRADING USDT spot symbol, sorted", async () => {
    const net = FakeNet({ [EXCHANGE_INFO]: EXCHANGE_INFO_BODY });

    expect(await symbols(net)).toEqual(["BTCUSDT", "ETHUSDT"]);
  });

  it("an empty exchange (no hits) is a valid answer, not an error", async () => {
    const net = FakeNet({ [EXCHANGE_INFO]: { symbols: [] } });

    expect(await symbols(net)).toEqual([]);
  });

  it("falls back to the last successful list when the upstream call fails", async () => {
    const good = FakeNet({ [EXCHANGE_INFO]: EXCHANGE_INFO_BODY });
    const first = await symbols(good);
    expect(first).toEqual(["BTCUSDT", "ETHUSDT"]);

    // A fresh failing Net simulates Binance going down on the next call. This
    // only proves the fallback if the shared TTL cache is not what's answering,
    // so invalidate it first — the module-level `lastGood` in lookup.ts must be
    // what serves this, independent of sources/binance's own cache.
    invalidate();
    const bad = FakeNet({ [EXCHANGE_INFO]: respondWith(503, "binance down") });

    expect(await symbols(bad)).toEqual(["BTCUSDT", "ETHUSDT"]);
  });

  it("falls back on a transport failure too, not just a bad status", async () => {
    const good = FakeNet({ [EXCHANGE_INFO]: EXCHANGE_INFO_BODY });
    await symbols(good);

    invalidate();
    const bad = FakeNet({ [EXCHANGE_INFO]: rejectWith(new TypeError("fetch failed")) });

    expect(await symbols(bad)).toEqual(["BTCUSDT", "ETHUSDT"]);
  });
});

const COINGECKO_SEARCH = "https://api.coingecko.com/api/v3/search";
const COINGECKO_COIN = "https://api.coingecko.com/api/v3/coins/bitcoin";
const FEAR_GREED = "https://api.alternative.me/fng/";
const YAHOO_RSS = "https://feeds.finance.yahoo.com/rss/2.0/headline";

const HAPPY_ROUTES = {
  [COINGECKO_SEARCH]: { coins: [{ id: "bitcoin", symbol: "btc", market_cap_rank: 1 }] },
  [COINGECKO_COIN]: {
    description: { en: "<p>Bitcoin is digital money.</p>" },
    categories: ["Cryptocurrency", null],
    hashing_algorithm: "SHA-256",
    market_cap_rank: 1,
    market_data: { market_cap: { usd: 1_000_000 }, total_volume: { usd: 1_000 } },
  },
  [FEAR_GREED]: { data: [{ value: "72", value_classification: "Greed" }] },
  [YAHOO_RSS]: "<rss><channel></channel></rss>",
};

describe("assetInfo", () => {
  it("assembles the current shape from crypto search, coin detail, fear & greed and headlines", async () => {
    const net = FakeNet(HAPPY_ROUTES);

    const info = await assetInfo(net, "BTCUSDT");

    expect(info.symbol).toBe("BTCUSDT");
    expect(info.about).toContain("Bitcoin is digital money");
    expect(info.tags).toContain("Cryptocurrency");
    expect(info.sentiment).toEqual({
      label: "Crypto Fear & Greed",
      value: "72 · Greed",
      detail: "Whole-market mood, not this coin",
      score: (72 - 50) / 50,
    });
    expect(info.sources).toContain("CoinGecko");
  });

  it("degrades to the current shape when every upstream lookup fails: empty, not thrown", async () => {
    const net = FakeNet({
      [COINGECKO_SEARCH]: respondWith(500, "coingecko down"),
      [FEAR_GREED]: rejectWith(new TypeError("fetch failed")),
      [YAHOO_RSS]: respondWith(404, "not found"),
    });

    const info = await assetInfo(net, "BTCUSDT");

    expect(info).toEqual({
      symbol: "BTCUSDT",
      about: null,
      tags: [],
      stats: [],
      sentiment: null,
      news: [],
      sources: [],
    });
  });

  it("a coin CoinGecko does not recognise degrades the same way, not an error", async () => {
    const net = FakeNet({
      [COINGECKO_SEARCH]: { coins: [] },
      [FEAR_GREED]: { data: [{ value: "50", value_classification: "Neutral" }] },
      [YAHOO_RSS]: "<rss><channel></channel></rss>",
    });

    const info = await assetInfo(net, "NOPEUSDT");

    expect(info.about).toBeNull();
    expect(info.stats).toEqual([]);
    // Fear & greed still comes through: it does not depend on the coin lookup.
    expect(info.sentiment?.label).toBe("Crypto Fear & Greed");
  });
});
