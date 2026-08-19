import type { TxSide } from "./portfolio";

export type ParsedTx = {
  symbol: string;
  side: TxSide;
  quantity: number;
  price: number;
  fee: number;
  time: number; // ms
};

export type SkippedRow = { line: number; reason: string };

export type DeltaImport = {
  rows: ParsedTx[];
  skipped: SkippedRow[];
  /** Imported rows whose USD price could not be derived (recorded with price 0). */
  warnings: SkippedRow[];
};

const STABLES = new Set(["USD", "USDT", "USDC", "BUSD", "DAI", "FDUSD", "TUSD"]);

const SIDE_MAP: Record<string, TxSide | "income"> = {
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
  INCOME: "income",
  STAKING: "income",
  REWARD: "income",
  AIRDROP: "income",
  INTEREST: "income",
  MINING: "income",
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
  "feeAmount" | "feeCurrency" | "costs" | "costsCurrency", number>>;

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

    const baseCurrency = cell(cols.baseCurrency).toUpperCase();
    if (!baseCurrency) { skipped.push({ line, reason: "missing base currency" }); continue; }
    if (STABLES.has(baseCurrency)) { skipped.push({ line, reason: `cash row (${baseCurrency})` }); continue; }

    const quantity = Math.abs(num(cell(cols.baseAmount)));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      skipped.push({ line, reason: `invalid base amount "${cell(cols.baseAmount)}"` });
      continue;
    }

    const time = parseDate(cell(cols.date));
    if (!Number.isFinite(time)) { skipped.push({ line, reason: `unparseable date "${cell(cols.date)}"` }); continue; }

    // Prefer quote-side pricing, fall back to costs/proceeds — USD stables only.
    let price = 0;
    const quoteCurrency = cell(cols.quoteCurrency).toUpperCase();
    const quoteAmount = Math.abs(num(cell(cols.quoteAmount)));
    const costsCurrency = cell(cols.costsCurrency).toUpperCase();
    const costsAmount = Math.abs(num(cell(cols.costs)));
    if (STABLES.has(quoteCurrency) && Number.isFinite(quoteAmount) && quoteAmount > 0) {
      price = quoteAmount / quantity;
    } else if (STABLES.has(costsCurrency) && Number.isFinite(costsAmount) && costsAmount > 0) {
      price = costsAmount / quantity;
    }

    const side: TxSide = mapped === "income" ? "transfer_in" : mapped;
    if (mapped === "income") price = 0;
    else if (price === 0 && (side === "buy" || side === "sell")) {
      warnings.push({ line, reason: `no USD price for ${baseCurrency} ${rawType.toLowerCase()} — imported with price 0` });
    }

    let fee = 0;
    const feeCurrency = cell(cols.feeCurrency).toUpperCase();
    const feeAmount = Math.abs(num(cell(cols.feeAmount)));
    if (Number.isFinite(feeAmount) && feeAmount > 0) {
      if (STABLES.has(feeCurrency)) fee = feeAmount;
      else if (feeCurrency === baseCurrency && price > 0) fee = feeAmount * price;
    }

    rows.push({ symbol: `${baseCurrency}USDT`, side, quantity, price, fee, time });
  }

  return { rows, skipped, warnings };
}
