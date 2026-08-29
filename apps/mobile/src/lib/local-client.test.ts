import { beforeEach, describe, expect, it } from "vitest";
import { invalidate } from "@/core/cache";
import { NotFoundError } from "@/data/errors";
import type { Net } from "@/data/ports/net";
import type { Store } from "@/data/ports/store";
import { FakeNet } from "@/data/testing/fake-net";
import { MemoryStore } from "@/data/testing/memory-store";
import {
  BROKEN_PORTFOLIO_ID,
  FIXTURE,
  MISSING_PORTFOLIO_ID,
  PORTFOLIO_ID,
  TRANSACTION_ID,
  runDataClientContract,
} from "@/data/client/client-contract";
import { LocalClient } from "./local-client";

/**
 * The real second implementation, and the file `stub-client.test.ts` said it
 * was waiting for.
 *
 * It runs over `MemoryStore` and a `FakeNet` rather than over SQLite and
 * CapacitorHttp, because what the contract checks is that the *client* agrees
 * with `HttpClient`. The store below it has its own contract suite
 * (`sqlite-store.test.ts`), and the net below it has its own parity tests
 * (`capacitor-net.test.ts`); running all three at once would prove less, not
 * more, because a failure could come from any of them.
 *
 * ## What the stub taught, carried forward
 *
 * The stub existed to answer one question — whether `DataClient` had quietly
 * been drawn around HTTP — and answered it no. Nothing in the interface needed
 * a URL, a status code, a header or a request body to be expressible, and the
 * parts carrying real semantics (`NotFoundError` for a record this app owns,
 * newest-first transactions, `null` settings on a virgin install, ms
 * timestamps) fell out of the services and the `Store` port without argument.
 *
 * Four contract cases were HTTP-shaped when it ran. Three were fixed then: the
 * settings case now saves a whole row rather than expecting a value only a
 * mock could return; `sendTestNotification` became optional, which is the rule
 * now written into `data-client.ts`; and `FIXTURE.backup` became a valid
 * backup, having been rejected by the parser for as long as `FakeNet` was its
 * only reader.
 *
 * The fourth is fixed here. `restoreBackup` was canned because `FIXTURE.restored`
 * pinned `id: "p-restored"` and `restored: 7` against a backup literal holding
 * zero transactions — numbers only a mock can produce. The stub's header asked
 * Phase 4 to loosen them to "an id came back" and "as many as the backup held";
 * `client-contract.ts` now does exactly that, and this client really restores.
 *
 * **Five reads the stub canned are real here.** `getSeries`, `getChanges`,
 * `getSnapshot`, `getBenchmark` and `getHistory` call their services. A stub in
 * a test could afford to pretend; an app cannot.
 */
/**
 * Storage that will not answer, as opposed to storage that answered no. It is
 * how `BROKEN_PORTFOLIO_ID` produces `kind: "unreachable"` without a network:
 * the device's real unreachability is a database that cannot be read, not a
 * dead price feed — a valuation whose feed is offline degrades and reports
 * what it can, by design.
 */
class Unreachable extends Error {
  readonly kind = "unreachable";
}

/**
 * The seed, stated as the world the fixture describes rather than as the bodies
 * a server would send.
 */
function seededStore(): Store {
  const store = MemoryStore({
    portfolios: [
      {
        id: PORTFOLIO_ID,
        name: FIXTURE.portfolio.name,
        createdAt: Date.parse(FIXTURE.portfolio.createdAt),
        updatedAt: Date.parse(FIXTURE.portfolio.updatedAt),
        transactions: FIXTURE.transactions.map((t) => ({
          id: t.id,
          symbol: t.symbol,
          assetType: "crypto" as const,
          side: t.side,
          quantity: t.quantity,
          price: t.price,
          fee: t.fee,
          time: t.time,
          nativeCurrency: null,
          nativePrice: null,
          nativeFee: null,
          note: t.note,
        })),
      },
    ],
    // Not seeded: the contract requires a virgin install, and seeding settings
    // is what makes `exists()` true.
  });

  // `BROKEN_PORTFOLIO_ID` is storage that will not answer. It is not in the
  // store — a list of one is what the contract asserts — so the failure has to
  // be injected here, and `Unreachable` is what marks it as "nothing answered"
  // rather than "something answered and said no".
  return {
    ...store,
    portfolios: {
      ...store.portfolios,
      get(id: string) {
        if (id === BROKEN_PORTFOLIO_ID) {
          return Promise.reject(new Unreachable("Local storage is unavailable."));
        }
        return store.portfolios.get(id);
      },
    },
  };
}

/**
 * Prices that make the fixture's two holdings worth `FIXTURE.totalValue`:
 * 0.5 BTC at 40 000 plus 2 ETH at 2 000. `valuation` is a real call here, so
 * the number has to come out of the arithmetic rather than out of the fixture.
 */
function seededNet(): Net {
  const prices: Record<string, number> = { BTCUSDT: 40_000, ETHUSDT: 2_000 };
  return FakeNet({
    "api.binance.com/api/v3/ticker/price": (url: string) => {
      const asked = JSON.parse(new URL(url).searchParams.get("symbols")!) as string[];
      return asked
        .filter((s) => prices[s] !== undefined)
        .map((s) => ({ symbol: s, price: String(prices[s]) }));
    },
    /**
     * Real bars, unlike the stub's empty array. The stub could leave this
     * empty because it canned every read that needed prices; this client
     * computes them, so `getSeries`, `getBenchmark` and `getHistory` all
     * arrive here. The grid honours `startTime`, `endTime` and `limit` so the
     * paginating `fetchKlinesRange` is driven the way the real API drives it.
     */
    "api.binance.com/api/v3/klines": (url: string) => {
      const q = new URL(url).searchParams;
      const step = q.get("interval") === "1h" ? 3_600_000 : 86_400_000;
      const limit = Number(q.get("limit") ?? 1000);
      const now = Date.now();
      const end = Math.min(Number(q.get("endTime") ?? now), now);
      const last = Math.floor(end / step) * step;
      const startTime = q.get("startTime");
      const first = startTime
        ? Math.floor(Number(startTime) / step) * step
        : last - (limit - 1) * step;
      const out: unknown[][] = [];
      // A symbol nobody lists has no bars. Without this the generator invents
      // prices for it and the "no data is not a missing record" case cannot be
      // reached at all.
      if (q.get("symbol")?.startsWith(FIXTURE.unknownSymbol)) return out;
      for (let t = first; t <= last && out.length < limit; t += step) {
        const close = q.get("symbol")?.startsWith("ETH") ? 2_000 : 40_000;
        out.push([t, "0", "0", "0", String(close), "0", t + step - 1, "0", 0, "0", "0", "0"]);
      }
      return out;
    },
    // The three the fixture names, plus the EUR pair the quote picker reads.
    // The stub listed two because it canned `listSymbols`; this one asks.
    "api.binance.com/api/v3/exchangeInfo": {
      symbols: [
        { symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", status: "TRADING", isSpotTradingAllowed: true },
        { symbol: "ETHUSDT", baseAsset: "ETH", quoteAsset: "USDT", status: "TRADING", isSpotTradingAllowed: true },
        { symbol: "SOLUSDT", baseAsset: "SOL", quoteAsset: "USDT", status: "TRADING", isSpotTradingAllowed: true },
        { symbol: "ETHEUR", baseAsset: "ETH", quoteAsset: "EUR", status: "TRADING", isSpotTradingAllowed: true },
      ],
    },
    // Yahoo's search, for the listed half of `searchAssets`. Without it the
    // device would find coins and nothing else, and the contract case would
    // pass on half the feature.
    "query1.finance.yahoo.com/v1/finance/search": {
      quotes: [
        { symbol: "ETR.DE", shortname: "Ethereum Tracker", quoteType: "ETF", exchDisp: "XETRA" },
      ],
    },
    // The markets board. Volumes clear the service's floor so the rows are not
    // filtered away; the point of the contract case is the shape, not the
    // ranking.
    "api.binance.com/api/v3/ticker/24hr": [
      { symbol: "BTCUSDT", lastPrice: "40000", priceChangePercent: "1.5", quoteVolume: "9e8" },
      { symbol: "ETHUSDT", lastPrice: "2000", priceChangePercent: "-2.5", quoteVolume: "5e8" },
    ],
    "api.coingecko.com": [
      { symbol: "btc", name: "Bitcoin", current_price: 40_000, price_change_percentage_24h: 1.5, market_cap: 1.2e12 },
    ],
    // Every equity chart, indices and constituents alike, answers the same
    // shape — the index page prices ten members off this one route.
    "query1.finance.yahoo.com/v8/finance/chart": {
      chart: { result: [{
        meta: {
          longName: "AEX-Index", fullExchangeName: "Amsterdam", currency: "EUR",
          exchangeTimezoneName: "Europe/Amsterdam", regularMarketPrice: 1100,
          chartPreviousClose: 1090, fiftyTwoWeekHigh: 1200, fiftyTwoWeekLow: 900,
          firstTradeDate: 718876800,
        },
        // Seconds, and inside the window the benchmark asks for: the stub's
        // literal `[1, 2]` is 1970, so every point fell outside and the
        // rebased series came back empty. It never noticed, because it canned
        // `getBenchmark`.
        timestamp: [
          Math.floor(FIXTURE.benchmarkFrom / 1000),
          Math.floor(FIXTURE.benchmarkFrom / 1000) + 86_400,
          Math.floor(Date.now() / 1000),
        ],
        indicators: { quote: [{ close: [1090, 1095, 1100] }] },
      }] },
    },
    "query1.finance.yahoo.com/v1/finance/screener": {
      finance: { result: [{ quotes: [
        { symbol: "NVDA", shortName: "Nvidia", regularMarketPrice: 178, regularMarketChangePercent: 1.1, marketCap: 4.3e12 },
      ] }] },
    },
  });
}

/**
 * `sources/*` memoise through a process-wide map, so a price scripted by one
 * test would otherwise satisfy the next one.
 */
beforeEach(() => invalidate());


/**
 * `sources/*` memoise through a process-wide map, so a price scripted by one
 * test would otherwise satisfy the next one.
 */
beforeEach(() => invalidate());

runDataClientContract(
  "LocalClient (services over MemoryStore)",
  () => LocalClient(seededStore(), seededNet()),
  // No alerts either: dispatch needs Home Assistant, web-push or FCM, and
  // this build has no server behind it to reach any of them.
  { testNotifications: false, computedReads: true, alerts: false },
);

/**
 * The contract is deliberately implementation-blind, so the things this
 * implementation exists to demonstrate are asserted here instead.
 */
describe("LocalClient answers from the services, not from the wire", () => {
  it("values the portfolio by arithmetic over the seeded rows", async () => {
    const out = await LocalClient(seededStore(), seededNet()).getValuation(PORTFOLIO_ID);
    // 0.5 x 40 000 + 2 x 2 000, computed rather than copied out of the fixture.
    expect(out.totals.value).toBe(24_000);
    expect(Object.fromEntries(out.holdings.map((h) => [h.symbol, h.value]))).toEqual({
      BTCUSDT: 20_000,
      ETHUSDT: 4_000,
    });
  });

  it("omits the capability it cannot have, rather than throwing from it", () => {
    // The whole argument in one line: a serverless client says "no" by not
    // having the method, which the compiler sees, instead of by failing at the
    // moment someone presses the button.
    expect(LocalClient(seededStore(), seededNet()).sendTestNotification).toBeUndefined();
  });

  it("keeps the record semantics the interface promises, with no route involved", async () => {
    const client = LocalClient(seededStore(), seededNet());
    await expect(client.getPortfolio(MISSING_PORTFOLIO_ID)).rejects.toBeInstanceOf(NotFoundError);
    await expect(client.deleteTransaction(TRANSACTION_ID)).resolves.toBeUndefined();
    // And it is really gone from the store behind it, not merely reported gone.
    const after = await client.getPortfolio(PORTFOLIO_ID);
    expect(after.transactions.map((t) => t.id)).toEqual(["t-0"]);
  });

  it("ties the series to the valuation on real numbers, not on two zeroes", async () => {
    // The contract's computed-read case asserts that the last series point
    // equals the valuation total. That is only worth having if both are
    // non-zero — comparing 0 to 0 would pass while proving nothing.
    const client = LocalClient(seededStore(), seededNet());
    const series = await client.getSeries(PORTFOLIO_ID, "1y");
    const valuation = await client.getValuation(PORTFOLIO_ID);
    expect(valuation.totals.value).toBe(24_000);
    expect(series.series[series.series.length - 1]!.value).toBeCloseTo(24_000, 6);
  });

  it("really restores a backup, rather than reporting that it did", async () => {
    const client = LocalClient(seededStore(), seededNet());
    const backup = JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      portfolio: {
        name: "Restored",
        transactions: [{
          symbol: "BTC", assetType: "crypto", side: "buy", quantity: 1, price: 100,
          fee: 0, time: 1_700_000_000_000, note: null,
        }],
      },
    });
    const out = await client.restoreBackup(backup);
    expect(out.restored).toBe(1);
    const back = await client.getPortfolio(out.id);
    expect(back.transactions).toHaveLength(1);
  });
});

/**
 * The state a phone is actually in most of the time.
 *
 * This is not in `client-contract.ts` because the two implementations
 * legitimately differ here, and the difference is the whole point of the
 * device build: `HttpClient` with no network has nothing to answer with, so it
 * throws. `LocalClient` still has the ledger — it is on the device — and only
 * the prices are missing.
 *
 * R2's stated mitigation in the strategy document is "never a silent zero": a
 * broken source must degrade honestly, saying "no price" and staying out of
 * the totals rather than reporting nothing as if it were zero. These are the
 * tests that make that true rather than intended.
 */
describe("LocalClient with the price feed offline", () => {
  const offline = () => FakeNet({});

  it("still reports what is held, from the device", async () => {
    const client = LocalClient(seededStore(), offline());
    const out = await client.getValuation(PORTFOLIO_ID);
    expect(out.holdings.length).toBeGreaterThan(0);
    for (const h of out.holdings) {
      expect(h.quantity).toBeGreaterThan(0);
      expect(h.costBasis).toBeGreaterThan(0);
    }
  });

  it("says it has no price, rather than calling it zero", async () => {
    const out = await LocalClient(seededStore(), offline()).getValuation(PORTFOLIO_ID);
    for (const h of out.holdings) {
      expect(h.price).toBeNull();
      expect(h.value).toBeNull();
      // The failure this guards: a `?? 0` anywhere on this path turns an
      // unreachable feed into a portfolio that appears to be worth nothing.
      expect(h.value).not.toBe(0);
    }
  });

  it("keeps an unpriced holding out of the total instead of counting it as nothing", async () => {
    const out = await LocalClient(seededStore(), offline()).getValuation(PORTFOLIO_ID);
    expect(out.totals.value).toBe(0);
    // Zero *because nothing could be priced*, and the rows above say so. The
    // distinction is only legible because each holding reports null rather
    // than a number, which is why the previous case matters.
    expect(out.holdings.every((h) => h.value === null)).toBe(true);
  });

  it("does not throw, so the screen renders rather than showing an error", async () => {
    // The services degrade on purpose. A client that turned an offline feed
    // into a rejection would replace a readable portfolio with a message.
    await expect(LocalClient(seededStore(), offline()).getPortfolio(PORTFOLIO_ID)).resolves
      .toMatchObject({ id: PORTFOLIO_ID });
  });
});
