import { describe, expect, it } from "vitest";
import { NotFoundError, RequestFailedError } from "../errors";
import type { DataClient, NewTransactionInput } from "./data-client";

/**
 * One suite, run against every `DataClient`. `HttpClient` passes it today;
 * Phase 4's `LocalClient` has to pass the same one, which is the only thing
 * that will stop a screen behaving differently inside the APK than it does in
 * a browser.
 *
 * It is written the way `store-contract.ts` is, with one difference forced by
 * the subject: a `Store` starts empty and the suite fills it, but a client has
 * nothing behind it that the suite can write to and then read back. So the
 * fixture below is the *specification of the seed*. Each implementation's test
 * arranges its own world to match — `HttpClient` with a `FakeNet` serving these
 * bodies, `LocalClient` with a `MemoryStore` holding these records — and the
 * assertions are then identical for both.
 *
 * The seed deliberately contains records that fail: `MISSING_PORTFOLIO_ID` does
 * not exist, `GONE_PORTFOLIO_ID` no longer exists and its route cannot say so
 * politely, and `BROKEN_PORTFOLIO_ID` exists but cannot be reached. Three ids
 * rather than one because a missing record and an unreachable one are two
 * different guarantees, and because the delete paths report absence differently
 * from the read paths (see `data-client.ts`).
 */

/** Exists, and every read about it succeeds. */
export const PORTFOLIO_ID = "p-main";
/** Never existed. Reads about it must throw `NotFoundError`. */
export const MISSING_PORTFOLIO_ID = "p-missing";
/** Gone. Deleting it must throw `RequestFailedError` — the routes answer 500. */
export const GONE_PORTFOLIO_ID = "p-gone";
/** Exists on paper, but the call to fetch it fails at transport. */
export const BROKEN_PORTFOLIO_ID = "p-broken";

export const TRANSACTION_ID = "t-1";
export const GONE_TRANSACTION_ID = "t-gone";

/**
 * The world every implementation must be seeded with. Exported so a harness
 * builds its fixtures from the same constants the assertions read, rather than
 * from a copy that can drift out of agreement with them.
 */
export const FIXTURE = {
  portfolio: {
    id: PORTFOLIO_ID,
    name: "Main",
    createdAt: "2026-01-02T00:00:00.000Z",
    updatedAt: "2026-01-03T00:00:00.000Z",
    transactionCount: 2,
  },
  /** Newest first, as `getPortfolio` promises. */
  transactions: [
    {
      id: TRANSACTION_ID,
      portfolioId: PORTFOLIO_ID,
      symbol: "BTCUSDT",
      side: "buy" as const,
      quantity: 0.5,
      price: 40_000,
      fee: 10,
      time: 1_760_000_000_000,
      note: null,
    },
    {
      id: "t-0",
      portfolioId: PORTFOLIO_ID,
      symbol: "ETHUSDT",
      side: "buy" as const,
      quantity: 2,
      price: 2_000,
      fee: 4,
      time: 1_750_000_000_000,
      note: "older",
    },
  ],
  /** What `createPortfolio` is asked for, and what it must answer with. */
  newPortfolioName: "Second",
  newTransaction: {
    symbol: "SOLUSDT",
    side: "buy",
    quantity: 3,
    price: 150,
    fee: 1,
    time: 1_761_000_000_000,
  } satisfies NewTransactionInput,
  currency: "USD" as const,
  totalValue: 24_000,
  range: "1m" as const,
  seriesPoint: { t: 1_760_000_000_000, value: 24_000 },
  changes: { BTCUSDT: 4.5 },
  snapshotDate: "2026-01-01",
  benchmarkKey: "sp500" as const,
  benchmarkFrom: 1_750_000_000_000,
  historySymbol: "BTCUSDT",
  symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
  /** A symbol nothing has prices for. Not a missing *record*: see the case below. */
  unknownSymbol: "NOTASYMBOL",
  /**
   * The seed has **never had settings written**, which is what a fresh install
   * looks like. `getSettings` must answer `null` for it, and only after
   * `saveSettings` may it answer a row. Seeding it the other way round is how
   * the exception went unpinned: a `LocalClient` calling `getSettings(store)`,
   * which defaults unconditionally, would hand a fresh device a form full of
   * defaults where the browser shows first-run.
   */
  settings: {
    id: 1,
    displayCurrency: "USD" as const,
    equityProvider: "yahoo",
    equityApiKey: null,
    haUrl: "http://ha.local",
    haWebhookId: "contour",
    mqttBrokerUrl: null,
    mqttTopicPrefix: null,
  },
  csv: "Date,Type,Base amount\n",
  importReport: { imported: 3, duplicates: 1, skipped: [], warnings: [] },
  /** What a CSV import into `PORTFOLIO_ID` has left behind. */
  clearedCount: 3,
  backup: '{"portfolio":{"name":"Main","transactions":[]}}',
  /** Unreadable: `restoreBackup` must reject it. */
  badBackup: "not json at all",
  restored: { id: "p-restored", name: "Main (restored)", restored: 7 },
};

export function runDataClientContract(name: string, makeClient: () => DataClient): void {
  describe(`${name} satisfies the DataClient contract`, () => {
    /* ---------------------------------------------------------- portfolios */

    it("lists portfolios with their transaction counts", async () => {
      const list = await makeClient().listPortfolios();
      expect(list).toEqual([
        {
          id: FIXTURE.portfolio.id,
          name: FIXTURE.portfolio.name,
          createdAt: FIXTURE.portfolio.createdAt,
          transactionCount: FIXTURE.portfolio.transactionCount,
        },
      ]);
    });

    it("reads one portfolio with its transactions newest-first", async () => {
      const detail = await makeClient().getPortfolio(PORTFOLIO_ID);
      expect(detail.id).toBe(PORTFOLIO_ID);
      expect(detail.name).toBe(FIXTURE.portfolio.name);
      expect(detail.transactions.map((t) => t.time)).toEqual([
        FIXTURE.transactions[0]!.time,
        FIXTURE.transactions[1]!.time,
      ]);
      // ms numbers, not ISO strings and not BigInt — the same promise the
      // Store contract makes, carried across this boundary unchanged.
      expect(typeof detail.transactions[0]!.time).toBe("number");
    });

    it("creates a portfolio under the name it was given", async () => {
      const created = await makeClient().createPortfolio(FIXTURE.newPortfolioName);
      expect(created.name).toBe(FIXTURE.newPortfolioName);
      expect(created.id).toBeTruthy();
    });

    it("deletes a portfolio", async () => {
      await expect(makeClient().deletePortfolio(PORTFOLIO_ID)).resolves.toBeUndefined();
    });

    /* -------------------------------------------------------- transactions */

    it("adds a transaction and hands back what was stored", async () => {
      const tx = await makeClient().addTransaction(PORTFOLIO_ID, FIXTURE.newTransaction);
      expect(tx.symbol).toBe(FIXTURE.newTransaction.symbol);
      expect(tx.quantity).toBe(FIXTURE.newTransaction.quantity);
      expect(tx.time).toBe(FIXTURE.newTransaction.time);
      expect(tx.id).toBeTruthy();
    });

    it("deletes a transaction", async () => {
      await expect(makeClient().deleteTransaction(TRANSACTION_ID)).resolves.toBeUndefined();
    });

    /* ------------------------------------------------------------ the money */

    it("values a portfolio in its display currency", async () => {
      const valuation = await makeClient().getValuation(PORTFOLIO_ID);
      expect(valuation.currency).toBe(FIXTURE.currency);
      expect(valuation.totals.value).toBe(FIXTURE.totalValue);
      expect(valuation.holdings.length).toBeGreaterThan(0);
    });

    it("returns a value series for a range", async () => {
      const series = await makeClient().getSeries(PORTFOLIO_ID, FIXTURE.range);
      expect(series.range).toBe(FIXTURE.range);
      expect(series.series).toEqual([FIXTURE.seriesPoint]);
    });

    it("returns per-asset changes for a range", async () => {
      const changes = await makeClient().getChanges(PORTFOLIO_ID, FIXTURE.range);
      expect(changes.range).toBe(FIXTURE.range);
      expect(changes.changes).toEqual(FIXTURE.changes);
    });

    it("returns insights", async () => {
      const insights = await makeClient().getInsights(PORTFOLIO_ID);
      expect(insights.currency).toBe(FIXTURE.currency);
      expect(insights.byYear.length).toBeGreaterThan(0);
    });

    it("returns a snapshot for one date", async () => {
      const snapshot = await makeClient().getSnapshot(PORTFOLIO_ID, FIXTURE.snapshotDate);
      expect(snapshot.date).toBe(FIXTURE.snapshotDate);
      expect(snapshot.total).toBe(FIXTURE.totalValue);
    });

    it("returns a benchmark rebased over the window it was given", async () => {
      const bench = await makeClient().getBenchmark({
        key: FIXTURE.benchmarkKey,
        from: FIXTURE.benchmarkFrom,
        portfolioId: PORTFOLIO_ID,
        opening: 100,
      });
      expect(bench.key).toBe(FIXTURE.benchmarkKey);
      expect(bench.points.length).toBeGreaterThan(0);
    });

    it("returns price history for one symbol", async () => {
      const history = await makeClient().getHistory(FIXTURE.historySymbol, "crypto", FIXTURE.range);
      expect(history.range).toBe(FIXTURE.range);
      expect(history.bars.length).toBeGreaterThan(0);
    });

    /* ------------------------------------------------------------ reference */

    it("lists tradable symbols", async () => {
      await expect(makeClient().listSymbols()).resolves.toEqual(FIXTURE.symbols);
    });

    it("returns background for one asset", async () => {
      const info = await makeClient().getAssetInfo(FIXTURE.historySymbol, "crypto");
      expect(info.symbol).toBe(FIXTURE.historySymbol);
    });

    it("treats a symbol with no data as empty, not as a missing record", async () => {
      // A symbol is not a record this app owns, so "no prices for it" is a thin
      // answer rather than a `NotFoundError` — the asset page draws an empty
      // chart beside a real position. Pinned because `HttpClient` maps 404 to
      // `NotFoundError` for the record-addressed calls, and an implementation
      // that extended that to symbols would blank the page instead.
      const history = await makeClient().getHistory(FIXTURE.unknownSymbol, "crypto", FIXTURE.range);
      expect(history.bars).toEqual([]);
    });

    /* ------------------------------------------------------------- settings */

    it("answers null for settings that were never written, not a row of defaults", async () => {
      // The third of the interface's three departures from "a missing record
      // throws", and the only one a user meets on the first launch of the app.
      // `store.settings.exists()` is the port that makes it answerable without
      // a `Store` handing back defaults first.
      await expect(makeClient().getSettings()).resolves.toBeNull();
    });

    it("saves settings and answers with the saved row", async () => {
      const saved = await makeClient().saveSettings({ displayCurrency: "USD" });
      expect(saved).toEqual(FIXTURE.settings);
    });

    it("reads back settings once they have been written", async () => {
      const client = makeClient();
      await client.saveSettings({ displayCurrency: "USD" });
      await expect(client.getSettings()).resolves.toEqual(FIXTURE.settings);
    });

    it("sends a test notification", async () => {
      await expect(makeClient().sendTestNotification()).resolves.toBeUndefined();
    });

    /* --------------------------------------------------- import and restore */

    it("imports a CSV and reports what it did", async () => {
      await expect(makeClient().importCsv(PORTFOLIO_ID, FIXTURE.csv)).resolves.toEqual(
        FIXTURE.importReport,
      );
    });

    it("clears imported transactions and reports how many", async () => {
      await expect(makeClient().clearImported(PORTFOLIO_ID)).resolves.toBe(FIXTURE.clearedCount);
    });

    it("restores a backup into a new portfolio", async () => {
      await expect(makeClient().restoreBackup(FIXTURE.backup)).resolves.toEqual(FIXTURE.restored);
    });

    it("rejects an unreadable backup with a typed error", async () => {
      await expect(makeClient().restoreBackup(FIXTURE.badBackup)).rejects.toBeInstanceOf(
        RequestFailedError,
      );
    });

    /* ------------------------------------------------- a record that is gone */

    it("throws NotFoundError, not null, for every read of a portfolio that does not exist", async () => {
      const client = makeClient();
      const reads: Promise<unknown>[] = [
        client.getPortfolio(MISSING_PORTFOLIO_ID),
        client.getValuation(MISSING_PORTFOLIO_ID),
        client.getSeries(MISSING_PORTFOLIO_ID, FIXTURE.range),
        client.getChanges(MISSING_PORTFOLIO_ID, FIXTURE.range),
        client.getInsights(MISSING_PORTFOLIO_ID),
        client.getSnapshot(MISSING_PORTFOLIO_ID, FIXTURE.snapshotDate),
      ];
      for (const read of reads) {
        await expect(read).rejects.toBeInstanceOf(NotFoundError);
      }
    });

    it("throws NotFoundError when writing into a portfolio that does not exist", async () => {
      const client = makeClient();
      await expect(
        client.addTransaction(MISSING_PORTFOLIO_ID, FIXTURE.newTransaction),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(client.importCsv(MISSING_PORTFOLIO_ID, FIXTURE.csv)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it("clears nothing, rather than throwing, for a portfolio that does not exist", async () => {
      // The one place absence is a number. `DELETE …/import` answers
      // `{ deleted: 0 }` either way, so both implementations must agree to
      // report the same nothing.
      await expect(makeClient().clearImported(MISSING_PORTFOLIO_ID)).resolves.toBe(0);
    });

    it("fails a delete of something already gone with RequestFailedError", async () => {
      // Not `NotFoundError`: those routes answer 500 for an unknown id and no
      // client can tell that from a database that fell over.
      const client = makeClient();
      await expect(client.deletePortfolio(GONE_PORTFOLIO_ID)).rejects.toBeInstanceOf(
        RequestFailedError,
      );
      await expect(client.deleteTransaction(GONE_TRANSACTION_ID)).rejects.toBeInstanceOf(
        RequestFailedError,
      );
    });

    /* --------------------------------------------------- a failure in transit */

    it("surfaces an unreachable backend as RequestFailedError, never as undefined", async () => {
      const promise = makeClient().getValuation(BROKEN_PORTFOLIO_ID);
      await expect(promise).rejects.toBeInstanceOf(RequestFailedError);
      // The screens show what went wrong; an empty message reduces every
      // failure to the same blank banner.
      await expect(promise).rejects.toSatisfy(
        (e: Error) => e.message.length > 0,
        "the error carries a message",
      );
    });
  });
}
