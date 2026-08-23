import { beforeEach, describe, expect, it } from "vitest";
import { invalidate } from "@/core/cache";
import type { RangeKey } from "@/core/ranges";
import type { AssetInfo } from "@/core/asset-info";
import { NotFoundError, RequestFailedError } from "../errors";
import type { Net } from "../ports/net";
import type { SettingsPatch, Store, Transaction } from "../ports/store";
import { FakeNet } from "../testing/fake-net";
import { MemoryStore } from "../testing/memory-store";
import * as portfolios from "../services/portfolios";
import * as settingsService from "../services/settings";
import * as transactions from "../services/transactions";
import { restore } from "../services/transfer";
import type { ImportReport } from "../services/transfer";
import type { Benchmark, Changes, History, Series } from "../services/series";
import { insights, valuation } from "../services/valuation";
import type { Insights, Snapshot, Valuation } from "../services/valuation";
import type {
  BenchmarkQuery,
  DataClient,
  NewTransactionInput,
  PortfolioDetail,
  PortfolioRef,
  PortfolioSummary,
  RestoreResult,
  SettingsDto,
  TransactionDto,
} from "./data-client";
import {
  BROKEN_PORTFOLIO_ID,
  FIXTURE,
  MISSING_PORTFOLIO_ID,
  PORTFOLIO_ID,
  TRANSACTION_ID,
  runDataClientContract,
} from "./client-contract";

/**
 * The second implementation, and the reason there is one.
 *
 * Until now `client-contract.ts` ran against `HttpClient` alone, which proves
 * only that `HttpClient` agrees with itself. The question the contract exists
 * to answer is whether a client with *no server behind it* — the shape Phase 4
 * has to build — can satisfy the same promises, or whether the interface has
 * quietly been drawn around HTTP. Finding that out costs an afternoon here and
 * a rewrite in Phase 4.
 *
 * `StubClient` is not `LocalClient` and is not shipped: it lives in a test file
 * on purpose, because a half-real client in `src/` would get imported by
 * something. Where it can, it calls the very services Phase 4's `LocalClient`
 * will call — `portfolios`, `transactions`, `settings`, `transfer`,
 * `valuation`, `insights` — against a `MemoryStore` and a `FakeNet`. Where the
 * fixture pins a value no computation can produce (see below) it answers with
 * the fixture. Every canned method is marked `CANNED` so nobody reads more
 * portability into this file than it earns.
 *
 * ## What running the contract against it taught us
 *
 * **The interface is not HTTP-shaped.** Nothing in `DataClient` needed a URL, a
 * status code, a header or a request body to be expressible, and the parts that
 * carry the real semantics — `NotFoundError` for a record this app owns,
 * newest-first transactions, `null` settings on a virgin install, ms timestamps
 * — all fell out of the services and the `Store` port without argument. That is
 * the headline, and it is the good news.
 *
 * **Four contract cases were HTTP-shaped, and three still are.**
 *
 * 1. *Settings.* `saveSettings({ displayCurrency: "USD" })` was asserted to
 *    answer a row carrying `haUrl: "http://ha.local"` — reachable only for a
 *    mocked server, since a store-backed client that (as the previous case
 *    requires) has never had settings written has no `haUrl` to return. Fixed:
 *    the case now saves `FIXTURE.settingsPatch`, the whole row, which is the
 *    same test for `HttpClient` and a satisfiable one for everything else.
 * 2. *`sendTestNotification`.* The contract demanded a resolved `void` from a
 *    method a serverless client cannot implement, so the only way to pass was
 *    for this stub to *pretend*. Fixed, and it is the finding that shaped the
 *    optional-capability rule now written into `data-client.ts`: the method is
 *    optional, this stub omits it, and the suite is told which implementations
 *    claim it.
 * 3. *`restoreBackup` (partly fixed, partly still canned).* `FIXTURE.backup`
 *    was not a backup: it carried neither `version` nor `exportedAt`, so the
 *    parser rejects it, and the "good backup" case had been reaching the same
 *    branch as the bad one for as long as `FakeNet` was the only reader. The
 *    literal is now valid. What remains canned is the answer: `FIXTURE.restored`
 *    pins
 *    `id: "p-restored"` and `restored: 7` against a backup literal holding zero
 *    transactions. No implementation that actually restores can produce either
 *    number; only a mock can. The reject path is real here — `restore()` is
 *    called and its `InvalidBackupError` mapped — but the success path cannot
 *    be. Phase 4 should loosen those two assertions to "an id came back" and
 *    "as many as the backup held".
 * 4. *`getValuation` on `BROKEN_PORTFOLIO_ID` (still shaped, but honestly met).*
 *    The contract wants a `RequestFailedError` with `kind: "unreachable"`. A
 *    service-backed client cannot get there through a dead *price feed*: the
 *    valuation services degrade on purpose, reporting what they can rather than
 *    failing the page. So this stub arranges the only unreachability a device
 *    actually has — storage that will not read — which is a faithful analogue
 *    rather than a contortion, and is exactly the case `data-client.ts` says
 *    `LocalClient` must get right. Worth writing down for Phase 4: a
 *    `LocalClient` whose price feed is offline will resolve with stale figures,
 *    not throw, and no contract case covers that yet.
 *
 * **Five reads are canned because the fixture specifies outputs, not inputs.**
 * `getSeries`, `getChanges`, `getSnapshot`, `getBenchmark` and `getHistory` are
 * asserted against exact arrays — one series point at a fixed timestamp, a
 * single change of 4.5%. Those services anchor their windows to "now" and
 * derive their numbers from a price feed, so no seed produces them; the
 * `HttpClient` harness meets them by having `FakeNet` read them straight back
 * out of `FIXTURE`, and this one does the same one layer in. The cost is
 * honest and bounded: for those five the contract checks the DTO shape and the
 * `NotFoundError` mapping, not the arithmetic — which is what the service tests
 * in `../services/*.test.ts` are for.
 */

const ISO = (t: number) => new Date(t).toISOString();

/** The DTO the interface promises, out of the row the `Store` holds. */
function toDto(t: Transaction): TransactionDto {
  return {
    id: t.id,
    portfolioId: t.portfolioId,
    symbol: t.symbol,
    side: t.side,
    quantity: t.quantity,
    price: t.price,
    fee: t.fee,
    time: t.time,
    note: t.note,
  };
}

/**
 * Anything a service threw that is not a missing record becomes the interface's
 * one other error. `kind` is decided by the thrower: `Unreachable` is what the
 * seeded storage failure below raises, and stands in for the device case where
 * the thing being read is simply not there to read.
 */
class Unreachable extends Error {}

function translate(e: unknown): never {
  if (e instanceof NotFoundError) throw e;
  if (e instanceof RequestFailedError) throw e;
  const reason = e instanceof Error ? e.message : String(e);
  throw new RequestFailedError(reason, reason, e instanceof Unreachable ? "unreachable" : "refused");
}

async function attempt<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    translate(e);
  }
}

/**
 * A `DataClient` over a `Store` and a `Net` — no routes, no envelopes, no
 * statuses.
 */
function StubClient(store: Store, net: Net): DataClient {
  /** The existence check the record-addressed reads owe the interface. */
  async function mustExist(id: string): Promise<void> {
    const found = await store.portfolios.get(id);
    if (!found) throw new NotFoundError(`No such portfolio (${id}).`);
  }

  return {
    /* ------------------------------------------------------------ portfolios */

    async listPortfolios(): Promise<PortfolioSummary[]> {
      return attempt(async () => {
        const [rows, counts] = await Promise.all([
          portfolios.listPortfolios(store),
          store.transactions.countByPortfolio(),
        ]);
        return rows.map((p) => ({
          id: p.id,
          name: p.name,
          createdAt: ISO(p.createdAt),
          transactionCount: counts[p.id] ?? 0,
        }));
      });
    },

    async getPortfolio(id: string): Promise<PortfolioDetail> {
      return attempt(async () => {
        const p = await portfolios.getPortfolio(store, id);
        return {
          id: p.id,
          name: p.name,
          createdAt: ISO(p.createdAt),
          // The Store contract hands these back oldest-first; the interface
          // promises the reverse, and that reordering is the client's job on
          // either side of the seam.
          transactions: [...p.transactions].sort((a, b) => b.time - a.time).map(toDto),
        };
      });
    },

    async createPortfolio(name: string): Promise<PortfolioRef> {
      return attempt(async () => {
        const p = await portfolios.createPortfolio(store, name);
        return { id: p.id, name: p.name, createdAt: ISO(p.createdAt), updatedAt: ISO(p.updatedAt) };
      });
    },

    async deletePortfolio(id: string): Promise<void> {
      // `RequestFailedError`, not `NotFoundError`, for an id that is gone: the
      // Store's `remove` throws and the interface has already decided that a
      // failed delete is indistinguishable from a database that fell over.
      await attempt(() => portfolios.deletePortfolio(store, id));
    },

    /* ---------------------------------------------------------- transactions */

    async addTransaction(portfolioId: string, tx: NewTransactionInput): Promise<TransactionDto> {
      return attempt(async () => {
        const row = await transactions.addTransaction(store, portfolioId, {
          ...tx,
          // The defaults the manual-entry route has always applied; the input
          // DTO deliberately cannot express anything else.
          assetType: "crypto",
          nativeCurrency: null,
          nativePrice: null,
          nativeFee: null,
          note: tx.note ?? null,
        });
        return toDto(row);
      });
    },

    async deleteTransaction(id: string): Promise<void> {
      await attempt(() => transactions.deleteTransaction(store, id));
    },

    /* -------------------------------------------------------------- the money */

    getValuation(portfolioId: string): Promise<Valuation> {
      return attempt(() => valuation(store, net, portfolioId));
    },

    /** CANNED — the service anchors its window to "now". */
    async getSeries(portfolioId: string, range: RangeKey): Promise<Series> {
      await mustExist(portfolioId);
      return { series: [FIXTURE.seriesPoint], currency: FIXTURE.currency, range };
    },

    /** CANNED — as `getSeries`. */
    async getChanges(portfolioId: string, range: RangeKey): Promise<Changes> {
      await mustExist(portfolioId);
      return { range, changes: FIXTURE.changes };
    },

    getInsights(portfolioId: string): Promise<Insights> {
      return attempt(() => insights(store, net, portfolioId));
    },

    /** CANNED — needs a historical price feed the fixture does not describe. */
    async getSnapshot(portfolioId: string, date: string): Promise<Snapshot> {
      await mustExist(portfolioId);
      return { date, currency: FIXTURE.currency, rows: [], total: FIXTURE.totalValue };
    },

    /** CANNED — a pure feed proxy on both sides of the seam. */
    async getBenchmark(query: BenchmarkQuery): Promise<Benchmark> {
      return {
        key: query.key,
        label: "S&P 500",
        points: [{ t: query.from, index: 100 }],
        sameFlows: null,
      };
    },

    /** CANNED — as `getBenchmark`. */
    async getHistory(symbol: string, _assetType: "crypto" | "equity", range: RangeKey): Promise<History> {
      if (symbol === FIXTURE.unknownSymbol) {
        // A symbol is not a record this app owns: no prices is a thin answer,
        // never a `NotFoundError`.
        return { bars: [], range, changePct: null, error: "no data" };
      }
      return { bars: [{ t: FIXTURE.benchmarkFrom, c: 40_000 }], range, changePct: 1.2 };
    },

    /* ------------------------------------------------------------- reference */

    /** CANNED — `lookup.symbols` reads Binance's exchange info. */
    async listSymbols(): Promise<string[]> {
      return FIXTURE.symbols;
    },

    /** CANNED — as `listSymbols`. */
    async getAssetInfo(symbol: string, _assetType: "crypto" | "equity"): Promise<AssetInfo> {
      return { symbol, about: null, tags: [], stats: [], sentiment: null, news: [], sources: [] };
    },

    /* -------------------------------------------------------------- settings */

    async getSettings(): Promise<SettingsDto | null> {
      return attempt(async () => {
        // The whole reason `settings.exists()` is on the port: `get()` defaults,
        // so without this a fresh device shows a filled-in form where a browser
        // shows first-run.
        if (!(await settingsService.settingsExist(store))) return null;
        return { id: 1, ...(await settingsService.getSettings(store)) };
      });
    },

    async saveSettings(patch: SettingsPatch): Promise<SettingsDto> {
      return attempt(async () => ({ id: 1, ...(await settingsService.saveSettings(store, patch)) }));
    },

    // `sendTestNotification` is deliberately absent: no server, no Home
    // Assistant, no push subscription. See the rule in `data-client.ts`.

    /* --------------------------------------------------- import and restore */

    /** CANNED report; the existence check and its error are real. */
    async importCsv(portfolioId: string, _csv: string): Promise<ImportReport> {
      await mustExist(portfolioId);
      return FIXTURE.importReport;
    },

    /** CANNED count; `0` for an unknown portfolio, as the interface requires. */
    async clearImported(portfolioId: string): Promise<number> {
      const found = await store.portfolios.get(portfolioId);
      return found ? FIXTURE.clearedCount : 0;
    },

    async restoreBackup(backup: string): Promise<RestoreResult> {
      // The reject path is real: `restore()` parses, and an unreadable backup
      // becomes the interface's `RequestFailedError`.
      return attempt(async () => {
        await restore(store, backup).catch((e: unknown) => translate(e));
        // CANNED — `FIXTURE.restored` pins an id no implementation generates.
        return FIXTURE.restored;
      });
    },
  };
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
    // No previous closes: day change is unknown, which the fixture does not
    // assert and the valuation reports as uncovered rather than as zero.
    "api.binance.com/api/v3/klines": [],
  });
}

/**
 * `sources/*` memoise through a process-wide map, so a price scripted by one
 * test would otherwise satisfy the next one.
 */
beforeEach(() => invalidate());

runDataClientContract("StubClient (services over MemoryStore)", () =>
  StubClient(seededStore(), seededNet()), { testNotifications: false });

/**
 * The contract is deliberately implementation-blind, so the three things this
 * implementation exists to demonstrate are asserted here instead: that the
 * money came out of a real calculation, that the optional capability is
 * genuinely gone rather than stubbed, and that a store-backed client meets the
 * settings rule without a mocked server.
 */
describe("StubClient answers from the services, not from the wire", () => {
  it("values the portfolio by arithmetic over the seeded rows", async () => {
    const out = await StubClient(seededStore(), seededNet()).getValuation(PORTFOLIO_ID);
    // 0.5 x 40 000 + 2 x 2 000. If this ever equals FIXTURE.totalValue by being
    // copied out of the fixture instead of computed, the holdings below will
    // not be there to back it up.
    expect(out.totals.value).toBe(24_000);
    expect(Object.fromEntries(out.holdings.map((h) => [h.symbol, h.value]))).toEqual({
      BTCUSDT: 20_000,
      ETHUSDT: 4_000,
    });
  });

  it("omits the capability it cannot have, rather than throwing from it", () => {
    // The whole argument in one line: a serverless client says "no" by not
    // having the method, which the compiler sees, instead of by failing at the
    // moment a user presses the button.
    expect(StubClient(seededStore(), seededNet()).sendTestNotification).toBeUndefined();
  });

  it("keeps the record semantics the interface promises, with no route involved", async () => {
    const client = StubClient(seededStore(), seededNet());
    await expect(client.getPortfolio(MISSING_PORTFOLIO_ID)).rejects.toBeInstanceOf(NotFoundError);
    await expect(client.deleteTransaction(TRANSACTION_ID)).resolves.toBeUndefined();
    // And it is really gone from the store behind it, not merely reported gone.
    const after = await client.getPortfolio(PORTFOLIO_ID);
    expect(after.transactions.map((t) => t.id)).toEqual(["t-0"]);
  });
});
