import type { AssetInfo } from "@/core/asset-info";
import type { RangeKey } from "@/core/ranges";
import type { ColumnMapping as ImportColumnMapping, FormatId as ImportFormatId } from "@/core/import-formats";
import type { AssetHit } from "../sources/search";
import type { Settings, SettingsPatch, Side } from "../ports/store";
import type { Benchmark, BenchmarkKey, Changes, History, Series } from "../services/series";
import type { ImportReport } from "../services/transfer";
import type { Insights, Snapshot, Valuation } from "../services/valuation";
import type { IndexDetail, MarketBoard, MarketCategory } from "../services/markets";

export type { IndexDetail, MarketBoard, MarketCategory, MarketRow } from "../services/markets";
export type { ColumnMapping as ImportColumnMapping, FormatId as ImportFormatId } from "@/core/import-formats";

/** One alert, as a screen needs to read it. */
export type AlertSummary = {
  id: string;
  kind: string;
  symbol: string | null;
  assetType: string;
  params: Record<string, unknown>;
  enabled: boolean;
};

/**
 * What a screen may create, which is narrower than what the alerts page can.
 *
 * `price_target` only. The indicator alerts are Bitcoin-specific — the risk
 * metric's three curves are fitted to BTC and match TradingView only for it —
 * so offering them per-coin would invite alerts that cannot mean anything. The
 * alerts page keeps its full form; this is the subset an asset page can offer
 * without implying more than the maths supports.
 */
export type NewAlertInput = {
  symbol: string;
  assetType: "crypto" | "equity";
  direction: "above" | "below";
  price: number;
};
export type { AssetHit } from "../sources/search";

/**
 * Everything a screen is allowed to ask for.
 *
 * Thirty-six `fetch("/api/…")` calls across eight files are the reason the
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
 * ## `RequestFailedError.kind` distinguishes refused from unreachable
 *
 * `RequestFailedError` also carries `kind: "unreachable" | "refused"`, because
 * "no one answered" and "someone answered and said no" call for different
 * screens. `"unreachable"` means nothing came back at all — no connection, no
 * DNS, a timeout. `"refused"` means a response arrived and it was a failure —
 * a non-2xx status, a body that could not be parsed as the JSON expected.
 * `HttpClient` sets it at both of the sites in `http-client.ts` that already
 * know which happened; the field defaults to `"refused"` so it costs existing
 * construction sites nothing.
 *
 * Every implementation of this interface must set `kind` correctly, not just
 * satisfy the type — `client-contract.ts` pins both cases, so a `LocalClient`
 * that always throws `"refused"` (or never sets it) fails the suite the same
 * as `HttpClient` would. On a browser hitting a same-origin server the
 * distinction is cosmetic. On a device it is not: `LocalClient`'s local reads
 * — a portfolio, a transaction — talk to on-device storage that either has the
 * record or doesn't, and cannot be merely unreachable; only its price calls,
 * which still cross the network to a feed, can be. Getting `kind` right there
 * is what lets a screen show a plain offline badge over otherwise-correct
 * local figures instead of a retry prompt that promises a fix reconnecting
 * cannot provide.
 *
 * The rule is about records this app owns — a portfolio, a transaction. A
 * *symbol* is not one: `getHistory`, `getAssetInfo`, `listSymbols` and
 * `getBenchmark` answer for something a price feed owns, and "no data for that
 * ticker" comes back as a thin payload (empty `bars`, an `error` field) rather
 * than a `NotFoundError`. The asset page draws an empty chart beside a real
 * position; it must not treat the whole holding as gone.
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
 * ## A capability one platform cannot have is absent, not throwing
 *
 * `sendTestNotification` fires a synthetic signal at Home Assistant and at the
 * browser's push service. Neither exists inside an APK, so `LocalClient` can
 * never do it. Phase 3 first kept the method required and reasoned that an
 * implementation which cannot honour it should throw `RequestFailedError`.
 * Writing the second implementation showed why that is wrong.
 *
 * `client-contract.ts` is the only thing keeping two implementations honest,
 * and it has exactly one way to check a method: call it and look at what comes
 * back. A required method that an implementation is permitted to fail cannot be
 * checked at all — the suite either demands a success, which forces the second
 * implementation to *pretend* it has a capability it does not (the stub in
 * `stub-client.test.ts` would resolve `void` while owning no notifier), or it
 * accepts a throw, at which point the assertion passes for an implementation
 * that is simply broken. The contract stops being a contract for that method.
 *
 * A throw is also discovered at the wrong time and in the wrong place. The type
 * says the screen may call it; only a user tapping the button on a phone finds
 * out otherwise, and what they get is an error banner for a feature that was
 * never coming. An absent method is discovered by the compiler, in the screen,
 * while it is being written.
 *
 * So, the rule for every web-only capability Phase 4 meets — push
 * subscriptions, passkeys, the password change, the alert evaluator, the
 * PineScript tooling:
 *
 * 1. **If no implementation can be portable, it does not belong here at all.**
 *    The settings screen keeps raw `fetch` for `/api/logout`, `/api/push/*`,
 *    `/api/settings/password` and `/api/webauthn/*` for precisely this reason,
 *    and that is the default answer.
 * 2. **If some implementations can and others structurally cannot, the method
 *    is optional (`method?()`), never required-and-throwing.** The screen
 *    feature-detects (`if (client.sendTestNotification)`) and does not draw the
 *    control when it is missing.
 * 3. **The contract suite is told which capabilities the implementation claims**
 *    (`runDataClientContract(name, make, { testNotifications: false })`) and
 *    checks presence against the claim in both directions, so "absent" is an
 *    asserted fact rather than a test quietly skipping.
 *
 * `sendTestNotification` is the only optional member today, and the bar for the
 * second one is high: optionality is a branch in every screen that touches it.
 *
 * ## Export, added in Phase 4
 *
 * It was absent because the three export buttons were `<a href="/api/…">`
 * anchors rather than `fetch` calls, and because `ExportFile` is
 * `{ body, filename }` while the filename travels in a `Content-Disposition`
 * header `Net` exposed on neither side. `HttpClient` would have had to
 * re-derive a name `transfer.ts` already composes — the kind of duplicated
 * rule that drifts and then puts the wrong date on someone's backup.
 *
 * `NetResponse.header()` exists now, added for exactly this, so `HttpClient`
 * reads the name the server sent and `LocalClient` gets it from `transfer.ts`
 * directly. `exportFile` is required rather than optional: both platforms can
 * produce bytes. What differs is what happens to them afterwards, and that is
 * the screen's problem — an anchor on the web, the share sheet on a device.
 *
 * ## Strings, not `File`s
 *
 * `importCsv` and `restoreBackup` take the file's *text*. The two call sites
 * already read `await file.text()` before posting JSON, so this moves nothing;
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
  /**
   * Which currencies this asset's price can be quoted in. Empty for an equity,
   * whose currency is its venue's and is not a choice, and for a coin with no
   * listed pair.
   */
  listQuotes(asset: string): Promise<string[]>;
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
  /**
   * Assets matching a name or ticker, crypto and listed alike.
   *
   * Only what this app can price. A result that cannot be looked up opens a
   * page with a name and no numbers, which is the failure this interface's
   * errors exist to avoid — so a fund, a future or an index is not a hit.
   *
   * Answers `[]` for a query too short to mean anything rather than throwing:
   * an empty search box is not an error.
   */
  searchAssets(query: string): Promise<AssetHit[]>;
  getAssetInfo(symbol: string, assetType: "crypto" | "equity"): Promise<AssetInfo>;

  /* --------------------------------------------------------------- markets */

  /**
   * What moved today and what is largest, for one category.
   *
   * Required, not optional: both platforms can fetch, so this is not a
   * capability one of them lacks. An APK asks CoinGecko and Yahoo over its own
   * `Net` exactly as the browser does.
   *
   * The board names no record this app owns, so it never throws
   * `NotFoundError` — a category that cannot be reached is a
   * `RequestFailedError` like any other transport failure.
   */
  getMarkets(category: MarketCategory): Promise<MarketBoard>;

  /**
   * One index: its own figures, its month, and its major members.
   *
   * Throws `NotFoundError` for a slug this app does not know — the one place
   * in Markets that names a record, so the one place that can be missing.
   */
  getIndex(slug: string): Promise<IndexDetail>;

  /* -------------------------------------------------------------- settings */

  /** `null` on a virgin install — first-run, not a missing record. */
  getSettings(): Promise<SettingsDto | null>;
  saveSettings(patch: SettingsPatch): Promise<SettingsDto>;
  /**
   * Fire a synthetic signal through every configured notifier.
   *
   * **Optional — the one capability in this interface that is.** See "A
   * capability one platform cannot have is absent, not throwing" above for why
   * it is optional rather than required, and for the rule that governs the next
   * such method.
   *
   * `HttpClient` has it: a server can reach Home Assistant and hold web-push
   * subscriptions. A device build has neither, so `LocalClient` omits it, and
   * the settings screen tests for it before drawing the button.
   */
  sendTestNotification?(): Promise<void>;

  /* ---------------------------------------------------------------- alerts */

  /**
   * The alerts this app is watching, and adding one.
   *
   * **Optional, like `sendTestNotification` and for the same reason.** An
   * alert is only worth having if something can dispatch it, and dispatch runs
   * through Home Assistant, web-push and FCM — none of which exists inside an
   * APK. A required method an implementation may fail cannot be checked by the
   * contract at all: the suite either demands success, forcing the second
   * implementation to pretend it has a capability it does not, or accepts a
   * throw, at which point it passes for something simply broken.
   *
   * The bar for a second optional member is high and these clear it: a whole
   * capability the device cannot have, not a convenience.
   *
   * **This does not convert the alerts routes.** They stay server-only, listed
   * as such in `CLAUDE.md`. What it stops is the *asset page* naming one.
   */
  listAlerts?(): Promise<AlertSummary[]>;
  /** @throws RequestFailedError when the alert cannot be stored. */
  createAlert?(alert: NewAlertInput): Promise<AlertSummary>;

  /* --------------------------------------------------- import and restore */

  /** @throws NotFoundError when no portfolio has that id. */
  /**
   * Read a Delta export into a portfolio.
   *
   * `dryRun` writes nothing and returns the report the real call would have
   * produced, `previewed: true` included. The upload flow uses it to show a
   * person what the file does to their ledger before they commit to it.
   */
  importCsv(
    portfolioId: string,
    csv: string,
    opts?: {
      dryRun?: boolean;
      /**
       * Which reader to use. Omitted, the service detects it from the header
       * and falls back to Delta — the behaviour this method has always had.
       * A screen names it when a person has overridden the detection, and
       * `"generic"` needs `mapping` alongside.
       */
      format?: ImportFormatId;
      mapping?: ImportColumnMapping;
    },
  ): Promise<ImportReport>;
  /** Removes every CSV-imported transaction; `0` for an unknown portfolio. */
  clearImported(portfolioId: string): Promise<number>;
  /** Always into a NEW portfolio. @throws RequestFailedError on an unreadable backup. */
  restoreBackup(backup: string): Promise<RestoreResult>;

  /**
   * A portfolio as a file: the bytes and the name to save them under.
   *
   * The client does not save it. Both platforms can produce bytes; only the
   * screen knows whether that becomes a download or a share sheet.
   */
  exportFile(portfolioId: string, format: ExportFormat): Promise<ExportedFile>;
}

export type ExportFormat = "json" | "csv" | "ghostfolio";
export type ExportedFile = { body: string; filename: string };

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
  /** What the price was actually paid in; null when it was already USD. */
  nativeCurrency: string | null;
  nativePrice: number | null;
  /** The security an `income` row is attributed to; null for every other side. */
  sourceSymbol: string | null;
};

/**
 * What the transaction form collects. Narrower than the port's
 * `NewTransaction`, but no longer crypto-only: cash and income are both
 * expressible here.
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
  /**
   * What the price and fee were actually paid in. Absent means the figures are
   * already USD — which is what every manual entry meant before this existed,
   * so absent must keep behaving exactly as it did.
   */
  nativeCurrency?: string | null;
  nativePrice?: number | null;
  nativeFee?: number | null;
  /**
   * What kind of thing this row is about. Defaults to `"crypto"`, which is what
   * every manual entry meant before cash existed, so an omitted field keeps its
   * old behaviour exactly.
   *
   * `"cash"` is money itself: `symbol` is the currency, `quantity` the amount,
   * `price` 0. Every cash consumer — balances, the audit, the value series —
   * already reads that shape, because the importer has written it for fiat
   * deposits all along.
   */
  assetType?: "crypto" | "equity" | "cash";
  /**
   * The security an `income` row is attributed to. Null or absent for
   * everything else, and for income with no source.
   */
  sourceSymbol?: string | null;
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
