import { beforeEach, describe, expect, it } from "vitest";
import { invalidate } from "@/core/cache";
import { NotFoundError } from "../errors";
import type { NewTransaction } from "../ports/store";
import { MemoryStore } from "../testing/memory-store";
import { FakeNet, rejectWith } from "../testing/fake-net";
import { insights, snapshot, valuation } from "./valuation";

const DAY_MS = 86_400_000;
const ISO = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * `sources/*` memoise through `packages/core/src/cache.ts`, a module-level map
 * shared by every test in the process. Without this, the second test to ask for
 * BTCUSDT gets the first test's scripted price and passes for the wrong reason.
 */
beforeEach(() => invalidate());

function tx(over: Partial<NewTransaction>): NewTransaction {
  return {
    symbol: "BTCUSDT",
    assetType: "crypto",
    side: "buy",
    quantity: 1,
    price: 1,
    fee: 0,
    time: Date.parse("2025-06-01T00:00:00Z"),
    nativeCurrency: null,
    nativePrice: null,
    nativeFee: null,
    note: null,
    ...over,
  };
}

const EURUSD_LATEST = "https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD";

/**
 * Frankfurter's dated-range endpoint, answering one rate per requested pair on
 * the day the caller asks about. Keyed `${base}${quote}`; an unscripted pair
 * throws, so a service that reaches for a rate the test did not expect fails
 * loudly rather than picking up a default.
 */
function ecbRange(pairs: Record<string, number>, on: () => number) {
  return (url: string) => {
    const params = new URL(url).searchParams;
    const base = params.get("base")!;
    const quote = params.get("symbols")!;
    const rate = pairs[`${base}${quote}`];
    if (rate === undefined) throw new Error(`test: no scripted ECB rate for ${base}->${quote}`);
    return { rates: { [ISO(on())]: { [quote]: rate } } };
  };
}

/** Binance's batch ticker, omitting any symbol the test did not price. */
function binanceTicker(prices: Record<string, number>) {
  return (url: string) => {
    const asked = JSON.parse(new URL(url).searchParams.get("symbols")!) as string[];
    return asked
      .filter((s) => prices[s] !== undefined)
      .map((s) => ({ symbol: s, price: String(prices[s]) }));
  };
}

/** A kline row: only open time (0) and close (4) are read. */
function kline(t: number, close: number) {
  return [t, "0", "0", "0", String(close), "0", t + DAY_MS - 1, "0", 0, "0", "0", "0"];
}

/** Two daily bars per symbol: yesterday's closed one, and today's in progress. */
/**
 * Binance's batched rolling-24h stats, in the `type=MINI` shape the day change
 * now reads. One request names every pair, so the fake answers only for the
 * ones it was asked about.
 */
function binanceDailyStats(open24h: Record<string, number>) {
  return (url: string) => {
    const asked: string[] = JSON.parse(new URL(url).searchParams.get("symbols")!);
    return asked
      .filter((sym) => open24h[sym] !== undefined)
      .map((sym) => ({
        symbol: sym,
        openPrice: String(open24h[sym]),
        // Unread by the day-change path, which takes the live price from
        // `ticker/price`; present because Binance sends it.
        lastPrice: String(open24h[sym]! * 2),
      }));
  };
}

function yahooQuote(meta: Record<string, unknown>) {
  return { chart: { result: [{ meta }] } };
}

describe("valuation", () => {
  it("prices a bare asset by its pair", async () => {
    // The store holds ETH; Binance only knows ETHUSDT. A holding is asked for
    // by pair and reported by asset.
    const now = Date.now();
    const store = MemoryStore({
      settings: { displayCurrency: "USD" },
      portfolios: [{
        id: "p1",
        name: "Main",
        transactions: [tx({ symbol: "ETH", quantity: 2, price: 1_000 })],
      }],
    });
    const net = FakeNet({
      "api.binance.com/api/v3/ticker/price": binanceTicker({ ETHUSDT: 3_000 }),
      "api.binance.com/api/v3/ticker/24hr": binanceDailyStats({ ETHUSDT: 2_900 }),
    });

    const out = await valuation(store, net, "p1");

    const eth = out.holdings.find((h) => h.symbol === "ETH");
    expect(eth?.value).toBe(6_000);
    expect(eth?.dayChange).toEqual({ abs: 200, pct: (100 / 2_900) * 100 });
  });

  it("still prices a stored pair, because the database has not moved yet", async () => {
    const store = MemoryStore({
      settings: { displayCurrency: "USD" },
      portfolios: [{
        id: "p1",
        name: "Main",
        transactions: [tx({ symbol: "ETHUSDT", quantity: 2, price: 1_000 })],
      }],
    });
    const net = FakeNet({
      "api.binance.com/api/v3/ticker/price": binanceTicker({ ETHUSDT: 3_000 }),
      "api.binance.com/api/v3/ticker/24hr": [],
    });

    const out = await valuation(store, net, "p1");
    expect(out.holdings.find((h) => h.symbol === "ETHUSDT")?.value).toBe(6_000);
  });

  it("values a crypto-only USD portfolio: quantities, prices, day change and totals", async () => {
    const now = Date.now();
    const store = MemoryStore({
      settings: { displayCurrency: "USD" },
      portfolios: [{
        id: "p1",
        name: "Main",
        transactions: [
          tx({ symbol: "BTCUSDT", quantity: 2, price: 10_000, fee: 10 }),
          tx({ symbol: "ETHUSDT", quantity: 10, price: 1_000, fee: 5 }),
        ],
      }],
    });
    const net = FakeNet({
      "api.binance.com/api/v3/ticker/price": binanceTicker({ BTCUSDT: 20_000, ETHUSDT: 2_000 }),
      "api.binance.com/api/v3/ticker/24hr": binanceDailyStats({ BTCUSDT: 19_000, ETHUSDT: 1_900 }),
    });

    const out = await valuation(store, net, "p1");

    expect(out.currency).toBe("USD");
    expect(out.rate).toBe(1);
    expect(out.holdings.map((h) => h.symbol)).toEqual(["BTCUSDT", "ETHUSDT"]);

    const [btc, eth] = out.holdings;
    expect(btc).toMatchObject({
      symbol: "BTCUSDT", assetType: "crypto", name: "Bitcoin",
      quantity: 2, price: 20_000, value: 40_000,
      costBasis: 20_010, avgCost: 10_005, fees: 10, realizedPnl: 0,
      unrealizedPnl: 19_990,
    });
    expect(btc!.dayChange).toEqual({ abs: 2_000, pct: (1_000 / 19_000) * 100 });
    expect(eth).toMatchObject({ quantity: 10, price: 2_000, value: 20_000, costBasis: 10_005 });

    expect(out.totals).toEqual({
      dayChange: { abs: 3_000, pct: (3_000 / 57_000) * 100, covered: 2 },
      value: 60_000,
      cash: 0,
      invested: 60_000,
      costBasis: 30_015,
      unrealizedPnl: 29_985,
      realizedPnl: 0,
      fees: 15,
    });
  });

  it("converts USD prices into EUR exactly once, including an equity quoted in EUR", async () => {
    const now = Date.now();
    const store = MemoryStore({
      settings: { displayCurrency: "EUR" },
      portfolios: [{
        id: "p1",
        name: "Mixed",
        transactions: [
          tx({ symbol: "BTCUSDT", quantity: 1, price: 10_000 }),
          tx({ symbol: "AMD", assetType: "equity", quantity: 10, price: 100 }),
          tx({ symbol: "ASML.AS", assetType: "equity", quantity: 2, price: 500 }),
        ],
      }],
    });
    const net = FakeNet({
      [EURUSD_LATEST]: { rates: { USD: 1.25 } },
      "api.frankfurter.dev/v1/": ecbRange({ EURUSD: 1.25 }, () => now),
      "api.binance.com/api/v3/ticker/price": binanceTicker({ BTCUSDT: 20_000 }),
      "api.binance.com/api/v3/ticker/24hr": binanceDailyStats({ BTCUSDT: 19_000 }),
      "chart/AMD": yahooQuote({ regularMarketPrice: 200, currency: "USD", longName: "AMD Inc" }),
      "chart/ASML.AS": yahooQuote({ regularMarketPrice: 1_000, currency: "EUR", longName: "ASML" }),
    });

    const out = await valuation(store, net, "p1");
    const bySymbol = Object.fromEntries(out.holdings.map((h) => [h.symbol, h]));

    expect(out.currency).toBe("EUR");
    // 20 000 USD at 1 EUR = 1.25 USD. Converting twice would give 12 800.
    expect(bySymbol.BTCUSDT!.price).toBe(16_000);
    // A USD-quoted equity takes the same single step: 200 -> 160.
    expect(bySymbol.AMD).toMatchObject({ price: 160, value: 1_600, name: "AMD Inc" });
    // A EUR-quoted one goes EUR -> USD -> EUR and must land back where it
    // started: 1 000 EUR, not 1 562.50 (converted twice) or 800 (once, wrongly).
    expect(bySymbol["ASML.AS"]).toMatchObject({ price: 1_000, value: 2_000, name: "ASML" });

    // Cost bases were converted once too: 10 000 USD -> 8 000 EUR.
    expect(bySymbol.BTCUSDT!.costBasis).toBe(8_000);
    expect(out.totals.value).toBe(16_000 + 1_600 + 2_000);
  });

  it("keeps a holding whose price lookup failed out of the totals rather than valuing it at zero", async () => {
    const now = Date.now();
    const store = MemoryStore({
      settings: { displayCurrency: "USD" },
      portfolios: [{
        id: "p1",
        name: "Delisted",
        transactions: [
          tx({ symbol: "BTCUSDT", quantity: 1, price: 10_000 }),
          tx({ symbol: "SUBUSDT", quantity: 1_000, price: 2 }),
        ],
      }],
    });
    const net = FakeNet({
      // SUBUSDT is absent from the response, as a delisted pair is in reality.
      "api.binance.com/api/v3/ticker/price": binanceTicker({ BTCUSDT: 20_000 }),
      "api.binance.com/api/v3/ticker/24hr": binanceDailyStats({ BTCUSDT: 19_000 }),
    });

    const out = await valuation(store, net, "p1");
    const sub = out.holdings.find((h) => h.symbol === "SUBUSDT")!;

    // Honest degradation (spec §7 R2): no price, no value, no invented zero.
    expect(sub.price).toBeNull();
    expect(sub.value).toBeNull();
    expect(sub.unrealizedPnl).toBeNull();
    expect(sub.dayChange).toBeNull();
    expect(sub.quantity).toBe(1_000);

    // The total is BTC alone. Valuing SUBUSDT at zero would give the same
    // number here, so the assertions above are what actually pin the rule.
    expect(out.totals.value).toBe(20_000);
    expect(out.totals.invested).toBe(20_000);
    expect(out.totals.unrealizedPnl).toBe(10_000);
    // Cost basis is known even when the price is not, and still counts.
    expect(out.totals.costBasis).toBe(12_000);
    // Day change covers the priced holding only, so its percentage is not
    // diluted by the one nobody can value.
    expect(out.totals.dayChange).toEqual({
      abs: 1_000, pct: (1_000 / 19_000) * 100, covered: 1,
    });
  });

  it("reports cash as its own row, never as an asset, and refuses to let a negative balance subtract", async () => {
    const now = Date.now();
    const store = MemoryStore({
      settings: { displayCurrency: "USD" },
      portfolios: [{
        id: "p1",
        name: "With cash",
        transactions: [
          tx({ symbol: "BTCUSDT", quantity: 1, price: 10_000 }),
          tx({ symbol: "USD", assetType: "cash", side: "transfer_in", quantity: 1_000, nativeCurrency: "USD" }),
          tx({ symbol: "EUR", assetType: "cash", side: "transfer_out", quantity: 400, nativeCurrency: "EUR" }),
        ],
      }],
    });
    const net = FakeNet({
      "api.frankfurter.dev/v1/": ecbRange({ EURUSD: 1.25 }, () => now),
      "api.binance.com/api/v3/ticker/price": binanceTicker({ BTCUSDT: 20_000 }),
      "api.binance.com/api/v3/ticker/24hr": binanceDailyStats({ BTCUSDT: 19_000 }),
    });

    const out = await valuation(store, net, "p1");

    // The cash rows never reached computeHoldings: no asset row is called USD.
    expect(out.holdings.filter((h) => h.assetType !== "cash").map((h) => h.symbol))
      .toEqual(["BTCUSDT"]);

    const usd = out.holdings.find((h) => h.symbol === "USD")!;
    expect(usd).toMatchObject({
      assetType: "cash", name: "US Dollar", quantity: 1_000, price: 1,
      value: 1_000, costBasis: 1_000, avgCost: 1, unrealizedPnl: 0, realizedPnl: 0,
      fees: 0, dayChange: null, unreliable: false,
    });

    const eur = out.holdings.find((h) => h.symbol === "EUR")!;
    expect(eur).toMatchObject({ assetType: "cash", quantity: -400, value: -500, unreliable: true });

    // Cash counts towards what the portfolio is worth, never towards its P&L,
    // and the unreliable negative balance is left out of both.
    expect(out.totals.cash).toBe(1_000);
    expect(out.totals.value).toBe(21_000);
    expect(out.totals.invested).toBe(20_000);
    expect(out.totals.unrealizedPnl).toBe(10_000);
  });

  it("values an empty portfolio as zero without touching the network", async () => {
    const store = MemoryStore({
      settings: { displayCurrency: "USD" },
      portfolios: [{ id: "p1", name: "Empty", transactions: [] }],
    });
    const net = FakeNet({});

    const out = await valuation(store, net, "p1");

    expect(out.holdings).toEqual([]);
    expect(out.totals).toEqual({
      dayChange: null, value: 0, cash: 0, invested: 0,
      costBasis: 0, unrealizedPnl: 0, realizedPnl: 0, fees: 0,
    });
    expect(net.calls).toEqual([]);
  });
});

describe("snapshot", () => {
  const AT = Date.parse("2026-01-01T00:00:00Z");

  function snapshotStore() {
    return MemoryStore({
      settings: { displayCurrency: "EUR" },
      portfolios: [{
        id: "p1",
        name: "Main",
        transactions: [
          tx({ symbol: "BTCUSDT", quantity: 1, price: 10_000 }),
          tx({ symbol: "XMRUSDT", quantity: 5, price: 100 }),
          tx({ symbol: "ASML.AS", assetType: "equity", quantity: 2, price: 500 }),
          tx({ symbol: "USD", assetType: "cash", side: "transfer_in", quantity: 1_000, nativeCurrency: "USD" }),
          // After the snapshot date: it must not exist yet.
          tx({ symbol: "ETHUSDT", quantity: 3, price: 2_000, time: Date.parse("2026-06-01T00:00:00Z") }),
        ],
      }],
    });
  }

  function snapshotNet() {
    return FakeNet({
      "api.frankfurter.dev/v1/": ecbRange({ USDEUR: 0.8 }, () => AT),
      "api.binance.com/api/v3/klines": (url: string) => {
        const symbol = new URL(url).searchParams.get("symbol")!;
        // XMR was delisted: Binance answers with no bars at all.
        return symbol === "BTCUSDT" ? [kline(AT - DAY_MS, 50_000)] : [];
      },
      "chart/ASML.AS": {
        chart: { result: [{ timestamp: [(AT - DAY_MS) / 1_000], indicators: { quote: [{ close: [700] }] } }] },
      },
    });
  }

  it("values the portfolio as it stood on the date, at that date's rate", async () => {
    const out = await snapshot(snapshotStore(), snapshotNet(), "p1", "2026-01-01");

    expect(out.date).toBe("2026-01-01");
    expect(out.currency).toBe("EUR");
    // Sorted by value, descending, with the unpriced row last.
    expect(out.rows).toEqual([
      { symbol: "BTCUSDT", assetType: "crypto", quantity: 1, price: 40_000, value: 40_000 },
      { symbol: "ASML.AS", assetType: "equity", quantity: 2, price: 700, value: 1_400 },
      { symbol: "USD", assetType: "cash", quantity: 1_000, price: 0.8, value: 800 },
      { symbol: "XMRUSDT", assetType: "crypto", quantity: 5, price: null, value: null },
    ]);
    expect(out.total).toBe(42_200);
    expect(out.unpriced).toBe(1);
  });

  it("omits a transaction dated after the snapshot", async () => {
    const out = await snapshot(snapshotStore(), snapshotNet(), "p1", "2026-01-01");
    expect(out.rows.map((r) => r.symbol)).not.toContain("ETHUSDT");
  });

  it("answers a date before the first transaction with no rows and no unpriced count", async () => {
    const out = await snapshot(snapshotStore(), snapshotNet(), "p1", "2020-01-01");

    expect(out).toEqual({ date: "2020-01-01", currency: "EUR", rows: [], total: 0 });
    // The early return has never carried `unpriced`; the key is absent, not zero.
    expect("unpriced" in out).toBe(false);
  });
});

describe("insights", () => {
  const JAN_2024 = Date.parse("2024-03-01T00:00:00Z");
  const JAN_2025 = Date.parse("2025-03-01T00:00:00Z");

  function insightsStore(displayCurrency: "USD" | "EUR" = "USD") {
    return MemoryStore({
      settings: { displayCurrency },
      portfolios: [{
        id: "p1",
        name: "Main",
        transactions: [
          tx({ symbol: "BTCUSDT", quantity: 2, price: 10_000, fee: 10, time: JAN_2024 }),
          tx({ symbol: "ETHUSDT", quantity: 10, price: 1_000, fee: 5, time: JAN_2024 }),
          tx({ symbol: "BTCUSDT", side: "sell", quantity: 1, price: 30_000, fee: 20, time: JAN_2025 }),
          // Cash movements are not trades; every figure below excludes them.
          tx({
            symbol: "EUR", assetType: "cash", side: "transfer_in",
            quantity: 5_000, price: 1, fee: 0, time: JAN_2025, nativeCurrency: "EUR",
          }),
        ],
      }],
    });
  }

  /** No market data is needed, so any request at all is a bug. */
  const noPrices = () => FakeNet({});

  it("counts trades and flows from the transaction log, ignoring cash movements", async () => {
    const out = await insights(insightsStore(), noPrices(), "p1");

    expect(out.currency).toBe("USD");
    expect(out.stats).toMatchObject({
      trades: 3,
      buys: 2,
      sells: 1,
      transfers: 0,
      assetsTraded: 2,
      totalBought: 30_000,
      totalSold: 30_000,
      fees: 35,
      firstTrade: JAN_2024,
      lastTrade: JAN_2025,
    });
    expect(out.byYear).toEqual([
      { year: 2024, net: 30_015 },
      { year: 2025, net: -29_980 },
    ]);
  });

  it("expresses the figures in EUR when that is the display currency", async () => {
    const net = FakeNet({ [EURUSD_LATEST]: { rates: { USD: 1.25 } } });

    const out = await insights(insightsStore("EUR"), net, "p1");

    expect(out.currency).toBe("EUR");
    // Every trade above is priced in USD, so all of it converts at 1/1.25.
    expect(out.stats.totalBought).toBe(24_000);
    expect(out.stats.fees).toBe(28);
    expect(out.byYear).toEqual([
      { year: 2024, net: 24_012 },
      { year: 2025, net: -23_984 },
    ]);
  });

  it("labels the figures USD when the EUR rate cannot be fetched, because they are USD", async () => {
    const net = FakeNet({ [EURUSD_LATEST]: rejectWith(new Error("frankfurter down")) });

    const out = await insights(insightsStore("EUR"), net, "p1");

    expect(out.currency).toBe("USD");
    expect(out.stats.totalBought).toBe(30_000);
  });

  it("rejects an unknown portfolio with NotFoundError, which the route turns into a 404", async () => {
    await expect(insights(insightsStore(), noPrices(), "nope")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("answers an empty portfolio without reaching the network for prices", async () => {
    const store = MemoryStore({
      settings: { displayCurrency: "USD" },
      portfolios: [{ id: "empty", name: "Empty", transactions: [] }],
    });
    const net = FakeNet({});

    const out = await insights(store, net, "empty");

    expect(out.stats.trades).toBe(0);
    expect(out.stats.firstTrade).toBeNull();
    expect(out.byYear).toEqual([]);
    expect(net.calls).toEqual([]);
  });
});
