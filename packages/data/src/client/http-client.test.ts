import { describe, expect, it } from "vitest";
import { RequestFailedError } from "../errors";
import { FakeNet, rejectWith, respondWith } from "../testing/fake-net";
import type { FakeNetInstance } from "../testing/fake-net";
import { HttpClient } from "./http-client";
import {
  BROKEN_PORTFOLIO_ID,
  FIXTURE,
  GONE_PORTFOLIO_ID,
  GONE_TRANSACTION_ID,
  MISSING_PORTFOLIO_ID,
  PORTFOLIO_ID,
  runDataClientContract,
} from "./client-contract";

/** The method a route was called with, defaulting the way `fetch` does. */
const method = (init?: RequestInit) => init?.method ?? "GET";

/** Which portfolio a `/api/portfolios/<id>/…` URL is about. */
const idIn = (url: string) => url.split("/api/portfolios/")[1]!.split(/[/?]/)[0]!;

/**
 * A 404 with the body the routes actually send, for a portfolio that is not
 * there; a 500 for the delete paths, which is all Prisma's `P2025` leaves them
 * able to say (see `store-contract.ts`).
 */
const notFound = respondWith(404, { error: "not found" });
const serverError = respondWith(500, "Internal Server Error");

const summary = {
  id: FIXTURE.portfolio.id,
  name: FIXTURE.portfolio.name,
  createdAt: FIXTURE.portfolio.createdAt,
  transactionCount: FIXTURE.portfolio.transactionCount,
};

/**
 * The routes as they answer today, exactly: the envelopes (`{ portfolios }`,
 * `{ portfolio }`, `{ transaction }`, `{ deleted }`, `{ settings }`) are the
 * server's wire format, and `HttpClient`'s job is to be the last place that
 * knows about them.
 */
function seededNet(): FakeNetInstance {
  // Per-client, because the contract requires settings to start unwritten and
  // to read back once saved — a fresh install that goes through setup.
  let settingsWritten = false;

  return FakeNet({
    "/api/portfolios": (_url: string, init?: RequestInit) => {
      // Only the collection itself; every id-bearing path has a longer key.
      if (method(init) === "POST") {
        return { portfolio: { id: "p-new", name: FIXTURE.newPortfolioName, createdAt: FIXTURE.portfolio.createdAt, updatedAt: FIXTURE.portfolio.updatedAt } };
      }
      return { portfolios: [summary] };
    },
    "/api/portfolios/restore": (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { backup?: string };
      return body.backup === FIXTURE.badBackup
        ? respondWith(400, { error: "unreadable backup" })
        : FIXTURE.restored;
    },
    "/api/portfolios/p-": (url: string, init?: RequestInit) => {
      // Everything addressed to one portfolio. Split by the sub-path so a
      // missing id fails the same way for all of them.
      const id = idIn(url);
      const sub = url.split(`/api/portfolios/${id}`)[1] ?? "";
      const missing = id === MISSING_PORTFOLIO_ID;

      if (sub.startsWith("/valuation")) {
        if (id === BROKEN_PORTFOLIO_ID) return rejectWith(new TypeError("Failed to fetch"));
        return missing ? notFound : {
          holdings: [{ symbol: "BTCUSDT", quantity: 0.5, value: FIXTURE.totalValue }],
          totals: { value: FIXTURE.totalValue },
          currency: FIXTURE.currency,
          rate: 1,
        };
      }
      if (sub.startsWith("/series")) {
        return missing ? notFound
          : { series: [FIXTURE.seriesPoint], currency: FIXTURE.currency, range: FIXTURE.range };
      }
      if (sub.startsWith("/changes")) {
        return missing ? notFound : { range: FIXTURE.range, changes: FIXTURE.changes };
      }
      if (sub.startsWith("/insights")) {
        return missing ? notFound
          : { currency: FIXTURE.currency, stats: {}, byYear: [{ year: 2026, net: 100 }] };
      }
      if (sub.startsWith("/snapshot")) {
        return missing ? notFound : {
          date: FIXTURE.snapshotDate, currency: FIXTURE.currency, rows: [], total: FIXTURE.totalValue,
        };
      }
      if (sub.startsWith("/transactions")) {
        return missing ? notFound : {
          transaction: { ...FIXTURE.newTransaction, id: "t-new", portfolioId: id, note: null },
        };
      }
      if (sub.startsWith("/import")) {
        if (method(init) === "DELETE") return { deleted: missing ? 0 : FIXTURE.clearedCount };
        return missing ? notFound : FIXTURE.importReport;
      }
      if (method(init) === "DELETE") return id === GONE_PORTFOLIO_ID ? serverError : { ok: true };
      return missing ? notFound : {
        portfolio: {
          id, name: FIXTURE.portfolio.name, createdAt: FIXTURE.portfolio.createdAt,
          transactions: FIXTURE.transactions,
        },
      };
    },
    "/api/transactions/": (url: string) =>
      url.includes(GONE_TRANSACTION_ID) ? serverError : { ok: true },
    "/api/benchmark": {
      key: FIXTURE.benchmarkKey, label: "S&P 500",
      points: [{ t: FIXTURE.benchmarkFrom, index: 100 }], sameFlows: null,
    },
    "/api/history": (url: string) =>
      url.includes(FIXTURE.unknownSymbol)
        // What the route sends for a symbol no feed knows: the thin shape
        // `history` returns from its own catch, never a 404.
        ? { bars: [], range: FIXTURE.range, changePct: null, error: "no data" }
        : { bars: [{ t: FIXTURE.benchmarkFrom, c: 40_000 }], range: FIXTURE.range, changePct: 1.2 },
    "/api/symbols": { symbols: FIXTURE.symbols },
    "/api/asset/": {
      symbol: FIXTURE.historySymbol, about: null, tags: [], stats: [],
      sentiment: null, news: [], sources: [],
    },
    "/api/settings": (_url: string, init?: RequestInit) => {
      if (method(init) === "POST") return { ok: true, results: {} };
      if (method(init) === "PUT") { settingsWritten = true; return { settings: FIXTURE.settings }; }
      // Before /api/setup has ever run the route answers a bare null, which is
      // first-run rather than a missing record.
      return { settings: settingsWritten ? FIXTURE.settings : null };
    },
  });
}

runDataClientContract("HttpClient", () => HttpClient(seededNet()));

/**
 * What the contract cannot reach, because one seeded client cannot be two
 * worlds at once, and what is `HttpClient`'s alone: the shape of the requests
 * it puts on the wire. Those are the whole behavioural promise of this task —
 * the same path, method and body the screens send today.
 */
describe("HttpClient issues the requests the screens issue today", () => {
  it("reads a portfolio list from /api/portfolios with no init of its own", async () => {
    const net = FakeNet({ "/api/portfolios": { portfolios: [summary] } });
    await HttpClient(net).listPortfolios();
    expect(net.calls[0]!.url).toBe("/api/portfolios");
    expect(method(net.calls[0]!.init)).toBe("GET");
  });

  it("posts a new portfolio as JSON", async () => {
    const net = FakeNet({ "/api/portfolios": { portfolio: { id: "p-new", name: "Second" } } });
    await HttpClient(net).createPortfolio("Second");
    expect(net.calls[0]!.init).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Second" }),
    });
  });

  it("puts the range on the series and changes URLs", async () => {
    const net = seededNet();
    const client = HttpClient(net);
    await client.getSeries(PORTFOLIO_ID, "1y");
    await client.getChanges(PORTFOLIO_ID, "1y");
    expect(net.calls.map((c) => c.url)).toEqual([
      `/api/portfolios/${PORTFOLIO_ID}/series?range=1y`,
      `/api/portfolios/${PORTFOLIO_ID}/changes?range=1y`,
    ]);
  });

  it("builds the benchmark URL the insights screen builds", async () => {
    const net = seededNet();
    await HttpClient(net).getBenchmark({
      key: "sp500", from: 1_750_000_000_000, barMs: 86_400_000,
      portfolioId: PORTFOLIO_ID, opening: 1_234,
    });
    expect(net.calls[0]!.url).toBe(
      `/api/benchmark?key=sp500&from=1750000000000&barMs=86400000&portfolioId=${PORTFOLIO_ID}&opening=1234`,
    );
  });

  it("omits benchmark parameters that were not given, rather than sending empty ones", async () => {
    const net = seededNet();
    await HttpClient(net).getBenchmark({ key: "btc", from: 1 });
    expect(net.calls[0]!.url).toBe("/api/benchmark?key=btc&from=1");
  });

  it("encodes the symbol in the history and asset URLs", async () => {
    const net = seededNet();
    const client = HttpClient(net);
    await client.getHistory("IWDA.AS", "equity", "2y");
    await client.getAssetInfo("BRK.B", "equity");
    expect(net.calls.map((c) => c.url)).toEqual([
      "/api/history?symbol=IWDA.AS&assetType=equity&range=2y",
      "/api/asset/BRK.B?assetType=equity",
    ]);
  });

  it("posts the CSV text as JSON, the way the import screen does", async () => {
    const net = seededNet();
    await HttpClient(net).importCsv(PORTFOLIO_ID, "a,b\n1,2");
    expect(net.calls[0]!.url).toBe(`/api/portfolios/${PORTFOLIO_ID}/import`);
    expect(net.calls[0]!.init).toMatchObject({
      method: "POST",
      body: JSON.stringify({ csv: "a,b\n1,2" }),
    });
  });

  it("prefixes a base URL when given one, so a device can point at a server", async () => {
    const net = FakeNet({ "/api/symbols": { symbols: [] } });
    await HttpClient(net, "https://contour.example").listSymbols();
    expect(net.calls[0]!.url).toBe("https://contour.example/api/symbols");
  });

  it("accepts a delete that answers with no body at all", async () => {
    // A 2xx with an empty body: what a 204 looks like. The delete callers
    // discard the body, so reading it could only ever turn a success into a
    // `RequestFailedError`.
    const net = FakeNet({ "/api/transactions/": "" });
    await expect(HttpClient(net).deleteTransaction("t-1")).resolves.toBeUndefined();
  });

  it("leaves a 404 from a symbol-shaped call as a plain failure, not a missing record", async () => {
    // `NotFoundError` means "no such record of ours". A price feed 404 is not
    // that, and the interface never promised it would be.
    const net = FakeNet({ "/api/symbols": respondWith(404, "gone") });
    await expect(HttpClient(net).listSymbols()).rejects.toBeInstanceOf(RequestFailedError);
  });

  it("digs the message out of a JSON error body, the way the screens do today", async () => {
    const net = FakeNet({ "/api/portfolios/restore": respondWith(400, { error: "not a backup" }) });
    await expect(HttpClient(net).restoreBackup("{}")).rejects.toThrow("not a backup");
  });

  it("carries the server's own words into the error a screen shows", async () => {
    const net = FakeNet({ "/api/settings": respondWith(400, "displayCurrency must be USD or EUR") });
    await expect(HttpClient(net).saveSettings({ displayCurrency: "EUR" })).rejects.toThrow(
      "displayCurrency must be USD or EUR",
    );
  });
});
