import type { ColumnMapping as ImportColumnMapping, FormatId as ImportFormatId } from "@/lib/import-formats";
import type { AssetHit } from "@/data/sources/search";
import type { AlertSummary, NewAlertInput } from "@/data/client/data-client";
import type { Alert } from "@/data/ports/store";
import type { AssetInfo } from "@/core/asset-info";
import type { RangeKey } from "@/core/ranges";
import { NotFoundError, RequestFailedError } from "@/data/errors";
import type { Net } from "@/data/ports/net";
import type { SettingsPatch, Store, Transaction } from "@/data/ports/store";
import { fetchQuotesFor } from "@/data/sources/binance";
import * as portfolios from "@/data/services/portfolios";
import * as settingsService from "@/data/services/settings";
import * as transactions from "@/data/services/transactions";
import { assetInfo, searchAssets, symbols } from "@/data/services/lookup";
import { benchmark, changes, history, series } from "@/data/services/series";
import type { Benchmark, Changes, History, Series } from "@/data/services/series";
import { clearPortfolio, exportCsv, exportJson, importDelta, restore } from "@/data/services/transfer";
import type { ImportReport } from "@/data/services/transfer";
import { insights, snapshot, valuation } from "@/data/services/valuation";
import type { Insights, Snapshot, Valuation } from "@/data/services/valuation";
import { getIndexDetail, getMarkets } from "@/data/services/markets";
import type { IndexDetail, MarketBoard, MarketCategory } from "@/data/services/markets";
import type {
  BenchmarkQuery,
  DataClient,
  ExportedFile,
  ExportFormat,
  NewTransactionInput,
  PortfolioDetail,
  PortfolioRef,
  PortfolioSummary,
  RestoreResult,
  SettingsDto,
  TransactionDto,
} from "@/data/client/data-client";

/**
 * The device's `DataClient`: the services, over a `Store` and a `Net`, with no
 * server anywhere.
 *
 * It replaces `stub-client.test.ts`, which existed to answer one question —
 * whether `DataClient` had quietly been drawn around HTTP — and answered it
 * no. What that exercise found is carried into `local-client.test.ts`, because
 * the findings outlive the stub.
 *
 * This is the thinnest of the three layers. `HttpClient` has to know response
 * envelopes and status codes; this knows neither, because the services already
 * throw `NotFoundError` for a record this app owns and the interface has
 * already decided what everything else becomes.
 *
 * Where the stub canned an answer, this computes one: the five reads it could
 * not produce — series, changes, snapshot, benchmark, history — are real
 * services here, as are the symbol list, the asset background, the importer
 * and restore. A stub in a test file could afford to pretend; the app cannot.
 */

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
    nativeCurrency: t.nativeCurrency,
    nativePrice: t.nativePrice,
    sourceSymbol: t.sourceSymbol,
  };
}

const ISO = (t: number) => new Date(t).toISOString();

/**
 * Anything a service threw that is not a missing record becomes the
 * interface's one other error.
 *
 * `kind` is `"refused"` by default because that is what a device failure
 * usually is: storage answered and said no. A `NetError` carrying its own
 * `kind` keeps it — that is the whole reason `Net` distinguishes the two.
 */
function translate(e: unknown): never {
  if (e instanceof NotFoundError) throw e;
  if (e instanceof RequestFailedError) throw e;
  const reason = e instanceof Error ? e.message : String(e);
  const kind = (e as { kind?: string }).kind === "unreachable" ? "unreachable" : "refused";
  throw new RequestFailedError(reason, reason, kind as "unreachable" | "refused");
}

async function attempt<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    translate(e);
  }
}

/** The port's row as a screen reads it. */
function toSummary(a: Alert): AlertSummary {
  return {
    id: a.id,
    kind: a.kind,
    symbol: a.symbol,
    portfolioId: a.portfolioId,
    repeat: a.repeat,
    assetType: a.assetType,
    params: a.kind === "price_target"
      ? { direction: a.direction, price: a.threshold }
      : { threshold: a.threshold },
    enabled: a.enabled,
  };
}

export function LocalClient(store: Store, net: Net): DataClient {
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
          // The Store hands these back oldest-first; the interface promises the
          // reverse, and that reordering is the client's job on either side of
          // the seam.
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
      // route answers 500 there, and the two implementations have to be wrong
      // in the same way. Agreeing beats being right.
      await attempt(() => portfolios.deletePortfolio(store, id));
    },

    /* ---------------------------------------------------------- transactions */

    async addTransaction(portfolioId: string, tx: NewTransactionInput): Promise<TransactionDto> {
      return attempt(async () => {
        const row = await transactions.addTransaction(store, net, portfolioId, {
          ...tx,
          assetType: tx.assetType ?? "crypto",
          nativeCurrency: tx.nativeCurrency ?? null,
          nativePrice: tx.nativePrice ?? null,
          nativeFee: tx.nativeFee ?? null,
          sourceSymbol: tx.sourceSymbol ?? null,
          note: tx.note ?? null,
        });
        return toDto(row);
      });
    },

    listQuotes(asset: string): Promise<string[]> {
      return attempt(() => fetchQuotesFor(net, asset));
    },

    async deleteTransaction(id: string): Promise<void> {
      await attempt(() => transactions.deleteTransaction(store, id));
    },

    /* -------------------------------------------------------------- the money */

    getValuation(portfolioId: string): Promise<Valuation> {
      return attempt(() => valuation(store, net, portfolioId));
    },

    getSeries(portfolioId: string, range: RangeKey): Promise<Series> {
      return attempt(() => series(store, net, portfolioId, range));
    },

    getChanges(portfolioId: string, range: RangeKey): Promise<Changes> {
      return attempt(() => changes(store, net, portfolioId, range));
    },

    getInsights(portfolioId: string): Promise<Insights> {
      return attempt(() => insights(store, net, portfolioId));
    },

    getSnapshot(portfolioId: string, date: string): Promise<Snapshot> {
      return attempt(() => snapshot(store, net, portfolioId, date));
    },

    getBenchmark(query: BenchmarkQuery): Promise<Benchmark> {
      return attempt(() => benchmark(store, net, query));
    },

    getHistory(symbol: string, assetType: "crypto" | "equity", range: RangeKey): Promise<History> {
      // A symbol is not a record this app owns: no prices is a thin answer
      // carrying `error`, never a `NotFoundError`. The service already does
      // that, which is why there is no special case here.
      return attempt(() => history(store, net, symbol, assetType, range));
    },

    /* ------------------------------------------------------------- reference */

    listSymbols(): Promise<string[]> {
      return attempt(() => symbols(net));
    },

    /*
     * Alerts, on a build with no server.
     *
     * They were absent because dispatch needed Home Assistant, web-push or
     * FCM. None of that is true of a *price target checked on this phone*:
     * `alert-rules.ts` has been pure since it was written, evaluation needs
     * one live price, and `LocalNotifications` posts the result without asking
     * anyone. What stays out of reach is the indicator kind, which wants 1,460
     * daily bars of warm-up — see the port.
     */
    async listAlerts(): Promise<AlertSummary[]> {
      return attempt(async () => (await store.alerts.list()).map(toSummary));
    },

    async createAlert(alert: NewAlertInput): Promise<AlertSummary> {
      return attempt(async () => toSummary(await store.alerts.create(
        alert.kind === "pct_move"
          ? {
              kind: "pct_move",
              // A portfolio, not a symbol. `expandRules` resolves it against
              // whatever is held at the moment of the check, so a coin bought
              // next week is covered by a rule written today.
              portfolioId: alert.portfolioId,
              assetType: "crypto",
              threshold: alert.threshold,
              direction: null,
              // A move rule has always been standing; that is what it means.
              repeat: alert.repeat ?? true,
            }
          : {
              kind: "price_target",
              symbol: alert.symbol,
              assetType: alert.assetType,
              threshold: alert.price,
              direction: alert.direction,
              repeat: alert.repeat ?? false,
            },
      )));
    },

    async setAlertEnabled(id: string, enabled: boolean): Promise<AlertSummary> {
      return attempt(async () => toSummary(await store.alerts.setEnabled(id, enabled)));
    },

    async deleteAlert(id: string): Promise<void> {
      return attempt(() => store.alerts.remove(id));
    },

    searchAssets(query: string): Promise<AssetHit[]> {
      return attempt(() => searchAssets(net, query));
    },

    getAssetInfo(symbol: string, assetType: "crypto" | "equity"): Promise<AssetInfo> {
      // Passed through, not ignored. It used to be dropped and every asset read
      // as a coin, so a share was given crypto headlines and the crypto Fear &
      // Greed index — the wrong answer rather than a thin one.
      //
      // What a device cannot reach for an equity is `quoteSummary`: the profile
      // text and the ratios need Yahoo's cookie-and-crumb handshake and a
      // response header `Net` does not expose (spec §4.2). Everything in the
      // chart's `meta` block needs neither, and that is what it answers with.
      return attempt(() => assetInfo(net, symbol, assetType));
    },

    /* --------------------------------------------------------------- markets */

    getMarkets(category: MarketCategory): Promise<MarketBoard> {
      return attempt(() => getMarkets(net, category));
    },

    getIndex(slug: string): Promise<IndexDetail> {
      return attempt(async () => {
        const found = await getIndexDetail(net, slug);
        if (!found) throw new NotFoundError(`index ${slug}`);
        return found;
      });
    },

    /* -------------------------------------------------------------- settings */

    async getSettings(): Promise<SettingsDto | null> {
      return attempt(async () => {
        // The whole reason `settings.exists()` is on the port: `get()`
        // defaults, so without this a fresh device shows a filled-in form
        // where a browser shows first-run.
        if (!(await settingsService.settingsExist(store))) return null;
        return { id: 1, ...(await settingsService.getSettings(store)) };
      });
    },

    async saveSettings(patch: SettingsPatch): Promise<SettingsDto> {
      return attempt(async () => ({ id: 1, ...(await settingsService.saveSettings(store, patch)) }));
    },

    // `sendTestNotification` is deliberately absent — not a stub that resolves.
    // No server, no Home Assistant, no push subscription. The settings screen
    // feature-detects it and does not draw the button. See `data-client.ts`.

    /* --------------------------------------------------- import and restore */

    importCsv(
      portfolioId: string,
      csv: string,
      opts?: {
      dryRun?: boolean;
      format?: ImportFormatId;
      mapping?: ImportColumnMapping;
    },
    ): Promise<ImportReport> {
      return attempt(() => importDelta(store, net, portfolioId, csv, opts));
    },

    async clearImported(portfolioId: string): Promise<number> {
      // `0` for an unknown portfolio, matching `HttpClient`. The interface has
      // decided that clearing nothing from nowhere is not an error.
      const found = await store.portfolios.get(portfolioId).catch(() => null);
      if (!found) return 0;
      return attempt(() => clearPortfolio(store, portfolioId));
    },

    async restoreBackup(backup: string): Promise<RestoreResult> {
      return attempt(async () => {
        const { portfolio, restored } = await restore(store, backup);
        // `name` is part of the result: `restore` renames a portfolio whose
        // name is already taken, so the caller cannot assume it got the one in
        // the file. Omitting it typechecked only because apps/mobile was not
        // being typechecked at all.
        return { id: portfolio.id, name: portfolio.name, restored };
      });
    },

    /**
     * No header to read: `transfer.ts` composes the filename, and this client
     * is on the same side of the seam as the thing that composes it. Which is
     * why `HttpClient` had to be given a header reader and this did not.
     */
    exportFile(portfolioId: string, format: ExportFormat): Promise<ExportedFile> {
      return attempt(() =>
        format === "json"
          ? exportJson(store, portfolioId)
          : exportCsv(store, net, portfolioId, format === "ghostfolio" ? "ghostfolio" : "csv"),
      );
    },
  };
}
