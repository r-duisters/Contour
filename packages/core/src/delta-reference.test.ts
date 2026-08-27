import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseDeltaCsv } from "./delta-csv";
import { cashBalances } from "./cash";

/**
 * The parser against a Delta export it did not grow up with.
 *
 * Until this landed, `parseDeltaCsv` had only ever seen its author's file, and
 * this repository held no Delta CSV at all — so questions about the format
 * were unanswerable by reading our own code. `samples/delta/` now holds the
 * documented sample from `dickwolff/Export-To-Ghostfolio`, and this suite
 * pins what our parser makes of it.
 *
 * It is deliberately not a snapshot. A snapshot would record today's answer
 * including today's bugs; these cases each state a property somebody decided.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CSV = readFileSync(join(REPO, "samples/delta/delta-export-reference.csv"), "utf8");
const ETORO = readFileSync(join(REPO, "samples/delta/etoro-statement-reference.csv"), "utf8");

describe("the reference Delta export", () => {
  const { rows, skipped } = parseDeltaCsv(CSV);

  it("reads Delta's own column names", () => {
    // The header says `Way`, not `Type`, and `Base currency (name)` rather
    // than `Base currency`. Both were already handled; this pins them.
    expect(skipped.filter((s) => s.reason.startsWith("missing required column"))).toEqual([]);
  });

  it("strips a currency's long name from its ticker", () => {
    // "SOL (Solana)" is a ticker with a gloss, not a symbol called "SOL (SOLANA)".
    expect(rows.some((r) => r.symbol === "SOL")).toBe(true);
    expect(rows.every((r) => !r.symbol.includes("("))).toBe(true);
  });

  it("reads a fiat deposit as cash worth one unit of itself", () => {
    const deposit = rows.find((r) => r.assetType === "cash")!;
    expect(deposit).toMatchObject({
      symbol: "USD", side: "transfer_in", quantity: 5000, nativeCurrency: "USD", nativePrice: 1,
    });
  });

  it("keeps a non-USD quote as a pending conversion rather than guessing", () => {
    // 10 ETH for 0.6 BTC: there is no USD figure in the row, and inventing one
    // is what `pendingQuote` exists to avoid.
    const eth = rows.find((r) => r.symbol === "ETH")!;
    expect(eth.price).toBe(0);
    expect(eth.pendingQuote).toEqual({ currency: "BTC", total: 0.6 });
  });

  it("takes the direction of a transfer from the sign of the amount", () => {
    expect(rows.find((r) => r.symbol === "DOT")!.side).toBe("transfer_out");
    expect(rows.find((r) => r.symbol === "BTC")!.side).toBe("transfer_in");
  });

  it("imports every row, dropping none — the dividend included", () => {
    // This case is the reason the fixture is here. It used to assert the loss:
    // #16, the dividend skipped as `unsupported type "DIVIDEND"`, 6 of 7 rows.
    // The importer has learned `income`, so it flips, and the two below it
    // come alive.
    expect(skipped).toEqual([]);
    expect(rows).toHaveLength(7);
  });

  it("reads the dividend as cash against the security that paid it", () => {
    // The real row: `,DIVIDEND,,AAPL,STOCK,2.5,USD,...,0.5,USD,...` — an empty
    // base amount, the security in the base column, the money in the quote
    // columns, and a withholding. Every one of those four is a thing the
    // sample taught that the spec had not anticipated.
    const dividend = rows.find((r) => r.side === "income")!;
    expect(dividend).toMatchObject({
      symbol: "USD", assetType: "cash", quantity: 2.5, sourceSymbol: "AAPL",
    });
  });

  it("keeps the withholding visible instead of folding it into the amount", () => {
    // Gross in `quantity`, withheld in `fee`; the balance credits the
    // difference. Asserted on the dividend alone, because the fixture also
    // deposits USD 5,000 and 5002 would say nothing about the withholding.
    const dividend = rows.find((r) => r.side === "income")!;
    expect(dividend.fee).toBe(0.5);
    expect(cashBalances([dividend])).toEqual({ USD: 2 });
    // And it does reach the account balance beside everything else.
    expect(cashBalances(rows).USD).toBe(5002);
  });
});

describe("an eToro account statement, which is not a Delta export", () => {
  // Delta is eToro's app, so the two names travel together and the wrong file
  // is an easy mistake for exactly this app's audience to make. eToro's own
  // statement has no base/quote columns at all — a dividend is
  // `Dividend,NKE/USD,0.17`, with the ticker inside a free-text field.
  const { rows, skipped } = parseDeltaCsv(ETORO);

  it("is refused at the header, importing nothing at all", () => {
    // The property worth having is all-or-nothing. Twenty-eight rows that
    // half-parse into a ledger would be far worse than a rejected file,
    // because the damage is silent and already committed.
    expect(rows).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.line).toBe(1);
    expect(skipped[0]!.reason).toContain("missing required column");
  });
});
