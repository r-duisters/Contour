import { STABLES } from "./currencies";
import { normalizeAsset, parseCsv, type DeltaImport, type ParsedTx, type SkippedRow } from "./delta-csv";
import type { TxSide } from "./portfolio";

/**
 * Reading an export that did not come from Delta.
 *
 * Every parser here produces the same `ParsedTx` rows `parseDeltaCsv` does, so
 * everything downstream is unchanged: the importer still resolves non-USD
 * prices through historical rates, still reclassifies tickers that are not
 * coins, and still skips rows the portfolio already has. Adding a format is
 * adding a reader, never a second import path.
 *
 * **These were written from published column layouts, not from sample files.**
 * That is a real limitation and the design answers it in three ways. A format
 * is only claimed when its distinctive headers are all present, so a near-miss
 * is refused rather than guessed at. A row whose type is not understood is
 * *skipped with a reason* and never quietly dropped. And the import is offered
 * as a preview first, because the failure that matters here is not a rejected
 * file — it is a file accepted and read wrongly, which shows up months later as
 * a cost basis nobody can explain.
 *
 * When a format is not recognised, the generic mapper takes over: a person
 * names the columns themselves. That is the honest fallback, and it covers
 * every tool including the ones nobody here has heard of.
 */

export type FormatId =
  | "delta" | "binance" | "coinbase" | "kraken" | "trading212" | "degiro" | "generic";

export type ImportFormat = {
  id: FormatId;
  label: string;
  /** What a person would call the file. Shown under the tile. */
  hint: string;
  /** The tile's letter and colour — see `ImportSources` for why not a logo. */
  monogram: string;
  accent: string;
  /** Every one of these must appear in the header for the format to be claimed. */
  signature: string[];
};

export const IMPORT_FORMATS: ImportFormat[] = [
  {
    id: "delta", label: "Delta", hint: "Delta by eToro export",
    monogram: "Δ", accent: "#6366f1",
    // Not "way": Delta has shipped exports headed both "Way" and "Type", and
    // requiring one of them would silently refuse half of them. "Base amount"
    // is distinctive enough on its own — no other format here has it.
    signature: ["date", "base amount"],
  },
  {
    id: "binance", label: "Binance", hint: "Trade history",
    monogram: "B", accent: "#f0b90b",
    signature: ["pair", "side", "executed"],
  },
  {
    id: "coinbase", label: "Coinbase", hint: "Transaction history",
    monogram: "C", accent: "#0052ff",
    signature: ["transaction type", "asset", "quantity transacted"],
  },
  {
    id: "kraken", label: "Kraken", hint: "trades.csv",
    monogram: "K", accent: "#7132f5",
    signature: ["txid", "pair", "vol", "cost"],
  },
  {
    id: "trading212", label: "Trading 212", hint: "Transactions export",
    monogram: "T", accent: "#00a8e8",
    signature: ["action", "ticker", "no. of shares"],
  },
  {
    id: "degiro", label: "DEGIRO", hint: "Transactions.csv",
    monogram: "D", accent: "#003c78",
    signature: ["product", "isin", "quantity"],
  },
];

/** The header row, lower-cased and trimmed, or `[]` if there is not one. */
export function csvHeaders(text: string): string[] {
  const [head] = parseCsv(text);
  return (head ?? []).map((h) => h.trim().toLowerCase().replace(/^﻿/, ""));
}

/**
 * Which format this file is, or null when nothing matches confidently.
 *
 * Every signature column must be present. A format claimed on one shared
 * column would read someone's ledger with the wrong parser, which is the
 * failure this whole module is arranged to avoid.
 */
export function detectFormat(text: string): FormatId | null {
  const headers = csvHeaders(text);
  if (headers.length === 0) return null;
  const has = (name: string) => headers.some((h) => h === name || h.startsWith(name));
  for (const format of IMPORT_FORMATS) {
    if (format.signature.every(has)) return format.id;
  }
  return null;
}

/** Where a value comes from, when a person maps the columns themselves. */
export type ColumnMapping = {
  time: string;
  side: string;
  symbol: string;
  quantity: string;
  price?: string;
  fee?: string;
  currency?: string;
};

export function parseImport(
  text: string,
  format: Exclude<FormatId, "delta">,
  mapping?: ColumnMapping,
): DeltaImport {
  switch (format) {
    case "binance": return parseBinance(text);
    case "coinbase": return parseCoinbase(text);
    case "kraken": return parseKraken(text);
    case "trading212": return parseTrading212(text);
    case "degiro": return parseDegiro(text);
    case "generic":
      if (!mapping) return { rows: [], skipped: [{ line: 0, reason: "no column mapping given" }], warnings: [] };
      return parseGeneric(text, mapping);
  }
}

/* ------------------------------------------------------------------ shared */

type Draft = {
  line: number;
  base: string;
  assetType: "crypto" | "equity";
  side: TxSide;
  quantity: number;
  /** Total paid or received, in `currency`. Zero when the export omits it. */
  total: number;
  currency: string;
  feeAmount: number;
  feeCurrency: string;
  time: number;
  venue: string;
};

/**
 * The one place a row becomes a `ParsedTx`.
 *
 * Both currency decisions live here rather than in six parsers: a USD-stable
 * total prices the row immediately, anything else becomes a `pendingQuote` for
 * the importer to convert at the rate on the trade's own date. That is the
 * rule `delta-csv` established and the reason a EUR investor's cost basis is
 * not re-derived at today's rate.
 */
function toRow(d: Draft, warnings: SkippedRow[]): ParsedTx {
  const priced = d.total > 0 && d.quantity > 0;
  const stable = STABLES.has(d.currency);
  const price = priced && stable ? d.total / d.quantity : 0;
  const pendingQuote = priced && !stable ? { currency: d.currency, total: d.total } : undefined;

  if (!priced && (d.side === "buy" || d.side === "sell")) {
    warnings.push({ line: d.line, reason: `no price for ${d.base} — imported with price 0` });
  }

  let fee = 0;
  let feeRaw: { currency: string; amount: number } | undefined;
  if (d.feeAmount > 0) {
    if (STABLES.has(d.feeCurrency)) fee = d.feeAmount;
    else if (d.feeCurrency === d.base && price > 0) fee = d.feeAmount * price;
    else if (d.feeCurrency) feeRaw = { currency: d.feeCurrency, amount: d.feeAmount };
  }

  const nativeCurrency = pendingQuote?.currency ?? (price > 0 ? "USD" : undefined);
  const nativePrice = pendingQuote ? pendingQuote.total / d.quantity : price || undefined;

  return {
    symbol: d.base, assetType: d.assetType, base: d.base, venue: d.venue,
    side: d.side, quantity: d.quantity, price, fee, time: d.time,
    pendingQuote, feeRaw, nativeCurrency, nativePrice,
    nativeFee: feeRaw && feeRaw.currency === nativeCurrency ? feeRaw.amount
      : nativeCurrency === "USD" ? fee || undefined : undefined,
  };
}

const num = (raw: string): number => {
  const cleaned = raw.replace(/[^0-9.,-]/g, "").replace(/,(?=\d{3}\b)/g, "");
  return Math.abs(Number(cleaned.replace(",", ".")));
};

/** A trailing asset code, as Binance writes quantities: "0.5BTC" → 0.5. */
const amountOf = (raw: string): number => num(raw.replace(/[A-Za-z]+$/, ""));
const unitOf = (raw: string): string => normalizeAsset((/[A-Za-z]+$/.exec(raw.trim())?.[0] ?? ""));

/** `2024-01-02 03:04:05` and ISO both, always read as UTC. */
function utc(date: string, time = ""): number {
  const raw = `${date.trim()} ${time.trim()}`.trim();
  if (!raw) return NaN;
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T");
  const withZone = /[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  return Date.parse(withZone);
}

/** `02-01-2024`, which is how European brokers write the second of January. */
function euroDate(date: string, time = "00:00"): number {
  const m = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(date.trim());
  if (!m) return NaN;
  return Date.parse(`${m[3]}-${m[2]}-${m[1]}T${time.trim() || "00:00"}:00Z`);
}

type Reader = (header: string[], row: string[], line: number) => ParsedTx | SkippedRow | null;

/** Walk the data rows, letting a reader return a row, a skip, or nothing. */
function readAll(text: string, read: Reader): DeltaImport {
  const table = parseCsv(text);
  const header = (table[0] ?? []).map((h) => h.trim().toLowerCase());
  const rows: ParsedTx[] = [];
  const skipped: SkippedRow[] = [];

  for (let i = 1; i < table.length; i++) {
    const cells = table[i]!;
    if (cells.every((c) => c.trim() === "")) continue;
    const out = read(header, cells, i + 1);
    if (out === null) continue;
    if ("reason" in out) skipped.push(out);
    else rows.push(out);
  }
  return { rows, skipped, warnings: [] };
}

/** A column's value by header name, matching on prefix so units in the header
 *  ("Price / share", "Total (EUR)") do not have to be spelled exactly. */
const pick = (header: string[], cells: string[], ...names: string[]): string => {
  for (const name of names) {
    const at = header.findIndex((h) => h === name || h.startsWith(name));
    if (at >= 0) return (cells[at] ?? "").trim();
  }
  return "";
};

/* ----------------------------------------------------------------- Binance */

/**
 * Binance's trade history: `Date(UTC), Pair, Side, Price, Executed, Amount, Fee`.
 *
 * The quantity columns carry their unit inside the value — `0.5BTC`, `20000USDT`
 * — which is also how the pair is split: the quote is whatever `Amount` is
 * denominated in, so `ETHBTC` reads as ETH priced in BTC rather than as a
 * mangled ticker.
 */
function parseBinance(text: string): DeltaImport {
  const warnings: SkippedRow[] = [];
  const out = readAll(text, (h, c, line) => {
    const side = pick(h, c, "side").toLowerCase();
    if (side !== "buy" && side !== "sell") {
      return { line, reason: `unknown side "${pick(h, c, "side")}"` };
    }
    const executed = pick(h, c, "executed");
    const amount = pick(h, c, "amount");
    const quantity = amountOf(executed);
    if (!(quantity > 0)) return { line, reason: `invalid executed amount "${executed}"` };

    const time = utc(pick(h, c, "date(utc)", "date", "utc_time"));
    if (!Number.isFinite(time)) return { line, reason: "unreadable date" };

    const fee = pick(h, c, "fee");
    return toRow({
      line, base: unitOf(executed) || normalizeAsset(pick(h, c, "pair")),
      assetType: "crypto", side, quantity,
      total: amountOf(amount), currency: unitOf(amount) || "USDT",
      feeAmount: amountOf(fee), feeCurrency: unitOf(fee),
      time, venue: "Binance",
    }, warnings);
  });
  return { ...out, warnings };
}

/* ---------------------------------------------------------------- Coinbase */

/**
 * Coinbase's transaction history.
 *
 * `Convert` is deliberately skipped rather than guessed: one row describes two
 * assets moving in opposite directions, and reading it as a single side would
 * invent a position that never existed. It is named in the skip list so a
 * person can add those few by hand.
 */
const COINBASE_SIDES: Record<string, TxSide> = {
  "buy": "buy",
  "advanced trade buy": "buy",
  "sell": "sell",
  "advanced trade sell": "sell",
  "send": "transfer_out",
  "withdrawal": "transfer_out",
  "receive": "transfer_in",
  "deposit": "transfer_in",
  // An asset arriving with a cost basis, which is what transfer_in has always
  // meant. Not `income`: income is cash, and these are coins.
  "rewards income": "transfer_in",
  "staking income": "transfer_in",
  "learning reward": "transfer_in",
  "inflation reward": "transfer_in",
};

function parseCoinbase(text: string): DeltaImport {
  const warnings: SkippedRow[] = [];
  const out = readAll(text, (h, c, line) => {
    const raw = pick(h, c, "transaction type").toLowerCase();
    const side = COINBASE_SIDES[raw];
    if (!side) {
      return { line, reason: raw === "convert"
        ? "a Convert row is two trades in one line — add it by hand"
        : `unknown transaction type "${raw}"` };
    }
    const quantity = num(pick(h, c, "quantity transacted"));
    if (!(quantity > 0)) return { line, reason: "invalid quantity" };
    const time = utc(pick(h, c, "timestamp"));
    if (!Number.isFinite(time)) return { line, reason: "unreadable timestamp" };

    // Subtotal is before fees, which is what a cost basis wants; Total is not.
    const currency = normalizeAsset(pick(h, c, "spot price currency", "price currency")) || "USD";
    const subtotal = num(pick(h, c, "subtotal"));
    const spot = num(pick(h, c, "spot price at transaction"));
    return toRow({
      line, base: normalizeAsset(pick(h, c, "asset")), assetType: "crypto",
      side, quantity,
      total: subtotal > 0 ? subtotal : spot * quantity,
      currency,
      feeAmount: num(pick(h, c, "fees and/or spread", "fees")), feeCurrency: currency,
      time, venue: "Coinbase",
    }, warnings);
  });
  return { ...out, warnings };
}

/* ------------------------------------------------------------------ Kraken */

/**
 * Kraken's trades export.
 *
 * Kraken spells assets in its own alphabet — `XXBTZUSD` is BTC against USD —
 * and a pair it does not recognise is skipped rather than sliced at a guessed
 * offset. Getting this wrong would file a trade under a ticker that does not
 * exist, which is worse than not importing it.
 */
const KRAKEN_QUOTES = ["ZUSD", "ZEUR", "ZGBP", "USDT", "USDC", "XXBT", "XETH", "USD", "EUR", "GBP"];

export function krakenPair(pair: string): { base: string; quote: string } | null {
  const raw = pair.trim().toUpperCase();
  for (const quote of KRAKEN_QUOTES) {
    if (raw.endsWith(quote) && raw.length > quote.length) {
      return { base: krakenAsset(raw.slice(0, -quote.length)), quote: krakenAsset(quote) };
    }
  }
  return null;
}

function krakenAsset(code: string): string {
  // The X and Z prefixes are Kraken's own: X for crypto, Z for fiat, on the
  // four-letter codes only. XBT is bitcoin under its ISO-style name.
  const bare = code.length > 3 && /^[XZ]/.test(code) ? code.slice(1) : code;
  return bare === "XBT" ? "BTC" : normalizeAsset(bare);
}

function parseKraken(text: string): DeltaImport {
  const warnings: SkippedRow[] = [];
  const out = readAll(text, (h, c, line) => {
    const type = pick(h, c, "type").toLowerCase();
    if (type !== "buy" && type !== "sell") return { line, reason: `unknown type "${type}"` };
    const pair = krakenPair(pick(h, c, "pair"));
    if (!pair) return { line, reason: `unrecognised pair "${pick(h, c, "pair")}"` };
    const quantity = num(pick(h, c, "vol"));
    if (!(quantity > 0)) return { line, reason: "invalid volume" };
    const time = utc(pick(h, c, "time"));
    if (!Number.isFinite(time)) return { line, reason: "unreadable time" };

    return toRow({
      line, base: pair.base, assetType: "crypto", side: type, quantity,
      total: num(pick(h, c, "cost")), currency: pair.quote,
      feeAmount: num(pick(h, c, "fee")), feeCurrency: pair.quote,
      time, venue: "Kraken",
    }, warnings);
  });
  return { ...out, warnings };
}

/* ------------------------------------------------------------- Trading 212 */

function parseTrading212(text: string): DeltaImport {
  const warnings: SkippedRow[] = [];
  const out = readAll(text, (h, c, line) => {
    const action = pick(h, c, "action").toLowerCase();
    const ticker = normalizeAsset(pick(h, c, "ticker"));
    const time = utc(pick(h, c, "time"));
    if (!Number.isFinite(time)) return { line, reason: "unreadable time" };

    // A dividend is cash attributed to the security that paid it, and must not
    // touch the position — see the income rule in CLAUDE.md.
    if (action.startsWith("dividend")) {
      const currency = normalizeAsset(pick(h, c, "currency (total)")) || "USD";
      const amount = num(pick(h, c, "total"));
      if (!(amount > 0)) return { line, reason: "dividend with no amount" };
      return {
        symbol: currency, assetType: "cash", base: currency, venue: "Trading 212",
        side: "income", quantity: amount, price: 1, fee: 0, time,
        sourceSymbol: ticker || undefined,
        nativeCurrency: currency, nativePrice: 1,
      } satisfies ParsedTx;
    }

    const side: TxSide | null =
      action.includes("buy") ? "buy" : action.includes("sell") ? "sell" : null;
    if (!side) return { line, reason: `not a trade: "${action}"` };
    const quantity = num(pick(h, c, "no. of shares"));
    if (!(quantity > 0)) return { line, reason: "invalid share count" };

    return toRow({
      line, base: ticker, assetType: "equity", side, quantity,
      total: num(pick(h, c, "total")),
      currency: normalizeAsset(pick(h, c, "currency (total)")) || "USD",
      feeAmount: 0, feeCurrency: "",
      time, venue: "Trading 212",
    }, warnings);
  });
  return { ...out, warnings };
}

/* ---------------------------------------------------------------- DEGIRO */

/**
 * DEGIRO's Transactions.csv, in its English export.
 *
 * The Dutch export uses Dutch headers and is not claimed by `detectFormat` —
 * it falls to the generic mapper, which is the right outcome: guessing that
 * "Aantal" means quantity is exactly the kind of assumption that files a
 * hundred shares as one.
 *
 * There is no ticker column, only a product name and an ISIN. The ISIN is the
 * stable identifier, so it becomes the symbol; a person can rename it, and a
 * wrong-but-consistent symbol is repairable in a way that a wrong quantity is
 * not.
 */
function parseDegiro(text: string): DeltaImport {
  const warnings: SkippedRow[] = [];
  const out = readAll(text, (h, c, line) => {
    const quantityRaw = pick(h, c, "quantity");
    const signed = Number(quantityRaw.replace(/[^0-9.,-]/g, "").replace(",", "."));
    if (!Number.isFinite(signed) || signed === 0) {
      return { line, reason: `invalid quantity "${quantityRaw}"` };
    }
    const time = euroDate(pick(h, c, "date"), pick(h, c, "time"));
    if (!Number.isFinite(time)) return { line, reason: "unreadable date" };

    const isin = pick(h, c, "isin").toUpperCase();
    if (!isin) return { line, reason: "no ISIN" };

    return toRow({
      line, base: isin, assetType: "equity",
      // DEGIRO signs the quantity rather than naming a side.
      side: signed > 0 ? "buy" : "sell",
      quantity: Math.abs(signed),
      total: num(pick(h, c, "local value", "value", "total")),
      currency: normalizeAsset(pick(h, c, "currency")) || "EUR",
      feeAmount: num(pick(h, c, "transaction costs", "transaction and/or third")),
      feeCurrency: normalizeAsset(pick(h, c, "currency")) || "EUR",
      time, venue: "DEGIRO",
    }, warnings);
  });
  return { ...out, warnings };
}

/* ----------------------------------------------------------------- generic */

const GENERIC_SIDES: Record<string, TxSide> = {
  buy: "buy", bought: "buy", purchase: "buy",
  sell: "sell", sold: "sell", sale: "sell",
  "transfer_in": "transfer_in", deposit: "transfer_in", receive: "transfer_in", in: "transfer_in",
  "transfer_out": "transfer_out", withdrawal: "transfer_out", send: "transfer_out", out: "transfer_out",
};

/**
 * Any CSV at all, once a person has named the columns.
 *
 * The fallback that makes the rest of this module safe to be strict: a format
 * that is not recognised is not a dead end, so `detectFormat` can refuse a
 * near-miss instead of guessing.
 */
function parseGeneric(text: string, mapping: ColumnMapping): DeltaImport {
  const warnings: SkippedRow[] = [];
  const at = (header: string[], cells: string[], column: string | undefined): string => {
    if (!column) return "";
    const i = header.indexOf(column.trim().toLowerCase());
    return i >= 0 ? (cells[i] ?? "").trim() : "";
  };

  const out = readAll(text, (h, c, line) => {
    const side = GENERIC_SIDES[at(h, c, mapping.side).toLowerCase()];
    if (!side) return { line, reason: `unknown side "${at(h, c, mapping.side)}"` };
    const quantity = num(at(h, c, mapping.quantity));
    if (!(quantity > 0)) return { line, reason: "invalid quantity" };
    const time = utc(at(h, c, mapping.time));
    if (!Number.isFinite(time)) return { line, reason: `unreadable date "${at(h, c, mapping.time)}"` };
    const symbol = normalizeAsset(at(h, c, mapping.symbol));
    if (!symbol) return { line, reason: "no symbol" };

    const price = num(at(h, c, mapping.price));
    return toRow({
      line, base: symbol, assetType: "crypto", side, quantity,
      // A per-unit price is what most exports carry; the total is derived so
      // one mapping covers both by multiplying back out.
      total: price * quantity,
      currency: normalizeAsset(at(h, c, mapping.currency)) || "USD",
      feeAmount: num(at(h, c, mapping.fee)), feeCurrency: normalizeAsset(at(h, c, mapping.currency)) || "USD",
      time, venue: "Import",
    }, warnings);
  });
  return { ...out, warnings };
}
