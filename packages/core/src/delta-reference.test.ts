import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseDeltaCsv } from "./delta-csv";

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

  it("drops the dividend, and that is the only row it drops", () => {
    // Known gap, tracked as #16. This case is the reason the fixture is here:
    // when the importer learns `income`, this expectation flips and the two
    // below it come alive. Until then it records the loss honestly rather
    // than leaving a silent 6-of-7.
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.reason).toContain("DIVIDEND");
    expect(rows).toHaveLength(6);
  });
});
