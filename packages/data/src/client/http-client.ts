import type { RangeKey } from "@/core/ranges";
import type { AssetInfo } from "@/core/asset-info";
import { NotFoundError, RequestFailedError } from "../errors";
import type { Net } from "../ports/net";
import type { SettingsPatch } from "../ports/store";
import type { Benchmark, Changes, History, Series } from "../services/series";
import type { ImportReport } from "../services/transfer";
import type { Insights, Snapshot, Valuation } from "../services/valuation";
import type { IndexDetail, MarketBoard, MarketCategory } from "../services/markets";
import type {
  BenchmarkQuery,
  DataClient,
  NewTransactionInput,
  PortfolioDetail,
  PortfolioRef,
  PortfolioSummary,
  ExportedFile,
  ExportFormat,
  RestoreResult,
  SettingsDto,
  TransactionDto,
} from "./data-client";

/**
 * The sentence to show a person, out of whatever the route sent back.
 *
 * The routes answer a refused write with `{ error: … }` — sometimes a string,
 * sometimes a flattened Zod report — and the screens have always dug that field
 * out themselves (`d.error ?? res.status`). Doing it here keeps those messages
 * intact once the screens stop parsing responses, and leaves the raw body on
 * `detail` for anything that wants more.
 */
function reasonFrom(body: string): string {
  if (!body) return "The server refused the request.";
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      const error = (parsed as { error: unknown }).error;
      return typeof error === "string" ? error : JSON.stringify(error);
    }
  } catch {
    // Not JSON — a plain-text error body, which the settings screen shows
    // verbatim today.
  }
  return body;
}

/**
 * The `DataClient` that talks to the routes in `apps/web/src/app/api`.
 *
 * Every method issues exactly the request the screen that owned it issued
 * before — same path, same method, same body — because the point of Phase 3 is
 * to move those requests to one place, not to improve them. What is new is the
 * far side: this is the last file that knows about response envelopes and
 * status codes. Callers get a DTO or an error.
 *
 * It takes a `Net` rather than calling `fetch`, which is what lets it be tested
 * against `FakeNet` and, more to the point, lets a device build point it at a
 * server over CapacitorHttp if it ever wants to. `baseUrl` exists for that: the
 * browser sends same-origin relative paths and defaults it to "".
 */
export function HttpClient(net: Net, baseUrl = ""): DataClient {
  /**
   * One request, one of two outcomes.
   *
   * `subject` does two jobs: it names the record in the message, and it is what
   * makes a 404 a `NotFoundError` at all. Only the calls that address a record
   * this app owns pass one — the symbol-shaped calls (`getHistory`,
   * `getAssetInfo`, `listSymbols`, `getBenchmark`) do not, so a 404 from them
   * stays a `RequestFailedError`. Mapping every 404 was broader than the rule
   * the interface documents, and a `LocalClient` had no way to know which of
   * the two an unknown symbol was meant to be.
   *
   * Everything else that is not a 2xx, and every failure to get a response at
   * all, is a `RequestFailedError` carrying whatever the server said.
   */
  async function send<T>(
    method: string,
    path: string,
    opts: { body?: unknown; subject?: string; discardBody?: boolean } = {},
  ): Promise<T> {
    const url = `${baseUrl}${path}`;
    const init: RequestInit =
      opts.body === undefined
        ? { method }
        : {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(opts.body),
          };

    let res;
    try {
      res = await net.request(url, init);
    } catch (e) {
      // No response at all: airplane mode, DNS, a reset connection. The
      // screens need a sentence, not a `TypeError: Failed to fetch`.
      const reason = e instanceof Error ? e.message : String(e);
      throw new RequestFailedError(`Could not reach the server (${reason}).`, reason, "unreachable");
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      if (res.status === 404 && opts.subject) throw new NotFoundError(`No such ${opts.subject}.`);
      throw new RequestFailedError(reasonFrom(detail), detail, "refused");
    }
    // Nothing to read, so nothing to fail on. Both delete routes answer
    // `{ ok: true }` today and their callers discard it; parsing anyway would
    // turn a future 204 into a failure the screen reports as an error.
    if (opts.discardBody) return undefined as T;

    try {
      return await res.json<T>();
    } catch (e) {
      // A 2xx whose body is not the JSON we expected — a proxy's HTML error
      // page, a truncated response. Letting a raw `SyntaxError` out would be
      // the one failure that arrives at a screen untyped.
      const reason = e instanceof Error ? e.message : String(e);
      throw new RequestFailedError("The server sent something unreadable.", reason);
    }
  }

  /** For the routes whose whole answer is `{ ok: true }`; nothing to unwrap. */
  async function sendVoid(method: string, path: string): Promise<void> {
    await send<void>(method, path, { discardBody: true });
  }

  const portfolio = (id: string) => `portfolio (${id})`;

  return {
    /* ------------------------------------------------------------ portfolios */

    async listPortfolios(): Promise<PortfolioSummary[]> {
      const d = await send<{ portfolios: PortfolioSummary[] }>("GET", "/api/portfolios");
      return d.portfolios;
    },

    async getPortfolio(id: string): Promise<PortfolioDetail> {
      const d = await send<{ portfolio: PortfolioDetail }>("GET", `/api/portfolios/${id}`, {
        subject: portfolio(id),
      });
      return d.portfolio;
    },

    async createPortfolio(name: string): Promise<PortfolioRef> {
      const d = await send<{ portfolio: PortfolioRef }>("POST", "/api/portfolios", {
        body: { name },
      });
      return d.portfolio;
    },

    deletePortfolio(id: string): Promise<void> {
      // No `subject`: this route answers 500, not 404, for an id that is gone,
      // so there is no `NotFoundError` to raise. See `data-client.ts`.
      return sendVoid("DELETE", `/api/portfolios/${id}`);
    },

    /* ---------------------------------------------------------- transactions */

    async addTransaction(portfolioId: string, tx: NewTransactionInput): Promise<TransactionDto> {
      const d = await send<{ transaction: TransactionDto }>(
        "POST",
        `/api/portfolios/${portfolioId}/transactions`,
        { body: tx, subject: portfolio(portfolioId) },
      );
      return d.transaction;
    },

    listQuotes(asset: string): Promise<string[]> {
      return send<{ quotes: string[] }>("GET", `/api/quotes/${encodeURIComponent(asset)}`)
        .then((d) => d.quotes);
    },

    deleteTransaction(id: string): Promise<void> {
      return sendVoid("DELETE", `/api/transactions/${id}`);
    },

    /* -------------------------------------------------------------- the money */

    getValuation(portfolioId: string): Promise<Valuation> {
      return send("GET", `/api/portfolios/${portfolioId}/valuation`, {
        subject: portfolio(portfolioId),
      });
    },

    getSeries(portfolioId: string, range: RangeKey): Promise<Series> {
      return send("GET", `/api/portfolios/${portfolioId}/series?range=${range}`, {
        subject: portfolio(portfolioId),
      });
    },

    getChanges(portfolioId: string, range: RangeKey): Promise<Changes> {
      return send("GET", `/api/portfolios/${portfolioId}/changes?range=${range}`, {
        subject: portfolio(portfolioId),
      });
    },

    getInsights(portfolioId: string): Promise<Insights> {
      return send("GET", `/api/portfolios/${portfolioId}/insights`, {
        subject: portfolio(portfolioId),
      });
    },

    getSnapshot(portfolioId: string, date: string): Promise<Snapshot> {
      return send("GET", `/api/portfolios/${portfolioId}/snapshot?date=${date}`, {
        subject: portfolio(portfolioId),
      });
    },

    getBenchmark(query: BenchmarkQuery): Promise<Benchmark> {
      // Built in the order the insights screen builds it, and an absent option
      // is left out rather than sent empty — the route's Zod schema reads a
      // missing parameter as "not asked for" and an empty one as a bad number.
      const q = [`key=${query.key}`, `from=${query.from}`];
      if (query.barMs !== undefined) q.push(`barMs=${query.barMs}`);
      if (query.portfolioId !== undefined) q.push(`portfolioId=${query.portfolioId}`);
      if (query.opening !== undefined) q.push(`opening=${query.opening}`);
      return send("GET", `/api/benchmark?${q.join("&")}`);
    },

    getHistory(symbol: string, assetType: "crypto" | "equity", range: RangeKey): Promise<History> {
      return send(
        "GET",
        `/api/history?symbol=${encodeURIComponent(symbol)}&assetType=${assetType}&range=${range}`,
      );
    },

    /* ------------------------------------------------------------- reference */

    async listSymbols(): Promise<string[]> {
      const d = await send<{ symbols?: string[] }>("GET", "/api/symbols");
      return d.symbols ?? [];
    },

    getAssetInfo(symbol: string, assetType: "crypto" | "equity"): Promise<AssetInfo> {
      return send("GET", `/api/asset/${encodeURIComponent(symbol)}?assetType=${assetType}`);
    },

    /* --------------------------------------------------------------- markets */

    async getMarkets(category: MarketCategory): Promise<MarketBoard> {
      const d = await send<{ board: MarketBoard }>("GET", `/api/markets?category=${category}`);
      return d.board;
    },

    async getIndex(slug: string): Promise<IndexDetail> {
      const d = await send<{ index: IndexDetail }>(
        "GET", `/api/markets/${encodeURIComponent(slug)}`, { subject: `index ${slug}` },
      );
      return d.index;
    },

    /* -------------------------------------------------------------- settings */

    async getSettings(): Promise<SettingsDto | null> {
      const d = await send<{ settings: SettingsDto | null }>("GET", "/api/settings");
      return d.settings;
    },

    async saveSettings(patch: SettingsPatch): Promise<SettingsDto> {
      const d = await send<{ settings: SettingsDto }>("PUT", "/api/settings", { body: patch });
      return d.settings;
    },

    async sendTestNotification(): Promise<void> {
      await send<unknown>("POST", "/api/settings");
    },

    /* --------------------------------------------------- import and restore */

    importCsv(portfolioId: string, csv: string, opts?: { dryRun?: boolean }): Promise<ImportReport> {
      return send("POST", `/api/portfolios/${portfolioId}/import`, {
        body: opts?.dryRun ? { csv, dryRun: true } : { csv },
        subject: portfolio(portfolioId),
      });
    },

    async clearImported(portfolioId: string): Promise<number> {
      const d = await send<{ deleted: number }>(
        "DELETE",
        `/api/portfolios/${portfolioId}/import`,
      );
      return d.deleted;
    },

    restoreBackup(backup: string): Promise<RestoreResult> {
      return send("POST", "/api/portfolios/restore", { body: { backup } });
    },

    /**
     * The export route, whose filename is in `Content-Disposition` — the
     * header `Net` was given a reader for.
     *
     * The fallback matters more than it looks: a missing or malformed header
     * must not produce a file called `undefined`, and this route is the only
     * caller of `header()` in the app.
     */
    async exportFile(portfolioId: string, format: ExportFormat): Promise<ExportedFile> {
      const url = `${baseUrl}/api/portfolios/${encodeURIComponent(portfolioId)}/export?format=${format}`;
      let res;
      try {
        res = await net.request(url);
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        throw new RequestFailedError(`Could not reach the server (${reason}).`, reason, "unreachable");
      }
      if (!res.ok) {
        throw new RequestFailedError(
          "Could not export this portfolio.", `export -> ${res.status}`, "refused",
        );
      }
      const name = /filename="([^"]+)"/.exec(res.header("content-disposition") ?? "")?.[1];
      return {
        body: await res.text(),
        filename: name || `portfolio-${format === "ghostfolio" ? "ghostfolio" : format}.${format === "json" ? "json" : "csv"}`,
      };
    },
  };
}
