import { beforeEach, describe, expect, it } from "vitest";
import { invalidate } from "@/core/cache";
import { QUOTE_ASSETS } from "@/core/symbols";
import { FakeNet, respondWith } from "../testing/fake-net";
import { fetchDailyStats, fetchPricesSafe, fetchQuotesFor, fetchKlinesRange } from "./binance";
import type { Net } from "../ports/net";

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

/**
 * #50: five years of daily bars was four round trips *in series*, because the
 * cursor loop awaited each page before asking for the next. 1,472ms on a
 * desktop, and most of the four to five seconds a phone saw, where every trip
 * pays mobile latency.
 */
describe("paging a long range", () => {
  const DAY = 86_400_000;
  const bar = (t: number) => [t, "1", "2", "0", "3", "10", t + DAY - 1, "0", 1, "0", "0", "0"];

  beforeEach(() => invalidate());

  it("asks for the pages at once, not one after another", async () => {
    const from = Date.parse("2020-01-01T00:00:00Z");
    const to = from + 2500 * DAY - 1;
    let inFlight = 0;
    let peak = 0;

    const net = FakeNet({
      "/api/v3/klines": async (url: string) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        const start = Number(new URL(url).searchParams.get("startTime"));
        const end = Number(new URL(url).searchParams.get("endTime"));
        const out = [];
        for (let t = start; t <= Math.min(end, to); t += DAY) out.push(bar(t));
        return out;
      },
    });

    const bars = await fetchKlinesRange(net, { symbol: "BTCUSDT", interval: "1d", from, to });
    expect(bars).toHaveLength(2500);
    // Three pages of 1000; sequential would peak at one.
    expect(peak).toBeGreaterThan(1);
  });

  it("does not stop at a gap, which a cursor walk could get away with", async () => {
    // A coin that had not listed yet returns an empty page in the middle. The
    // sequential loop broke on the first empty batch; parallel pages must be
    // merged by open time so a hole costs its own page and nothing after it.
    const from = Date.parse("2020-01-01T00:00:00Z");
    const to = from + 2500 * DAY - 1;
    const net = FakeNet({
      "/api/v3/klines": (url: string) => {
        const start = Number(new URL(url).searchParams.get("startTime"));
        const end = Number(new URL(url).searchParams.get("endTime"));
        if (start >= from + 1000 * DAY && start < from + 2000 * DAY) return [];
        const out = [];
        for (let t = start; t <= Math.min(end, to); t += DAY) out.push(bar(t));
        return out;
      },
    });

    const bars = await fetchKlinesRange(net, { symbol: "BTCUSDT", interval: "1d", from, to });
    // The first thousand and the last five hundred survive the hole between.
    expect(bars.length).toBe(1500);
    expect(bars[0]!.t).toBe(from);
    expect(bars[bars.length - 1]!.t).toBeGreaterThan(from + 2000 * DAY);
  });

  it("returns bars in order, however the pages arrive", async () => {
    const from = Date.parse("2020-01-01T00:00:00Z");
    const to = from + 2500 * DAY - 1;
    const net = FakeNet({
      "/api/v3/klines": async (url: string) => {
        const start = Number(new URL(url).searchParams.get("startTime"));
        const end = Number(new URL(url).searchParams.get("endTime"));
        // Later pages answer first, which is what concurrency permits.
        await new Promise((r) => setTimeout(r, start === from ? 20 : 1));
        const out = [];
        for (let t = start; t <= Math.min(end, to); t += DAY) out.push(bar(t));
        return out;
      },
    });

    const bars = await fetchKlinesRange(net, { symbol: "BTCUSDT", interval: "1d", from, to });
    const times = bars.map((b) => b.t);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(times).size).toBe(times.length);
  });
});

/**
 * The whole point of `privateCoinPrices` is the *request*, not the response.
 *
 * A test that only checked the prices came back would pass just as happily
 * with the held symbols in the query string, which is the one thing this
 * feature exists to remove. So these assert the URL.
 */
describe("asking for everything", () => {
  /** Every URL the fake was asked for. */
  function recorder(body: unknown) {
    const urls: string[] = [];
    const net: Net = {
      async json(url: string) { urls.push(url); return body as never; },
      async request(url: string) {
        urls.push(url);
        return { ok: true, status: 200, json: async () => body, text: async () => "" } as never;
      },
      async text(url: string) { urls.push(url); return ""; },
    };
    return { net, urls };
  }

  it("names no symbol in the price request, and still answers the ones asked for", async () => {
    const { net, urls } = recorder([
      { symbol: "BTCUSDT", price: "67000" },
      { symbol: "ETHUSDT", price: "2100" },
      { symbol: "DOGEUSDT", price: "0.1" },
    ]);

    const got = await fetchPricesSafe(net, ["ETHUSDT", "BTCUSDT"], true);

    expect(got).toEqual({ ETHUSDT: 2100, BTCUSDT: 67000 });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe("https://api.binance.com/api/v3/ticker/price");
    // The assertion the feature is for: not "no symbols parameter", but no
    // held ticker anywhere in the URL at all.
    expect(urls[0]).not.toMatch(/ETH|BTC|symbols/);
  });

  it("still names them when the setting is off, which is the default", async () => {
    const { net, urls } = recorder([{ symbol: "ETHUSDT", price: "2100" }]);
    await fetchPricesSafe(net, ["ETHUSDT"]);
    expect(urls[0]).toContain("ETHUSDT");
  });

  it("shares one whole-board answer between callers wanting different coins", async () => {
    const { net, urls } = recorder([
      { symbol: "BTCUSDT", price: "67000" },
      { symbol: "ETHUSDT", price: "2100" },
    ]);
    // 26 KB is affordable once per window and not once per screen; the keyed
    // cache it replaces could not do this, since these two sets do not match.
    await fetchPricesSafe(net, ["ETHUSDT"], true);
    await fetchPricesSafe(net, ["BTCUSDT"], true);
    expect(urls).toHaveLength(1);
  });
});
