import { parseDeltaCsv, venueAssetType, type ParsedTx, type SkippedRow } from "@/core/delta-csv";
import { toDisplayTxs } from "@/core/display-tx";
import {
  BACKUP_VERSION, ghostfolioCsv, parseBackup, transactionsCsv, type ExportTx,
} from "@/core/export";
import type { Net } from "../ports/net";
import type { NewTransaction, Portfolio, Store } from "../ports/store";
import { fetchKlinesRange, fetchUsdtSymbols } from "../sources/binance";
import { fetchEcbRates } from "../sources/fx";
import { getPortfolio } from "./portfolios";
import { displayContext } from "./pricing";

/**
 * Getting a portfolio in and out of the app: a Delta CSV import, the backup
 * export, and the restore that reads it back.
 *
 * This is the product's front door — someone leaving Delta arrives here — and
 * on a device there is no server to do it, so all of it has to be portable.
 * The only Next-shaped things left in the three routes are Zod validation of
 * the request body and the Content-Disposition headers.
 */

const DAY_MS = 86_400_000;
const utcDay = (t: number) => Math.floor(t / DAY_MS) * DAY_MS;
const FIAT = new Set(["EUR", "GBP", "CHF", "JPY", "AUD", "CAD", "SEK", "NOK", "PLN"]);

/** What the import screen shows: what was written, and what was not, with why. */
export type ImportReport = {
  imported: number;
  duplicates: number;
  /** Rows the parser could not read at all. */
  skipped: SkippedRow[];
  /** Rows that were written but could not be priced. */
  warnings: SkippedRow[];
};

/** A downloadable file: the bytes, and the name the browser should save it as. */
export type ExportFile = { body: string; filename: string };

/** A backup that could not be read, carrying the reason `parseBackup` gave. */
export class InvalidBackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidBackupError";
  }
}

/**
 * Resolve non-USD quotes (EUR, BTC, ...) to USD using the <currency>USDT
 * daily close on each transaction's date. Mutates row.price/row.fee.
 * Returns warnings for rows that stay unpriced.
 */
async function resolvePendingQuotes(net: Net, rows: ParsedTx[]): Promise<SkippedRow[]> {
  const warnings: SkippedRow[] = [];
  const currencies = new Set<string>();
  for (const r of rows) {
    if (r.pendingQuote) currencies.add(r.pendingQuote.currency);
    if (r.feeRaw && r.feeRaw.currency !== r.symbol.replace(/USDT$/, "")) currencies.add(r.feeRaw.currency);
  }

  const rates = new Map<string, Map<number, number>>(); // currency -> day -> close
  for (const c of currencies) {
    const relevant = rows.filter(
      (r) => r.pendingQuote?.currency === c || r.feeRaw?.currency === c,
    );
    const from = Math.min(...relevant.map((r) => r.time)) - 3 * DAY_MS;
    const to = Math.max(...relevant.map((r) => r.time)) + DAY_MS;
    const byDay = new Map<number, number>();
    try {
      const bars = await fetchKlinesRange(net, { symbol: `${c}USDT`, interval: "1d", from, to });
      for (const b of bars) byDay.set(b.t, b.c);
    } catch {
      // no Binance market for this currency
    }
    // Fiat: fill dates Binance cannot cover (EURUSDT only lists from late 2020)
    // with ECB reference rates.
    if (FIAT.has(c)) {
      const earliestNeeded = Math.min(...relevant.map((r) => utcDay(r.time)));
      const earliestBinance = byDay.size > 0 ? Math.min(...byDay.keys()) : Infinity;
      if (earliestNeeded < earliestBinance) {
        try {
          const ecb = await fetchEcbRates(net, c, "USD", earliestNeeded - 5 * DAY_MS,
            Math.min(earliestBinance, to));
          for (const [day, rate] of ecb) if (!byDay.has(day)) byDay.set(day, rate);
        } catch {
          // ECB unavailable; those rows stay unpriced and get warned about
        }
      }
    }
    rates.set(c, byDay);
  }

  const rateFor = (currency: string, time: number): number | null => {
    const byDay = rates.get(currency);
    if (!byDay) return null;
    // fall back up to 3 days for weekend/holiday gaps in fiat pairs
    for (let d = 0; d <= 5; d++) {
      const close = byDay.get(utcDay(time) - d * DAY_MS);
      if (close !== undefined) return close;
    }
    return null;
  };

  for (const [i, r] of rows.entries()) {
    if (r.pendingQuote) {
      const rate = rateFor(r.pendingQuote.currency, r.time);
      if (rate !== null) {
        r.price = (r.pendingQuote.total / r.quantity) * rate;
      } else if (r.side === "buy" || r.side === "sell") {
        warnings.push({
          line: i + 2, // approximate: original line numbers are lost after parse; index is informative enough
          reason: `no ${r.pendingQuote.currency}USDT market to price ${r.symbol} — imported with price 0`,
        });
      }
    }
    if (r.feeRaw && r.fee === 0) {
      const base = r.symbol.replace(/USDT$/, "");
      if (r.feeRaw.currency === base && r.price > 0) {
        r.fee = r.feeRaw.amount * r.price;
      } else {
        const rate = rateFor(r.feeRaw.currency, r.time);
        if (rate !== null) r.fee = r.feeRaw.amount * rate;
      }
    }
  }
  return warnings;
}

/**
 * Delta lists US stocks without an exchange suffix (AMD), which look like coin
 * tickers. "Not on Binance" alone is NOT enough to call something a stock —
 * delisted coins (SUB, MATIC, XMR) would then match unrelated equity tickers
 * and inject phantom value. The venue decides; ambiguity stays crypto, where
 * an unknown asset simply shows as unpriced.
 */
async function reclassifyNonCoins(net: Net, rows: ParsedTx[]): Promise<void> {
  const candidates = rows.filter((r) => r.assetType === "crypto"); // cash and equities are already settled
  if (candidates.length === 0) return;
  let coins = new Set<string>();
  try {
    coins = new Set(await fetchUsdtSymbols(net));
  } catch {
    // Binance unreachable: fall back to venue signal alone
  }
  for (const r of candidates) {
    const venue = venueAssetType(r.venue);
    if (venue === "crypto") continue;                   // wallet/exchange row: always a coin
    if (coins.has(`${r.base}USDT`)) continue;           // tradable coin
    if (venue !== "equity") continue;                   // unknown venue: keep crypto, stay unpriced
    r.assetType = "equity";
    r.symbol = r.base;
  }
}

/** Read a Delta export into a portfolio, skipping rows it already holds. */
export async function importDelta(
  store: Store, net: Net, id: string, csv: string,
): Promise<ImportReport> {
  const portfolio = await getPortfolio(store, id);

  const { rows, skipped, warnings } = parseDeltaCsv(csv);
  await reclassifyNonCoins(net, rows);
  const fxWarnings = await resolvePendingQuotes(net, rows);

  // Idempotency: skip rows that already exist in this portfolio. The route read
  // the same four columns back out of the database; `getPortfolio` above has
  // already fetched them, so this costs no extra query.
  const seen = new Set(
    portfolio.transactions.map((t) => `${t.symbol}|${t.side}|${t.quantity}|${t.time}`),
  );
  const fresh = rows.filter((r) => !seen.has(`${r.symbol}|${r.side}|${r.quantity}|${r.time}`));

  if (fresh.length > 0) {
    await store.transactions.addMany(id, fresh.map((r): NewTransaction => ({
      symbol: r.symbol,
      assetType: r.assetType,
      side: r.side,
      quantity: r.quantity,
      price: r.price,
      fee: r.fee,
      nativeCurrency: r.nativeCurrency ?? null,
      nativePrice: r.nativePrice ?? null,
      nativeFee: r.nativeFee ?? null,
      time: r.time,
      note: "delta-import",
    })));
  }
  return {
    imported: fresh.length,
    duplicates: rows.length - fresh.length,
    skipped,
    warnings: [...warnings, ...fxWarnings],
  };
}

/**
 * Remove everything a Delta import added to this portfolio, and nothing else.
 * Both halves of the route's `where` are kept: the `portfolioId` scope, so a
 * clear can never reach another portfolio, and the `note` filter, so a
 * hand-entered transaction survives it.
 *
 * The route issued one `deleteMany`; the port has no delete-by-predicate (it
 * would not survive the move to device SQLite as a single call), so this reads
 * the rows and removes them by id. Unknown id answers 0 rather than throwing,
 * as `deleteMany` on a missing portfolio always did.
 */
export async function clearPortfolio(store: Store, id: string): Promise<number> {
  const portfolio = await store.portfolios.get(id);
  if (!portfolio) return 0;
  const imported = portfolio.transactions.filter((t) => t.note === "delta-import");
  for (const t of imported) await store.transactions.remove(t.id);
  return imported.length;
}

const stamp = () => new Date().toISOString().slice(0, 10);

/** `My Portfolio` -> `my-portfolio`, for a filename. */
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "portfolio";
}

/**
 * The whole portfolio as a restorable backup.
 *
 * Raw stored values: a backup must restore exactly what was captured,
 * independent of today's exchange rate or display currency.
 */
export async function exportJson(store: Store, id: string): Promise<ExportFile> {
  const portfolio = await getPortfolio(store, id);
  const body = JSON.stringify({
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    portfolio: {
      name: portfolio.name,
      transactions: portfolio.transactions.map((t) => ({
        symbol: t.symbol,
        assetType: t.assetType,
        side: t.side,
        quantity: t.quantity,
        price: t.price,
        fee: t.fee,
        time: t.time,
        nativeCurrency: t.nativeCurrency,
        nativePrice: t.nativePrice,
        nativeFee: t.nativeFee,
        note: t.note,
      })),
    },
  }, null, 2);
  return { body, filename: `${slugify(portfolio.name)}-backup-${stamp()}.json` };
}

/**
 * The portfolio as a spreadsheet, in the display currency: `ghostfolio` for
 * that app's import columns, `csv` for every field the app stores.
 */
export async function exportCsv(
  store: Store, net: Net, id: string, format: "csv" | "ghostfolio",
): Promise<ExportFile> {
  const portfolio = await getPortfolio(store, id);
  const { currency, toDisplay, displayUsd } = await displayContext(store, net);

  const display = toDisplayTxs(portfolio.transactions, currency, toDisplay);
  const rows: ExportTx[] = portfolio.transactions.map((t, i) => ({
    symbol: t.symbol,
    assetType: t.assetType,
    side: t.side,
    quantity: t.quantity,
    price: display[i]!.price,
    fee: display[i]!.fee,
    time: t.time,
    nativeCurrency: t.nativeCurrency,
    nativePrice: t.nativePrice,
    note: t.note,
  }));

  // A failed EUR lookup leaves the figures in dollars, so they must not be
  // labelled euros — the same relabel the route did.
  const label = displayUsd > 0 ? currency : "USD";
  const body = format === "ghostfolio" ? ghostfolioCsv(rows, label) : transactionsCsv(rows, label);
  return { body, filename: `${slugify(portfolio.name)}-${format === "ghostfolio" ? "ghostfolio" : "transactions"}-${stamp()}.csv` };
}

/**
 * Restore a backup into a NEW portfolio. Never overwrites an existing one:
 * a restore that silently replaced live data would be unrecoverable.
 */
export async function restore(
  store: Store, json: string,
): Promise<{ portfolio: Portfolio; restored: number }> {
  const parsed = parseBackup(json);
  if ("error" in parsed) throw new InvalidBackupError(parsed.error);
  const backup = parsed.backup.portfolio;

  const taken = (await store.portfolios.list()).some((p) => p.name === backup.name);
  const name = taken ? `${backup.name} (restored ${stamp()})` : backup.name;

  const created = await store.portfolios.create(name);
  if (backup.transactions.length > 0) {
    await store.transactions.addMany(created.id, backup.transactions.map((t): NewTransaction => ({
      symbol: t.symbol,
      // The backup schema types this as a free string; the column has always
      // been one of the three, and an older file cannot widen it.
      assetType: t.assetType as NewTransaction["assetType"],
      side: t.side,
      quantity: t.quantity,
      price: t.price,
      fee: t.fee,
      time: t.time,
      nativeCurrency: t.nativeCurrency ?? null,
      nativePrice: t.nativePrice ?? null,
      nativeFee: t.nativeFee ?? null,
      note: t.note ?? null,
    })));
  }
  return { portfolio: created, restored: backup.transactions.length };
}
