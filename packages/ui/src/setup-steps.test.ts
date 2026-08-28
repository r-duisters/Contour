import { describe, expect, it } from "vitest";
import { importKindOf, needsSetup } from "./setup-steps";

const BACKUP = JSON.stringify({ portfolio: { name: "Main", transactions: [] } });
const CSV = "Date,Type,Base amount\n2026-01-01,BUY,1\n";

describe("importKindOf", () => {
  it("reads the content, since a filename is the least reliable thing here", () => {
    // A share sheet can hand over a path with no extension at all.
    expect(importKindOf(BACKUP)).toBe("backup");
    expect(importKindOf(CSV)).toBe("csv");
  });

  it("calls a JSON file without a portfolio in it a CSV, so the importer explains", () => {
    // Better a real parse error about the offending row than "that backup
    // would not load", which is true of every file that is not one.
    expect(importKindOf('{"something":1}')).toBe("csv");
  });

  it("does not mistake broken JSON for a backup", () => {
    expect(importKindOf("{not json")).toBe("csv");
  });
});

describe("needsSetup", () => {
  it("runs on an empty app that has not been through it", () => {
    expect(needsSetup({ portfolioCount: 0, dismissed: false })).toBe(true);
  });

  it("does not run once something is in there", () => {
    // Reinstalling after restoring a backup elsewhere must not reopen it.
    expect(needsSetup({ portfolioCount: 1, dismissed: false })).toBe(false);
  });

  it("does not run again for someone who skipped it", () => {
    expect(needsSetup({ portfolioCount: 0, dismissed: true })).toBe(false);
  });
});
