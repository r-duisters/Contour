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
    const info = await assetInfo(net(), "UBI.PA", "equity");
    expect(info.sentiment).toBeNull();
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
