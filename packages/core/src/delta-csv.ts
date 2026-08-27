import type { TxSide } from "./portfolio";
import { STABLES, isFiat } from "./currencies";

export type ParsedTx = {
  symbol: string;
  assetType: "crypto" | "equity" | "cash";
  /** Bare ticker (BTC, ASML.AS) — lets the importer reclassify unsuffixed
   *  tickers that are not tradable coins (e.g. AMD) as equities. */
  base: string;
  /** Delta's exchange/venue for the row: the strongest crypto-vs-equity signal. */
  venue: string;
  side: TxSide;
  quantity: number;
  price: number;
  fee: number;
  time: number; // ms
  /** Set when the row is priced in a non-USD currency (EUR, BTC, ...); the
   *  importer resolves it to USD via the <currency>USDT daily close. */
  pendingQuote?: { currency: string; total: number };
  /** Fee that could not be expressed in USD at parse time. */
  feeRaw?: { currency: string; amount: number };
  /** The security an income row is attributed to; absent for interest. */
  sourceSymbol?: string;
  /** What the trade cost in the currency it was actually settled in. */
  nativeCurrency?: string;
  nativePrice?: number;
  nativeFee?: number;
};

export type SkippedRow = { line: number; reason: string };

export type DeltaImport = {
  rows: ParsedTx[];
  skipped: SkippedRow[];
  /** Imported rows whose USD price could not be derived (recorded with price 0). */
  warnings: SkippedRow[];
};


/** Real money the portfolio can hold as a balance, as opposed to a traded asset. */


/**
 * Delta's vocabulary, mapped to ours. Two of the values are markers rather than
 * sides, resolved below once the row's numbers have been read:
 *
 * - `"transfer"` — direction comes from the sign of the base amount.
 * - `"delivery"` — an asset arriving without a purchase: a staking reward, an
 *   airdrop, a share grant. `transfer_in` has carried a cost-basis price all
 *   along, so these need no side of their own; they only need the price the
 *   export already names, which this importer used to throw away.
 * - `"income"` — cash credited against a security. A dividend does not move a
 *   share count, so it cannot be a delivery of anything.
 *
 * `INCOME` maps to `"delivery"`, not to `"income"`. It is Delta's catch-all for
 * an asset arriving and has always been imported as a transfer; re-pointing it
 * at cash would silently reclassify rows on the owner's next import.
 */
const SIDE_MAP: Record<string, TxSide | "income" | "transfer" | "delivery"> = {
  TRANSFER: "transfer", // direction comes from the sign of the base amount
  BUY: "buy",
  SELL: "sell",
  DEPOSIT: "transfer_in",
  RECEIVE: "transfer_in",
  "TRANSFER IN": "transfer_in",
  TRANSFER_IN: "transfer_in",
  WITHDRAW: "transfer_out",
  WITHDRAWAL: "transfer_out",
  SEND: "transfer_out",
  "TRANSFER OUT": "transfer_out",
  TRANSFER_OUT: "transfer_out",
  INCOME: "delivery",
  STAKING: "delivery",
  REWARD: "delivery",
  AIRDROP: "delivery",
  MINING: "delivery",
  DIVIDEND: "income",
  DIVIDENDS: "income",
  INTEREST: "income",
};

/** RFC-4180-ish CSV: quoted fields, escaped quotes, CRLF/CR/LF line ends. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

/**
 * Delta writes currencies as "ETH (ETHEREUM)" or "DOT* (POLKADOT)"; reduce to
 * the bare ticker. Asterisks are Delta's duplicate-ticker markers.
 */
export function normalizeAsset(raw: string): string {
  return raw.split("(")[0]!.trim().replace(/\*+$/, "").toUpperCase();
}

const CRYPTO_VENUES = [
  "binance", "kraken", "coinbase", "bitvavo", "kucoin", "bitfinex", "bitstamp", "bybit", "okx",
  "huobi", "gate", "crypto.com", "bittrex", "poloniex", "gemini", "wallet", "ledger", "trezor",
  "metamask", "trust", "exodus", "phantom", "electrum", "cold storage", "defi", "uniswap",
  "pancake", "staking", "nexo", "celsius", "blockfi", "bitpanda", "litebit", "anycoin", "deribit",
];
const BROKER_VENUES = [
  // Brokers
  "degiro", "interactive brokers", "ibkr", "trading212", "trading 212", "etoro", "saxo", "flatex",
  "comdirect", "scalable", "revolut", "robinhood", "schwab", "fidelity", "vanguard", "bux",
  "lynx", "meesman", "brand new day", "abn", "ing", "rabobank", "binck", "avanza", "nordnet",
  // Exchanges, which exports often name instead of the broker
  "nasdaq", "nyse", "amex", "euronext", "amsterdam", "brussels", "lisbon", "paris", "dublin",
  "xetra", "frankfurt", "deutsche b", "tradegate", "stuttgart", "london stock", "lse",
  "borsa", "milan", "madrid", "bme", "six swiss", "stockholm", "oslo", "copenhagen", "helsinki",
  "warsaw", "vienna", "toronto", "tsx", "asx", "tokyo", "hong kong",
];

/** "crypto" | "equity" | null when the venue says nothing useful. */
export function venueAssetType(venue: string): "crypto" | "equity" | null {
  const v = venue.trim().toLowerCase();
  if (!v) return null;
  if (CRYPTO_VENUES.some((k) => v.includes(k))) return "crypto";
  if (BROKER_VENUES.some((k) => v.includes(k))) return "equity";
  return null;
}

/** Exchange-suffixed tickers (SHELL.AS, UBI.PA) are equities, not crypto. */
function isSecurityTicker(ticker: string): boolean {
  return /\.[A-Z]{1,4}$/.test(ticker);
}

/** Tolerant numeric parse: strips thousands separators, accepts "0,5" decimals. */
function num(raw: string | undefined): number {
  if (!raw) return NaN;
  let s = raw.trim().replace(/[$€\s]/g, "");
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else if (!s.includes(".") && s.includes(",")) s = s.replace(",", ".");
  return Number(s);
}

function parseDate(raw: string | undefined): number {
  if (!raw) return NaN;
  const s = raw.trim();
  let t = Date.parse(s);
  if (Number.isNaN(t)) t = Date.parse(s.replace(" ", "T"));
  if (Number.isNaN(t)) t = Date.parse(s.replace(" ", "T") + "Z");
  return t;
}

type Cols = Partial<Record<
  "date" | "type" | "baseAmount" | "baseCurrency" | "quoteAmount" | "quoteCurrency" |
  "feeAmount" | "feeCurrency" | "costs" | "costsCurrency" | "venue", number>>;

function mapHeader(header: string[]): Cols {
  const cols: Cols = {};
  header.forEach((raw, i) => {
    const h = raw.trim().toLowerCase();
    if (cols.date === undefined && h.includes("date")) cols.date = i;
    else if (cols.type === undefined && (h === "type" || h === "way" || h.includes("transaction type"))) cols.type = i;
    else if (h.includes("base") && h.includes("amount")) cols.baseAmount = i;
    else if (h.includes("base") && h.includes("currency")) cols.baseCurrency = i;
    else if (h.includes("quote") && h.includes("amount")) cols.quoteAmount = i;
    else if (h.includes("quote") && h.includes("currency")) cols.quoteCurrency = i;
    else if (h.includes("fee") && h.includes("currency")) cols.feeCurrency = i;
    else if (h.includes("fee")) cols.feeAmount = i;
    else if ((h.includes("costs") || h.includes("proceeds")) && h.includes("currency")) cols.costsCurrency = i;
    else if (h.includes("costs") || h.includes("proceeds")) cols.costs = i;
    else if (cols.venue === undefined && (h.includes("exchange") || h.includes("wallet") || h.includes("service"))) cols.venue = i;
  });
  return cols;
}

export function parseDeltaCsv(text: string): DeltaImport {
  const table = parseCsv(text);
  const rows: ParsedTx[] = [];
  const skipped: SkippedRow[] = [];
  const warnings: SkippedRow[] = [];
  if (table.length === 0) return { rows, skipped, warnings };

  const cols = mapHeader(table[0]!);
  for (const key of ["date", "type", "baseAmount", "baseCurrency"] as const) {
    if (cols[key] === undefined) {
      skipped.push({ line: 1, reason: `missing required column: ${key}` });
      return { rows, skipped, warnings };
    }
  }

  for (let r = 1; r < table.length; r++) {
    const line = r + 1;
    const cells = table[r]!;
    const cell = (i: number | undefined) => (i === undefined ? "" : (cells[i] ?? "").trim());

    const rawType = cell(cols.type).toUpperCase();
    const mapped = SIDE_MAP[rawType];
    if (!mapped) { skipped.push({ line, reason: `unsupported type "${cell(cols.type)}"` }); continue; }

    const baseCurrency = normalizeAsset(cell(cols.baseCurrency));
    if (!baseCurrency) { skipped.push({ line, reason: "missing base currency" }); continue; }
    // Fiat rows are the cash side of the portfolio, not an asset position.
    const isCash = isFiat(baseCurrency);
    const assetType: "crypto" | "equity" | "cash" = isCash
      ? "cash"
      : isSecurityTicker(baseCurrency) ? "equity" : "crypto";

    // The date parse moved above the base-amount guard, because the income
    // branch below needs `time` and has to run before that guard.
    const time = parseDate(cell(cols.date));
    if (!Number.isFinite(time)) { skipped.push({ line, reason: `unparseable date "${cell(cols.date)}"` }); continue; }

    const rawAmount = num(cell(cols.baseAmount));
    const quantity = Math.abs(rawAmount);

    if (mapped === "income") {
      // Cash credited against a security. The amount and its currency come from
      // the quote side; the base column names what paid it — except for bank
      // interest, where the base column IS the currency and there is no source.
      //
      // This sits above the base-amount guard, and that ordering is the whole
      // reason dividends were lost rather than merely mislabelled: Delta leaves
      // `Base amount` empty on a dividend row, so the guard rejects it as
      // malformed. Adding the side alone would have changed the skip reason
      // from `unsupported type "DIVIDEND"` to `invalid base amount ""` and
      // dropped every real dividend just the same.
      const incomeQuote = normalizeAsset(cell(cols.quoteCurrency));
      const incomeQuoteAmount = Math.abs(num(cell(cols.quoteAmount)));
      const hasQuote = !!incomeQuote && Number.isFinite(incomeQuoteAmount) && incomeQuoteAmount > 0;
      const currency = hasQuote ? incomeQuote : baseCurrency;
      const amount = hasQuote ? incomeQuoteAmount : quantity;
      if (!isFiat(currency) && !STABLES.has(currency)) {
        skipped.push({ line, reason: `income in ${currency}, which is not money` });
        continue;
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        skipped.push({ line, reason: `invalid income amount "${cell(cols.quoteAmount)}"` });
        continue;
      }
      // Delta's dividend rows carry a withholding. Gross in `quantity`, the
      // withholding in `fee`; `cashBalances` credits the difference, so both
      // figures stay truthful and the ledger shows what was taken.
      const incomeFeeCurrency = normalizeAsset(cell(cols.feeCurrency));
      const incomeFeeAmount = Math.abs(num(cell(cols.feeAmount)));
      const incomeFee =
        incomeFeeCurrency === currency && Number.isFinite(incomeFeeAmount) && incomeFeeAmount > 0
          ? incomeFeeAmount
          : 0;
      rows.push({
        symbol: currency,
        assetType: "cash",
        base: currency,
        venue: cell(cols.venue),
        side: "income",
        quantity: amount,
        price: 0,
        fee: incomeFee,
        time,
        nativeCurrency: currency,
        nativePrice: 1,
        sourceSymbol: currency === baseCurrency ? undefined : baseCurrency,
      });
      continue;
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      skipped.push({ line, reason: `invalid base amount "${cell(cols.baseAmount)}"` });
      continue;
    }

    let side: TxSide;
    if (mapped === "delivery") side = "transfer_in";
    else if (mapped === "transfer") side = rawAmount < 0 ? "transfer_out" : "transfer_in";
    else side = mapped;

    // Prefer quote-side pricing, fall back to costs/proceeds. USD stables
    // resolve immediately; other currencies become a pendingQuote for the
    // importer to convert via historical rates.
    let price = 0;
    let pendingQuote: { currency: string; total: number } | undefined;
    const quoteCurrency = normalizeAsset(cell(cols.quoteCurrency));
    const quoteAmount = Math.abs(num(cell(cols.quoteAmount)));
    const costsCurrency = normalizeAsset(cell(cols.costsCurrency));
    const costsAmount = Math.abs(num(cell(cols.costs)));
    if (STABLES.has(quoteCurrency) && Number.isFinite(quoteAmount) && quoteAmount > 0) {
      price = quoteAmount / quantity;
    } else if (STABLES.has(costsCurrency) && Number.isFinite(costsAmount) && costsAmount > 0) {
      price = costsAmount / quantity;
    } else if (quoteCurrency && Number.isFinite(quoteAmount) && quoteAmount > 0) {
      pendingQuote = { currency: quoteCurrency, total: quoteAmount };
    } else if (costsCurrency && Number.isFinite(costsAmount) && costsAmount > 0) {
      pendingQuote = { currency: costsCurrency, total: costsAmount };
    }

    // A delivery keeps whatever price the export names. `transfer_in` has
    // carried a cost-basis price all along, and zeroing it here was throwing
    // away the only figure that gives a staking reward or a share grant a basis.
    if (price === 0 && !pendingQuote && (side === "buy" || side === "sell")) {
      warnings.push({ line, reason: `no USD price for ${baseCurrency} ${rawType.toLowerCase()} — imported with price 0` });
    }

    let fee = 0;
    let feeRaw: { currency: string; amount: number } | undefined;
    const feeCurrency = normalizeAsset(cell(cols.feeCurrency));
    const feeAmount = Math.abs(num(cell(cols.feeAmount)));
    if (Number.isFinite(feeAmount) && feeAmount > 0) {
      if (STABLES.has(feeCurrency)) fee = feeAmount;
      else if (feeCurrency === baseCurrency && price > 0) fee = feeAmount * price;
      else if (feeCurrency) feeRaw = { currency: feeCurrency, amount: feeAmount };
    }

    if (isCash) {
      // A cash movement is its own currency: one unit is worth one unit.
      rows.push({
        symbol: baseCurrency,
        assetType: "cash",
        base: baseCurrency,
        venue: cell(cols.venue),
        side,
        quantity,
        price: 0,
        fee: 0,
        time,
        nativeCurrency: baseCurrency,
        nativePrice: 1,
      });
      continue;
    }

    // Native = the currency this trade actually settled in (EUR for a Bitvavo
    // buy, USD for a stable-quoted one).
    const nativeCurrency = pendingQuote?.currency
      ?? (STABLES.has(quoteCurrency) ? "USD" : STABLES.has(costsCurrency) ? "USD" : undefined);
    const nativePrice = pendingQuote ? pendingQuote.total / quantity : price || undefined;
    const nativeFee = feeRaw && feeRaw.currency === nativeCurrency ? feeRaw.amount
      : nativeCurrency === "USD" ? fee || undefined : undefined;

    rows.push({
      // The base currency IS the asset. This used to append "USDT" for every
      // crypto row, contradicting the quote currency parsed six lines above
      // and producing 172 rows whose symbol disagreed with their own
      // nativeCurrency.
      symbol: baseCurrency,
      assetType, base: baseCurrency, venue: cell(cols.venue), side, quantity, price, fee, time,
      pendingQuote, feeRaw, nativeCurrency, nativePrice, nativeFee,
    });
  }

  return { rows, skipped, warnings };
}
