import { describe, expect, it } from "vitest";
import {
  BACKUP_VERSION, ghostfolioCsv, parseBackup, toCsv, transactionsCsv, type ExportTx,
} from "./export";

const DAY = 86_400_000;

function tx(partial: Partial<ExportTx> & Pick<ExportTx, "symbol" | "side">): ExportTx {
  return {
    assetType: "crypto", quantity: 1, price: 100, fee: 0, time: DAY,
    nativeCurrency: "EUR", nativePrice: 100, note: null, ...partial,
  };
}

describe("toCsv", () => {
  it("quotes fields containing commas, quotes or newlines", () => {
    const out = toCsv(["a", "b"], [["plain", 'has "quotes"'], ["a,b", "line\nbreak"]]);
    expect(out).toBe('a,b\r\nplain,"has ""quotes"""\r\n"a,b","line\nbreak"\r\n');
  });

  it("renders null and undefined as empty fields", () => {
    expect(toCsv(["a", "b"], [[null, undefined]])).toBe("a,b\r\n,\r\n");
  });
});

describe("transactionsCsv", () => {
  it("writes one sorted row per transaction with an ISO date", () => {
    const csv = transactionsCsv(
      [tx({ symbol: "ETHUSDT", side: "sell", time: 2 * DAY }), tx({ symbol: "BTCUSDT", side: "buy" })],
      "EUR",
    );
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toContain("date,symbol,assetType,side,quantity,price,fee,currency");
    expect(lines[1]).toContain("BTCUSDT");   // earlier transaction first
    expect(lines[1]).toContain("1970-01-02T00:00:00.000Z");
    expect(lines[2]).toContain("ETHUSDT");
  });

  it("keeps cash rows, which belong in a full ledger", () => {
    const csv = transactionsCsv([tx({ symbol: "EUR", assetType: "cash", side: "transfer_in" })], "EUR");
    expect(csv).toContain("EUR,cash,transfer_in");
  });
});

describe("ghostfolioCsv", () => {
  it("uses Ghostfolio's columns and date format", () => {
    const csv = ghostfolioCsv([tx({ symbol: "BTCUSDT", side: "buy", quantity: 0.5, price: 42000 })], "EUR");
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("Date,Symbol,Type,Quantity,UnitPrice,Fee,Currency");
    expect(lines[1]).toBe("1970-01-02,BTCUSDT,BUY,0.5,42000,0,EUR");
  });

  it("maps transfers onto BUY and SELL, which is all Ghostfolio understands", () => {
    const csv = ghostfolioCsv(
      [tx({ symbol: "A", side: "transfer_in" }), tx({ symbol: "B", side: "transfer_out" })],
      "EUR",
    );
    expect(csv).toContain(",A,BUY,");
    expect(csv).toContain(",B,SELL,");
  });

  it("leaves cash out: Ghostfolio tracks positions, not balances", () => {
    const csv = ghostfolioCsv([tx({ symbol: "EUR", assetType: "cash", side: "transfer_in" })], "EUR");
    expect(csv.trim().split("\r\n")).toHaveLength(1); // header only
  });
});

describe("parseBackup", () => {
  const valid = {
    version: BACKUP_VERSION,
    exportedAt: "2026-08-21T00:00:00.000Z",
    portfolio: {
      name: "Main",
      transactions: [{
        symbol: "BTCUSDT", assetType: "crypto", side: "buy",
        quantity: 1, price: 100, fee: 0, time: DAY,
      }],
    },
  };

  it("accepts a well-formed backup", () => {
    const out = parseBackup(JSON.stringify(valid));
    expect("backup" in out && out.backup.portfolio.transactions).toHaveLength(1);
  });

  it("rejects malformed JSON with a readable reason", () => {
    expect(parseBackup("{oops")).toEqual({ error: "not valid JSON" });
  });

  it("rejects a different version rather than guessing at it", () => {
    const out = parseBackup(JSON.stringify({ ...valid, version: 99 }));
    expect("error" in out).toBe(true);
  });

  it("names the offending field when a transaction is wrong", () => {
    const bad = structuredClone(valid) as { portfolio: { transactions: { side: string }[] } };
    bad.portfolio.transactions[0]!.side = "lend"; // not a side the app knows
    const out = parseBackup(JSON.stringify(bad));
    expect("error" in out && out.error).toContain("side");
  });
});
