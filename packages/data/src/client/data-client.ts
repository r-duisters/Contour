import type { AssetInfo } from "@/core/asset-info";
import type { RangeKey } from "@/core/ranges";
import type { Settings, SettingsPatch, Side } from "../ports/store";
import type { Benchmark, BenchmarkKey, Changes, History, Series } from "../services/series";
import type { ImportReport } from "../services/transfer";
import type { Insights, Snapshot, Valuation } from "../services/valuation";

/**
 * Everything a screen is allowed to ask for.
 *
 * Thirty-six direct `fetch` calls to `/api/…` across eight files are the
 * reason the
 * mobile build has nowhere to intervene: each one names a route, and inside an
 * APK there is no route to name. `DataClient` is that seam. `HttpClient` calls
 * today's routes over an injected `Net`; Phase 4's `LocalClient` calls the
 * services in `../services` directly, against SQLite on the device. A screen
 * takes one from context and never learns which it got.
 *
 * ## A missing record is a `NotFoundError`
 *
 * Phase 2 left four different answers to "no such record" in place, each
 * faithful to the route it replaced: `getPortfolio` threw `NotFoundError`,
 * `simulateSameFlows` returned `null`, `clearPortfolio` returned `0`, and the
 * write paths let a raw store error become a 500. That was right for routes
 * that had to keep working. It is wrong here: two implementations reading four
 * conventions will disagree, and the disagreement shows up as a screen behaving
 * one way in a browser and another on a phone.
 *
 * So: **a method that names a record throws `NotFoundError` when that record
 * does not exist.** Never `null`, never `undefined`, never a zero that could
 * equally mean "nothing to do". A throw is the only one of those a caller
 * cannot ignore by accident, and it is the convention `packages/data` already
 * has an error class for.
 *
 * Every other failure — the network is gone, the server refused the write, an
 * upstream price feed died — throws `RequestFailedError`, whose `message`
 * carries whatever the implementation could learn about why. No method resolves
 * to `undefined` to signal failure, and no method hands back a status code:
 * that a request was involved at all is `HttpClient`'s private business.
 *
 * Three places knowingly depart from the rule, because today's wire format
 * cannot express it and pretending otherwise would make the two
 * implementations differ rather than agree:
 *
 * - `clearImported` answers `0` for an unknown portfolio. `DELETE
 *   /api/portfolios/:id/import` returns `{ deleted: 0 }` either way and no
 *   `HttpClient` can tell the two apart without an extra request it does not
 *   make today. `LocalClient` must return `0` too — agreeing beats being right.
 * - `deletePortfolio` and `deleteTransaction` throw `RequestFailedError`, not
 *   `NotFoundError`, for an id that is gone: those routes answer 500 (see the
 *   note on `rename` in `store-contract.ts`), which is indistinguishable from a
 *   database that fell over.
 * - `getSettings` resolves to `null` on a virgin install. That is not a lookup
 *   miss — nothing was named — it is first-run, a state the settings screen
 *   renders differently, and `store.settings.exists()` exists precisely so both
 *   implementations can report it.
 *
 * ## Export is deliberately absent
 *
 * The three export buttons are `<a href="/api/…/export?format=…">` anchors, not
 * `fetch` calls, so none of the thirty-six sites is an export — and a method
 * for it could not be honoured anyway. `ExportFile` is `{ body, filename }`,
 * and the filename travels in a `Content-Disposition` header that `Net`
 * (`../ports/net`) does not expose on either side. `HttpClient` would have to
 * re-derive the name that `transfer.ts` already composes, which is the kind of
 * duplicated rule that drifts and then puts the wrong date on a user's backup.
 * Downloading a file on a device is a different mechanism from an anchor in any
 * case; Phase 4 should add the method together with whatever saves the file,
 * and probably alongside a `Net` that can read a response header.
 *
 * ## Strings, not `File`s
 *
 * `importCsv` and `restoreBackup` take the file's *text*. The two call sites
 * already read the file with `.text()` before posting JSON, so this moves
 * nothing;
 * more to the point, `File` is a DOM type and `LocalClient` would only ever
 * unwrap it again to hand a string to `importDelta`/`restore`. Reading the file
 * belongs where the `<input type="file">` is.
 */
export interface DataClient {
  /* ------------------------------------------------------------ portfolios */

  listPortfolios(): Promise<PortfolioSummary[]>;
  /** @throws NotFoundError when no portfolio has that id. */
  getPortfolio(id: string): Promise<PortfolioDetail>;
  createPortfolio(name: string): Promise<PortfolioRef>;
  /** @throws RequestFailedError — see the note above on delete and 500s. */
  deletePortfolio(id: string): Promise<void>;

  /* ---------------------------------------------------------- transactions */

  /** @throws NotFoundError when no portfolio has that id. */
  addTransaction(portfolioId: string, tx: NewTransactionInput): Promise<TransactionDto>;
  /** @throws RequestFailedError — see the note above on delete and 500s. */
  deleteTransaction(id: string): Promise<void>;

  /* -------------------------------------------------------------- the money */

  /** @throws NotFoundError when no portfolio has that id. */
  getValuation(portfolioId: string): Promise<Valuation>;
  /** @throws NotFoundError when no portfolio has that id. */
  getSeries(portfolioId: string, range: RangeKey): Promise<Series>;
  /** @throws NotFoundError when no portfolio has that id. */
  getChanges(portfolioId: string, range: RangeKey): Promise<Changes>;
  /** @throws NotFoundError when no portfolio has that id. */
  getInsights(portfolioId: string): Promise<Insights>;
  /** `date` is `YYYY-MM-DD`. @throws NotFoundError when no portfolio has that id. */
  getSnapshot(portfolioId: string, date: string): Promise<Snapshot>;
  getBenchmark(query: BenchmarkQuery): Promise<Benchmark>;
  getHistory(symbol: string, assetType: "crypto" | "equity", range: RangeKey): Promise<History>;

  /* ------------------------------------------------------------- reference */

  listSymbols(): Promise<string[]>;
  getAssetInfo(symbol: string, assetType: "crypto" | "equity"): Promise<AssetInfo>;

  /* -------------------------------------------------------------- settings */

  /** `null` on a virgin install — first-run, not a missing record. */
  getSettings(): Promise<SettingsDto | null>;
  saveSettings(patch: SettingsPatch): Promise<SettingsDto>;
  /**
   * Fire a synthetic signal through every configured notifier.
   *
   * Server-only in practice: Home Assistant and web-push wiring cannot run
   * inside an APK. It is in the interface because the settings screen is, and
   * an implementation that cannot do it says so with a `RequestFailedError`
   * rather than by omitting the method and breaking the screen.
   */
  sendTestNotification(): Promise<void>;

  /* --------------------------------------------------- import and restore */

  /** @throws NotFoundError when no portfolio has that id. */
  importCsv(portfolioId: string, csv: string): Promise<ImportReport>;
  /** Removes every CSV-imported transaction; `0` for an unknown portfolio. */
  clearImported(portfolioId: string): Promise<number>;
  /** Always into a NEW portfolio. @throws RequestFailedError on an unreadable backup. */
  restoreBackup(backup: string): Promise<RestoreResult>;
}

/* ------------------------------------------------------------------- DTOs */

/** A portfolio as the picker lists it: enough to name it and size it. */
export type PortfolioSummary = {
  id: string;
  name: string;
  /** ISO 8601, as every current caller receives it. */
  createdAt: string;
  transactionCount: number;
};

export type PortfolioRef = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Transactions come back newest-first, which is the order the ledger and the
 * asset page render and the order `GET /api/portfolios/:id` has always used —
 * not the Store contract's oldest-first.
 */
export type PortfolioDetail = {
  id: string;
  name: string;
  createdAt: string;
  transactions: TransactionDto[];
};

export type TransactionDto = {
  id: string;
  portfolioId: string;
  symbol: string;
  side: Side;
  quantity: number;
  price: number;
  fee: number;
  /** ms since epoch. */
  time: number;
  note: string | null;
};

/**
 * What the transaction form collects. Narrower than the port's
 * `NewTransaction`: this route has never accepted an asset type or a native
 * currency, and a manual entry takes the "crypto"/null defaults.
 */
export type NewTransactionInput = {
  symbol: string;
  side: Side;
  quantity: number;
  price: number;
  fee: number;
  /** ms since epoch. */
  time: number;
  note?: string;
};

export type BenchmarkQuery = {
  key: BenchmarkKey;
  /** Window start, ms since epoch — taken from the matching `getSeries` answer. */
  from: number;
  barMs?: number;
  /** When given, the benchmark also simulates this portfolio's cash flows. */
  portfolioId?: string;
  /** Value already held when the window opened, treated as a day-one buy. */
  opening?: number;
};

/** The settings row as the screen reads it. `id` is always 1 — a singleton. */
export type SettingsDto = Settings & { id: number };

export type RestoreResult = { id: string; name: string; restored: number };
