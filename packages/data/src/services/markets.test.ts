import { beforeEach, describe, expect, it } from "vitest";
import { invalidate } from "@/core/cache";
import { FakeNet, respondWith } from "../testing/fake-net";
import { getMarkets } from "./markets";

// The sources memoise; without this a neighbouring test's value answers before
// the FakeNet is consulted. See the header of ../sources/binance.ts.
beforeEach(() => invalidate());

type TickerTuple = [string, number, number, number];

const ticker = (rows: TickerTuple[]) =>
  rows.map(([symbol, lastPrice, priceChangePercent, quoteVolume]) => ({
    symbol,
    lastPrice: String(lastPrice),
    priceChangePercent: String(priceChangePercent),
    quoteVolume: String(quoteVolume),
  }));

type GeckoRow = {
  symbol: string;
  name: string;
  current_price: number;
  price_change_percentage_24h: number;
  market_cap: number;
};

const klines = (closes: number[]) =>
  closes.map((c, i) => [i, "0", "0", "0", String(c), "0", i + 1, "0", 0, "0", "0", "0"]);

const fakeNetWith = (rows: ReturnType<typeof ticker>, gecko: GeckoRow[] = []) =>
  FakeNet({
    "/api/v3/ticker/24hr": rows,
    "api.coingecko.com": gecko,
    "/api/v3/klines": klines([100, 110]),
  });

describe("getMarkets crypto", () => {
  it("puts only genuine fallers in `down`", async () => {
    // Everything liquid is up today. A "top losers" column showing gains is
    // a lie; an empty column is not.
    const net = fakeNetWith(ticker([
      ["BTCUSDT", 65000, 1.1, 9e8], ["ETHUSDT", 3200, 0.7, 5e8], ["XRPUSDT", 2, 0.2, 8e7],
    ]));
    const board = await getMarkets(net, "crypto");
    expect(board.down).toEqual([]);
    expect(board.up.length).toBeGreaterThan(0);
  });

  it("excludes pegged coins from both columns", async () => {
    const net = fakeNetWith(ticker([
      ["USDCUSDT", 1, -0.01, 9e8], ["EURIUSDT", 1.08, -1.0, 9e8],
      ["FDUSDUSDT", 1, 0.0, 9e8], ["ADAUSDT", 0.9, -4.2, 9e8],
    ]));
    const board = await getMarkets(net, "crypto");
    expect(board.down.map((r) => r.symbol)).toEqual(["ADA"]);
  });

  it("ignores pairs below the volume floor", async () => {
    const net = fakeNetWith(ticker([["DUSTUSDT", 0.01, 90, 1e5], ["BTCUSDT", 65000, 1, 9e8]]));
    const board = await getMarkets(net, "crypto");
    expect(board.up.map((r) => r.symbol)).toEqual(["BTC"]);
  });

  it("carries the tradable pair beside the display symbol", async () => {
    // BTC is what a row says and BTCUSDT is what the price history is keyed
    // on; a link built from the first alone opens a page with no chart.
    const net = fakeNetWith(
      ticker([["BTCUSDT", 65000, 1.1, 9e8]]),
      [{ symbol: "usdt", name: "Tether", current_price: 1, price_change_percentage_24h: 0, market_cap: 1.8e11 }],
    );
    const board = await getMarkets(net, "crypto");
    expect(board.up[0]).toMatchObject({ symbol: "BTC", pair: "BTCUSDT" });
    // USDT is the quote asset — there is no USDTUSDT to link to, so the row
    // carries no pair and the page it opens simply has no chart.
    expect(board.largest.find((r) => r.symbol === "USDT")).not.toHaveProperty("pair");
  });

  it("prices the ranked table from Binance, not CoinGecko", async () => {
    // One freshness per screen: the cap table's price column must match the
    // movers' price column, or the same coin shows two prices on one page.
    const net = fakeNetWith(
      ticker([["BTCUSDT", 65000, 1.1, 9e8]]),
      [{ symbol: "btc", name: "Bitcoin", current_price: 61000, price_change_percentage_24h: 9.9, market_cap: 1.2e12 }],
    );
    const board = await getMarkets(net, "crypto");
    expect(board.largest[0]).toMatchObject({ symbol: "BTC", price: 65000, changePct: 1.1, marketCap: 1.2e12 });
  });

  it("falls back to CoinGecko's price when a coin has no Binance pair", async () => {
    // USDT is the quote asset; USDTUSDT does not exist.
    const net = fakeNetWith(
      ticker([["BTCUSDT", 65000, 1.1, 9e8]]),
      [{ symbol: "usdt", name: "Tether", current_price: 1, price_change_percentage_24h: 0, market_cap: 1.8e11 }],
    );
    const board = await getMarkets(net, "crypto");
    expect(board.largest.find((r) => r.symbol === "USDT")).toMatchObject({ price: 1 });
  });
});

const quote = (symbol: string, name: string, price: number, changePct: number, marketCap: number | null) =>
  ({ symbol, shortName: name, regularMarketPrice: price, regularMarketChangePercent: changePct, marketCap });

const fakeStockNet = () =>
  FakeNet({
    "query1.finance.yahoo.com/v8/finance/chart": {
      chart: { result: [{ timestamp: [1, 2], indicators: { quote: [{ close: [100, 105] }] } }] },
    },
    "scrIds=day_gainers": { finance: { result: [{ quotes: [quote("HOOD", "Robinhood", 42.5, 13.7, 3.7e10)] }] } },
    "scrIds=day_losers": { finance: { result: [{ quotes: [quote("PLUG", "Plug Power", 1.9, -8.2, 1.6e9)] }] } },
    "scrIds=most_actives": {
      finance: { result: [{ quotes: [
        quote("AAPL", "Apple", 230, 0.4, 3.4e12),
        quote("SOFI", "SoFi", 9.1, 2.0, null),
        quote("NVDA", "Nvidia", 178, 1.1, 4.3e12),
      ] }] },
    },
  });

describe("getMarkets indices", () => {
  it("leads with the two the strip shows, in the order it shows them", async () => {
    const board = await getMarkets(fakeNetWith(ticker([["BTCUSDT", 65000, 1, 9e8]])), "crypto");
    expect(board.indices.slice(0, 2).map((i) => i.label)).toEqual(["Bitcoin", "Ethereum"]);
    expect(board.indices).toHaveLength(6);
  });

  it("puts the S&P and the eurozone first for stocks", async () => {
    const board = await getMarkets(fakeStockNet(), "stocks");
    expect(board.indices.slice(0, 2).map((i) => i.label)).toEqual(["S&P 500", "Euro Stoxx 50"]);
    expect(board.indices).toHaveLength(8);
  });

  it("drops an index whose venue failed rather than failing the board", async () => {
    // Eight cards, one dead symbol: the page still has a board and seven cards.
    const net = FakeNet({
      "scrIds=": { finance: { result: [{ quotes: [] }] } },
      "query1.finance.yahoo.com/v8/finance/chart": {
        chart: { result: [{ timestamp: [1, 2], indicators: { quote: [{ close: [100, 105] }] } }] },
      },
      // FakeNet resolves the *longest* matching key, so the override has to be
      // longer than the generic chart route above, not merely more specific.
      "https://query1.finance.yahoo.com/v8/finance/chart/%5EFTSE": respondWith(404, "gone"),
    });
    const board = await getMarkets(net, "stocks");
    expect(board.indices.map((i) => i.label)).not.toContain("FTSE 100");
    expect(board.indices).toHaveLength(7);
  });
});

describe("getMarkets stocks", () => {
  it("ranks the most active by market cap and drops those without one", async () => {
    const board = await getMarkets(fakeStockNet(), "stocks");
    expect(board.largest.map((r) => r.symbol)).toEqual(["NVDA", "AAPL"]);
    expect(board.largest.every((r) => typeof r.marketCap === "number")).toBe(true);
  });
});

/**
 * One refusal used to cost the whole page.
 *
 * `Promise.all` meant a single upstream 429 rejected the board, and that is
 * what a phone saw: Yahoo answers Android's default user-agent with 429, so
 * Markets was simply empty while the same code served the web app fine. The
 * user-agent is fixed in `CapacitorNet`; this is the other half, because the
 * next flaky source should cost its own section and nothing more.
 */
describe("a board with a source down", () => {
  it("shows what arrived, and says it is partial", async () => {
    const net = FakeNet({
      "query1.finance.yahoo.com/v8/finance/chart": {
        chart: { result: [{ timestamp: [1, 2], indicators: { quote: [{ close: [100, 105] }] } }] },
      },
      "scrIds=day_gainers": { finance: { result: [{ quotes: [quote("HOOD", "Robinhood", 42.5, 13.7, 3.7e10)] }] } },
      "scrIds=day_losers": respondWith(429, "rate limited"),
      "scrIds=most_actives": { finance: { result: [{ quotes: [quote("AAPL", "Apple", 230, 0.4, 3.4e12)] }] } },
    });
    const board = await getMarkets(net, "stocks");
    expect(board.up.map((r) => r.symbol)).toEqual(["HOOD"]);
    expect(board.largest.map((r) => r.symbol)).toEqual(["AAPL"]);
    expect(board.down).toEqual([]);
    expect(board.partial).toBe(true);
  });

  it("does not claim to be partial when everything arrived", async () => {
    expect((await getMarkets(fakeStockNet(), "stocks")).partial).toBeUndefined();
  });

  it("fails rather than reporting a flat market when every source is down", async () => {
    // Four empty columns and no warning would read as "nothing moved today",
    // which is a different statement from "nothing loaded".
    const net = FakeNet({
      "query1.finance.yahoo.com": respondWith(429, "rate limited"),
    });
    await expect(getMarkets(net, "stocks")).rejects.toThrow();
  });

  it("keeps the crypto board alive when only the ranking is down", async () => {
    const net = FakeNet({
      "/api/v3/ticker/24hr": ticker([["BTCUSDT", 65000, 1.1, 9e8], ["ETHUSDT", 3200, -0.7, 5e8]]),
      "api.coingecko.com": respondWith(429, "rate limited"),
      "/api/v3/klines": klines([100, 110]),
    });
    const board = await getMarkets(net, "crypto");
    expect(board.up.map((r) => r.symbol)).toEqual(["BTC"]);
    expect(board.largest).toEqual([]);
    expect(board.partial).toBe(true);
  });
});
