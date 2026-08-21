import { z } from "zod";

/** RFC-4180 field: quote when it contains a comma, quote or newline. */
function csvField(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}

const ISO = (ms: number) => new Date(ms).toISOString();

export type ExportTx = {
  symbol: string;
  assetType: string;
  side: string;
  quantity: number;
  price: number;
  fee: number;
  time: number;
  nativeCurrency: string | null;
  nativePrice: number | null;
  note: string | null;
};

/** One row per transaction, in the portfolio's display currency. */
export function transactionsCsv(txs: ExportTx[], currency: string): string {
  return toCsv(
    ["date", "symbol", "assetType", "side", "quantity", "price", "fee", "currency",
     "nativeCurrency", "nativePrice", "note"],
    [...txs]
      .sort((a, b) => a.time - b.time)
      .map((t) => [
        ISO(t.time), t.symbol, t.assetType, t.side, t.quantity, t.price, t.fee, currency,
        t.nativeCurrency ?? "", t.nativePrice ?? "", t.note ?? "",
      ]),
  );
}

/**
 * Ghostfolio's import columns. Its vocabulary has no notion of a transfer, so
 * those rows are emitted as BUY/SELL at their recorded price — which is what a
 * cost basis needs anyway.
 */
export function ghostfolioCsv(txs: ExportTx[], currency: string): string {
  const type = (side: string) =>
    side === "sell" || side === "transfer_out" ? "SELL" : "BUY";
  return toCsv(
    ["Date", "Symbol", "Type", "Quantity", "UnitPrice", "Fee", "Currency"],
    [...txs]
      .filter((t) => t.assetType !== "cash")
      .sort((a, b) => a.time - b.time)
      .map((t) => [
        ISO(t.time).slice(0, 10), t.symbol, type(t.side), t.quantity, t.price, t.fee, currency,
      ]),
  );
}

export const BACKUP_VERSION = 1;

export const BackupSchema = z.object({
  version: z.literal(BACKUP_VERSION),
  exportedAt: z.string(),
  portfolio: z.object({
    name: z.string().min(1).max(100),
    transactions: z.array(z.object({
      symbol: z.string().min(1),
      assetType: z.string().min(1),
      side: z.enum(["buy", "sell", "transfer_in", "transfer_out"]),
      quantity: z.number(),
      price: z.number(),
      fee: z.number(),
      time: z.number().int(),
      nativeCurrency: z.string().nullable().optional(),
      nativePrice: z.number().nullable().optional(),
      nativeFee: z.number().nullable().optional(),
      note: z.string().nullable().optional(),
    })),
  }),
});

export type Backup = z.infer<typeof BackupSchema>;

/** Parse a backup file, reporting why it was rejected rather than throwing. */
export function parseBackup(raw: string): { backup: Backup } | { error: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { error: "not valid JSON" };
  }
  const parsed = BackupSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { error: first ? `${first.path.join(".")}: ${first.message}` : "unrecognised backup" };
  }
  return { backup: parsed.data };
}
