import { beforeEach, describe, expect, it } from "vitest";
import { invalidate } from "@/core/cache";
import { FakeNet, respondWith } from "../testing/fake-net";
import { assetInfo } from "./asset-info";

beforeEach(() => invalidate());

/** The `meta` block Yahoo returns for UBI.PA, trimmed to what is read. */
const CHART = {
  chart: { result: [{ meta: {
    longName: "Ubisoft Entertainment SA",
    shortName: "UBISOFT ENTERTAIN",
    instrumentType: "EQUITY",
    fullExchangeName: "Paris",
    currency: "EUR",
    regularMarketDayHigh: 5.392,
    regularMarketDayLow: 5.252,
    regularMarketVolume: 328030,
    fiftyTwoWeekHigh: 10.305,
    fiftyTwoWeekLow: 3.702,
    regularMarketPrice: 5.3,
  } }] },
};

describe("an equity's background", () => {
  const net = () => FakeNet({
    "query1.finance.yahoo.com/v8/finance/chart": CHART,
    "feeds.finance.yahoo.com": respondWith(200, "<rss></rss>"),
    // Present and answering, to prove it is not consulted rather than merely
    // unreachable.
    "api.alternative.me": { data: [{ value: "73", value_classification: "Greed" }] },
  });

  it("never carries the crypto Fear & Greed index", async () => {
    // A share was shown the mood of the coin market, because the device client
    // dropped `assetType` and every asset was read as a coin. That is a wrong
    // answer, not a thin one.
    //
    // This asserted `sentiment` was null, which was the right guard while a
    // share had no reading of its own. It has one now — its position in its
    // own 52-week range — so the guard is that the reading is *that* and never
    // the coin index, which is a stronger statement than absence was.
    const info = await assetInfo(net(), "UBI.PA", "equity");
    expect(info.sentiment?.label).toBe("52-week position");
    expect(info.sentiment?.label).not.toContain("Fear");
    expect(info.sources).not.toContain("alternative.me");
  });

  it("reads the facts the chart carries, which need no crumb", async () => {
    const info = await assetInfo(net(), "UBI.PA", "equity");
    expect(info.about).toContain("Ubisoft Entertainment SA");
    expect(info.about).toContain("Paris");
    const labels = info.stats.map((s) => s.label);
    expect(labels).toContain("52-week range");
    expect(labels).toContain("Day range");
    expect(labels).toContain("Volume");
    expect(info.stats.find((s) => s.label === "52-week range")!.value).toContain("EUR");
  });

  it("keeps the mood for a coin, which is what it describes", async () => {
    const info = await assetInfo(
      FakeNet({
        "api.coingecko.com": respondWith(404, "no"),
        "feeds.finance.yahoo.com": respondWith(200, "<rss></rss>"),
        "api.alternative.me": { data: [{ value: "73", value_classification: "Greed" }] },
      }),
      "BTC",
      "crypto",
    );
    expect(info.sentiment?.value).toContain("Greed");
  });

  it("survives Yahoo refusing, with the page still rendering", async () => {
    const info = await assetInfo(
      FakeNet({ "query1.finance.yahoo.com": respondWith(429, "no") }),
      "UBI.PA",
      "equity",
    );
    expect(info.symbol).toBe("UBI.PA");
    expect(info.stats).toEqual([]);
    expect(info.sentiment).toBeNull();
  });
});


/**
 * Sentiment has to be about the asset whose page you opened.
 *
 * The reading here was the whole crypto market's mood — identical on every
 * coin page, and for a while showing up on share pages too, where it was not
 * merely generic but wrong. Both halves say something about the specific
 * asset now, and neither invents a source: the coin figure was already in the
 * JSON this module parses, and the share figure is two numbers from the same
 * `meta` the stats above it read.
 */
describe("per-asset sentiment", () => {
  const coin = (votesUp: number | null | undefined) => FakeNet({
    "api.coingecko.com/api/v3/search": { coins: [{ id: "ethereum", symbol: "eth", market_cap_rank: 2 }] },
    "api.coingecko.com/api/v3/coins/ethereum": {
      description: { en: "Ethereum is a global platform." },
      categories: ["Smart Contract Platform"],
      market_cap_rank: 2,
      market_data: {},
      ...(votesUp === undefined ? {} : { sentiment_votes_up_percentage: votesUp }),
    },
    "feeds.finance.yahoo.com": respondWith(200, "<rss></rss>"),
    "api.alternative.me": { data: [{ value: "73", value_classification: "Greed" }] },
  });

  it("reads a coin's own votes rather than the market's mood", async () => {
    const info = await assetInfo(coin(83.4), "ETH", "crypto");
    expect(info.sentiment).toEqual({
      label: "Community sentiment",
      value: "83% bullish",
      detail: "CoinGecko voters, on ETH itself",
      // 83.4% up is 0.668 of the way from neutral to unanimous.
      score: (83.4 - 50) / 50,
    });
  });

  it("falls back to the market mood when a coin has no votes, and says so", async () => {
    const info = await assetInfo(coin(undefined), "ETH", "crypto");
    expect(info.sentiment?.label).toBe("Crypto Fear & Greed");
    expect(info.sentiment?.detail).toBe("Whole-market mood, not this coin");
  });

  it("places a share in its own 52-week range", async () => {
    // 5.30 between 3.702 and 10.305 is 24% of the way up. Not a mood, and not
    // labelled as one: a share has no free per-company sentiment this build
    // can reach, and inventing one from a price would be worse than none.
    const net = FakeNet({
      "query1.finance.yahoo.com/v8/finance/chart": CHART,
      "feeds.finance.yahoo.com": respondWith(200, "<rss></rss>"),
      "api.alternative.me": { data: [{ value: "73", value_classification: "Greed" }] },
    });
    const info = await assetInfo(net, "UBI.PA", "equity");
    expect(info.sentiment?.label).toBe("52-week position");
    expect(info.sentiment?.value).toBe("24% of the way up");
    expect(info.sentiment?.score).toBeCloseTo(24.2 / 100 * 2 - 1, 1);
  });

  it("still never shows a share the coin market's mood", async () => {
    const net = FakeNet({
      // No 52-week bounds, so the range reading is unavailable too — the
      // fallback must be nothing, never the crypto index.
      "query1.finance.yahoo.com/v8/finance/chart": {
        chart: { result: [{ meta: { longName: "Ubisoft", currency: "EUR" } }] },
      },
      "feeds.finance.yahoo.com": respondWith(200, "<rss></rss>"),
      "api.alternative.me": { data: [{ value: "73", value_classification: "Greed" }] },
    });
    const info = await assetInfo(net, "UBI.PA", "equity");
    expect(info.sentiment).toBeNull();
  });
});
