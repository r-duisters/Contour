import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invalidate } from "@/core/cache";
import { RANGE_KEYS, type RangeKey } from "@/core/ranges";
import type { NewTransaction } from "../ports/store";
import { MemoryStore } from "../testing/memory-store";
import { FakeNet, respondWith } from "../testing/fake-net";
import { benchmark, changes, history, series } from "./series";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * Every figure here is a window measured back from "now", so the clock is
 * pinned: an assertion on a boundary timestamp is otherwise a race against the
 * millisecond the test happens to run in. Only `Date` is faked — the services
 * await real promises, and faking timers wholesale would stall them.
 */
const NOW = Date.parse("2026-03-15T12:00:00Z");
const TODAY = Math.floor(NOW / DAY_MS) * DAY_MS;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  // `sources/*` memoise through a process-wide map keyed identically to
  // `packages/core`'s copies, so a leftover entry answers before the FakeNet is
  // ever consulted and the test proves nothing. See sources/binance.ts.
  invalidate();
});

afterEach(() => vi.useRealTimers());

function tx(over: Partial<NewTransaction>): NewTransaction {
  return {
    symbol: "BTCUSDT",
    assetType: "crypto",
    side: "buy",
    quantity: 1,
    price: 100,
    fee: 0,
    time: Date.parse("2020-01-01T00:00:00Z"),
    nativeCurrency: null,
    nativePrice: null,
    nativeFee: null,
    note: null,
    ...over,
  };
}

/** A kline row: only open time (0) and close (4) are read. */
function kline(t: number, close: number): unknown[] {
  return [t, "0", "0", "0", String(close), "0", t + DAY_MS - 1, "0", 0, "0", "0", "0"];
}

/**
 * Binance's klines endpoint over a generated grid, honouring `startTime`,
 * `endTime` and `limit` so the paginating `fetchKlinesRange` is exercised the
 * way the real API drives it rather than handed one oversized page.
 */
function binanceKlines(closeAt: (t: number) => number) {
  return (url: string) => {
    const q = new URL(url).searchParams;
    const step = q.get("interval") === "1h" ? HOUR_MS : DAY_MS;
    const limit = Number(q.get("limit") ?? 1000);
    const end = Math.min(Number(q.get("endTime") ?? NOW), NOW);
    const lastSlot = Math.floor(end / step) * step;
    const startTime = q.get("startTime");
    // With a startTime the API answers forwards from it, capped at `limit` —
    // which is what makes `fetchKlinesRange` paginate. Without one it answers
    // the most recent `limit` bars.
    const firstSlot = startTime
      ? Math.ceil(Number(startTime) / step) * step
      : lastSlot - (limit - 1) * step;

    const out: unknown[][] = [];
    for (let t = firstSlot; t <= lastSlot; t += step) out.push(kline(t, closeAt(t)));
    return out.slice(0, limit);
  };
}

/** Yahoo's chart shape: seconds, and closes alongside them. */
function yahooChart(bars: { t: number; c: number }[]) {
  return {
    chart: {
      result: [{
        timestamp: bars.map((b) => Math.floor(b.t / 1000)),
        indicators: { quote: [{ close: bars.map((b) => b.c) }] },
      }],
    },
  };
}

const FLAT = 100;
const flatNet = () => FakeNet({ "api.binance.com/api/v3/klines": binanceKlines(() => FLAT) });

function oneCryptoPortfolio(first = Date.parse("2020-01-01T00:00:00Z")) {
  return MemoryStore({
    settings: { displayCurrency: "USD" },
    portfolios: [{ id: "p1", name: "Main", transactions: [tx({ time: first })] }],
  });
}

/** What each range key means as a window start, spelled out independently. */
const EXPECTED_FROM: Record<RangeKey, number> = {
  "1d": NOW - DAY_MS,
  "1w": NOW - 7 * DAY_MS,
  "1m": NOW - 31 * DAY_MS,
  ytd: Date.UTC(2026, 0, 1),
  "1y": NOW - 365 * DAY_MS,
  "2y": NOW - 2 * 365 * DAY_MS,
  "5y": NOW - 5 * 365 * DAY_MS,
  all: Date.parse("2020-01-01T00:00:00Z"),
};

describe("series", () => {
  it.each(RANGE_KEYS)("opens the %s window where that range begins", async (range) => {
    const out = await series(oneCryptoPortfolio(), flatNet(), "p1", range);
    if (!("windowFrom" in out)) throw new Error("expected a populated series");

    expect(out.windowFrom).toBe(EXPECTED_FROM[range]);
    // Only "1d" is drawn intraday; every longer window is daily.
    expect(out.barMs).toBe(range === "1d" ? HOUR_MS : DAY_MS);
    expect(out.range).toBe(range);
  });

  it.each([
    ["1d" as const, TODAY - HOUR_MS * 12, NOW],
    ["1w" as const, TODAY - 6 * DAY_MS, TODAY],
    ["1m" as const, TODAY - 30 * DAY_MS, TODAY],
    ["ytd" as const, Date.UTC(2026, 0, 1), TODAY],
    ["1y" as const, TODAY - 364 * DAY_MS, TODAY],
    ["all" as const, Date.parse("2020-01-01T00:00:00Z"), TODAY],
  ])("draws %s from its first bar to its last", async (range, firstT, lastT) => {
    const out = await series(oneCryptoPortfolio(), flatNet(), "p1", range);
    if (!("windowFrom" in out)) throw new Error("expected a populated series");

    expect(out.series[0]!.t).toBe(firstT);
    expect(out.series[out.series.length - 1]!.t).toBe(lastT);
  });

  it("starts at the first transaction when the window opens before it", async () => {
    const bought = TODAY - 10 * DAY_MS;
    const out = await series(oneCryptoPortfolio(bought), flatNet(), "p1", "1y");
    if (!("windowFrom" in out)) throw new Error("expected a populated series");

    // The window still says a year, because that is the period asked for...
    expect(out.windowFrom).toBe(NOW - 365 * DAY_MS);
    // ...but nothing was held before the purchase, so the drawing starts there.
    expect(out.series[0]!.t).toBe(bought);
    expect(out.series).toHaveLength(11);
  });

  it("reports the window's move, and holds a value for every bar", async () => {
    // 100 until the last two bars, then 150: a 50% move inside the month.
    const net = FakeNet({
      "api.binance.com/api/v3/klines": binanceKlines((t) => (t >= TODAY - DAY_MS ? 150 : 100)),
    });
    const store = MemoryStore({
      settings: { displayCurrency: "USD" },
      portfolios: [{
        id: "p1",
        name: "Main",
        transactions: [tx({ quantity: 2, time: Date.parse("2020-01-01T00:00:00Z") })],
      }],
    });

    const out = await series(store, net, "p1", "1m");
    if (!("windowFrom" in out)) throw new Error("expected a populated series");

    expect(out.series[0]!.value).toBe(200);
    expect(out.series[out.series.length - 1]!.value).toBe(300);
    expect(out.change).toEqual({ abs: 100, pct: 50 });
    expect(out.mwr.closing).toBe(300);
  });

  it("reports the absolute move only over all time, where a percentage would count deposits as gains", async () => {
    const out = await series(oneCryptoPortfolio(), flatNet(), "p1", "all");
    if (!("windowFrom" in out)) throw new Error("expected a populated series");

    expect(out.change).toEqual({ abs: 0, pct: null });
  });

  it("says USD when the euro rate could not be fetched, because the figures are then USD", async () => {
    const store = MemoryStore({
      settings: { displayCurrency: "EUR" },
      portfolios: [{ id: "p1", name: "Main", transactions: [tx({ quantity: 2 })] }],
    });
    const net = FakeNet({
      "api.frankfurter.dev/v1/latest": respondWith(503, "rate feed down"),
      "api.binance.com/api/v3/klines": binanceKlines(() => FLAT),
    });

    const out = await series(store, net, "p1", "1m");
    if (!("windowFrom" in out)) throw new Error("expected a populated series");

    // No rate means no conversion, so the figures are dollars. Labelling them
    // EUR — which is what this did — reports dollars as euros.
    expect(out.series[0]!.value).toBe(200);
    expect(out.currency).toBe("USD");
  });

  it("draws cash on the line, so the last point is the whole portfolio", async () => {
    // One coin worth 100, plus 500 deposited. The line must show 600.
    const store = MemoryStore({
      settings: { displayCurrency: "USD" },
      portfolios: [{ id: "p1", name: "Main", transactions: [
        tx({ time: TODAY - 5 * DAY_MS }),
        tx({ symbol: "USD", assetType: "cash", side: "transfer_in", quantity: 500,
             price: 1, time: TODAY - 4 * DAY_MS, nativeCurrency: "USD", nativePrice: 1 }),
      ] }],
    });
    const out = await series(store, flatNet(), "p1", "1m");
    if (!("windowFrom" in out)) throw new Error("expected a populated series");

    expect(out.series[out.series.length - 1]!.value).toBeCloseTo(FLAT + 500, 6);
    // ...and not before the deposit landed.
    expect(out.series[0]!.value).toBeCloseTo(FLAT, 6);
  });

  it("keeps cash out of the time-weighted return, which measures the holdings", async () => {
    // A deposit is not performance. TWR is fed the asset trades as its flow
    // list, so a line that jumps on funding while the flow list stays silent
    // would report the deposit as a gain — the reason cash was excluded from
    // this service in the first place, and the part that must not regress.
    const withCash = MemoryStore({
      settings: { displayCurrency: "USD" },
      portfolios: [{ id: "p1", name: "Main", transactions: [
        tx({ time: TODAY - 5 * DAY_MS }),
        tx({ symbol: "USD", assetType: "cash", side: "transfer_in", quantity: 9_000,
             price: 1, time: TODAY - 3 * DAY_MS, nativeCurrency: "USD", nativePrice: 1 }),
      ] }],
    });
    const without = MemoryStore({
      settings: { displayCurrency: "USD" },
      portfolios: [{ id: "p1", name: "Main", transactions: [tx({ time: TODAY - 5 * DAY_MS })] }],
    });

    const a = await series(withCash, flatNet(), "p1", "1m");
    const b = await series(without, flatNet(), "p1", "1m");
    if (!("twr" in a) || !("twr" in b)) throw new Error("expected populated series");

    const tail = (x: typeof a) => x.twr.points[x.twr.points.length - 1]!.index;
    expect(tail(a)).toBeCloseTo(tail(b), 9);
  });

  it("answers a portfolio holding nothing priceable with an empty series", async () => {
    const store = MemoryStore({
      settings: { displayCurrency: "USD" },
      portfolios: [{
        id: "p1",
        name: "Cash only",
        transactions: [tx({ symbol: "EUR", assetType: "cash", side: "transfer_in" })],
      }],
    });

    expect(await series(store, FakeNet({}), "p1", "1y")).toEqual({
      series: [], currency: "USD", range: "1y",
    });
  });
});

describe("changes", () => {
  it("reports each held asset's own price return over the window", async () => {
    const net = FakeNet({
      "api.binance.com/api/v3/klines": binanceKlines((t) => (t >= TODAY - DAY_MS ? 200 : 100)),
      "chart/TSLA": yahooChart([
        { t: TODAY - 20 * DAY_MS, c: 400 },
        { t: TODAY, c: 300 },
      ]),
    });
    const store = MemoryStore({
      settings: { displayCurrency: "USD" },
      portfolios: [{
        id: "p1",
        name: "Main",
        transactions: [
          tx({ symbol: "BTCUSDT", time: TODAY - 60 * DAY_MS }),
          tx({ symbol: "TSLA", assetType: "equity", time: TODAY - 60 * DAY_MS }),
        ],
      }],
    });

    expect(await changes(store, net, "p1", "1m")).toEqual({
      range: "1m",
      changes: { BTCUSDT: 100, TSLA: -25 },
    });
  });

  it("has nothing to say about a portfolio with no transactions", async () => {
    const store = MemoryStore({ portfolios: [{ id: "p1", name: "Empty" }] });
    expect(await changes(store, FakeNet({}), "p1", "1y")).toEqual({ range: "1y", changes: {} });
  });
});

describe("benchmark", () => {
  const FROM = TODAY - 5 * DAY_MS;
  /** 100 for the first three bars, 200 for the last three. */
  const doubling = (t: number) => (t >= TODAY - 2 * DAY_MS ? 200 : 100);

  it("rebases the index to 100 at the window's start", async () => {
    const net = FakeNet({ "api.binance.com/api/v3/klines": binanceKlines(doubling) });
    const out = await benchmark(MemoryStore(), net, { key: "btc", from: FROM });

    expect(out.label).toBe("Bitcoin");
    expect(out.points[0]).toEqual({ t: FROM, index: 100 });
    expect(out.points[out.points.length - 1]).toEqual({ t: TODAY, index: 200 });
    expect(out.sameFlows).toBeNull();
  });

  it("puts the portfolio's own flows into the index on the same days", async () => {
    const net = FakeNet({ "api.binance.com/api/v3/klines": binanceKlines(doubling) });
    const store = MemoryStore({
      settings: { displayCurrency: "USD" },
      portfolios: [{
        id: "p1",
        name: "Main",
        // 500 spent on the day the index doubles: 2.5 units, not 5.
        transactions: [tx({ quantity: 5, price: 100, time: TODAY - 2 * DAY_MS })],
      }],
    });

    const out = await benchmark(store, net, {
      key: "btc", from: FROM, portfolioId: "p1", opening: 1_000,
    });

    // 1 000 on day one buys 10 units at 100; 500 later buys 2.5 at 200.
    expect(out.sameFlows!.finalValue).toBe(2_500);
    expect(out.sameFlows!.series[0]).toEqual({ t: FROM, value: 1_000 });
  });

  it("leaves the flows unsimulated when the portfolio is not there", async () => {
    const net = FakeNet({ "api.binance.com/api/v3/klines": binanceKlines(doubling) });
    const out = await benchmark(MemoryStore(), net, { key: "btc", from: FROM, portfolioId: "gone" });

    expect(out.sameFlows).toBeNull();
    expect(out.points).not.toHaveLength(0);
  });

  it("answers with the failure rather than throwing when the feed is down", async () => {
    const net = FakeNet({ "api.binance.com/api/v3/klines": () => { throw new Error("upstream down"); } });
    const out = await benchmark(MemoryStore(), net, { key: "btc", from: FROM });

    expect(out).toMatchObject({ key: "btc", points: [], error: "upstream down" });
  });
});

describe("history", () => {
  it("takes the crypto path for a crypto symbol, and only that path", async () => {
    const net = FakeNet({ "api.binance.com/api/v3/klines": binanceKlines(() => FLAT) });
    const out = await history(MemoryStore(), net, "BTCUSDT", "crypto", "1m");

    expect(out.bars[0]!.t).toBe(TODAY - 30 * DAY_MS);
    expect(out.bars[out.bars.length - 1]!.t).toBe(TODAY);
    expect(out.changePct).toBe(0);
    expect(net.calls.every((c) => c.url.includes("api.binance.com"))).toBe(true);
  });

  it("takes the equity provider's path for an equity symbol, and only that path", async () => {
    const net = FakeNet({
      "chart/TSLA": yahooChart([
        { t: TODAY - 200 * DAY_MS, c: 200 },
        { t: TODAY, c: 250 },
      ]),
    });
    const out = await history(MemoryStore(), net, "TSLA", "equity", "1y");

    expect(out.bars).toEqual([
      { t: TODAY - 200 * DAY_MS, c: 200 },
      { t: TODAY, c: 250 },
    ]);
    expect(out.changePct).toBe(25);
    // Yahoo takes its own vocabulary for the same window.
    expect(net.calls[0]!.url).toContain("range=1y&interval=1d");
    expect(net.calls.some((c) => c.url.includes("binance"))).toBe(false);
  });

  it("asks for hourly bars over a day, and daily ones over a month", async () => {
    const net = FakeNet({ "api.binance.com/api/v3/klines": binanceKlines(() => FLAT) });

    await history(MemoryStore(), net, "BTCUSDT", "crypto", "1d");
    expect(net.calls[0]!.url).toContain("interval=1h");

    // A week is hourly here too, unlike /series, where 1w draws daily bars.
    // Narrowing this branch to range === "1d" would quietly turn a week of
    // 168 hourly points into about seven daily ones, with the shape of the
    // response unchanged and nothing else to notice it.
    invalidate();
    net.calls.length = 0;
    await history(MemoryStore(), net, "BTCUSDT", "crypto", "1w");
    expect(net.calls[0]!.url).toContain("interval=1h");
    expect(net.calls[0]!.url).toContain("limit=168");

    invalidate();
    net.calls.length = 0;
    await history(MemoryStore(), net, "BTCUSDT", "crypto", "1m");
    expect(net.calls[0]!.url).toContain("interval=1d");
  });
});
