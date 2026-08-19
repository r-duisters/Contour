import { describe, expect, it } from "vitest";
import { parseCsv, parseDeltaCsv } from "./delta-csv";

const HEADER = "Date,Type,Exchange,Base amount,Base currency,Quote amount,Quote currency,Fee,Fee currency,Costs/Proceeds,Costs/Proceeds currency,Notes";

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join("\n");
}

describe("parseCsv", () => {
  it("handles quoted fields with commas and escaped quotes", () => {
    const rows = parseCsv('a,"b,c","d""e"\n1,2,3');
    expect(rows).toEqual([["a", "b,c", 'd"e'], ["1", "2", "3"]]);
  });

  it("handles CRLF and skips blank lines", () => {
    expect(parseCsv("a,b\r\n\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("parseDeltaCsv", () => {
  it("maps a buy with USD quote to price per unit and fee", () => {
    const { rows, skipped, warnings } = parseDeltaCsv(
      csv("2024-01-15 10:30:00,BUY,Binance,0.5,BTC,21000,USDT,10,USDT,,,"),
    );
    expect(skipped).toEqual([]);
    expect(warnings).toEqual([]);
    expect(rows).toEqual([{
      symbol: "BTCUSDT", side: "buy", quantity: 0.5, price: 42000, fee: 10,
      time: Date.parse("2024-01-15T10:30:00"),
    }]);
  });

  it("uses costs/proceeds when the quote is not a USD stable", () => {
    const { rows, warnings } = parseDeltaCsv(
      csv("2024-01-15,SELL,Binance,10,ETH,0.5,BTC,,,22000,USD,"),
    );
    expect(rows[0]!.price).toBe(2200);
    expect(rows[0]!.side).toBe("sell");
    expect(warnings).toEqual([]);
  });

  it("imports negative amounts as positive quantities", () => {
    const { rows } = parseDeltaCsv(csv("2024-01-15,SELL,Binance,-2,SOL,200,USDT,,,,,"));
    expect(rows[0]!.quantity).toBe(2);
    expect(rows[0]!.price).toBe(100);
  });

  it("maps deposits/withdrawals to transfers and income to zero-cost transfer_in", () => {
    const { rows } = parseDeltaCsv(
      csv(
        "2024-01-01,DEPOSIT,Wallet,1,BTC,,,,,,,",
        "2024-01-02,WITHDRAW,Wallet,0.5,BTC,,,,,,,",
        "2024-01-03,STAKING,Wallet,0.1,ETH,300,USDT,,,,,",
      ),
    );
    expect(rows.map((r) => r.side)).toEqual(["transfer_in", "transfer_out", "transfer_in"]);
    expect(rows[2]!.price).toBe(0); // income is always zero-cost
  });

  it("emits a pendingQuote for non-USD quotes instead of warning", () => {
    const { rows, warnings } = parseDeltaCsv(csv("2024-01-15,BUY,Binance,10,ETH,0.5,BTC,,,,,"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.price).toBe(0);
    expect(rows[0]!.pendingQuote).toEqual({ currency: "BTC", total: 0.5 });
    expect(warnings).toEqual([]); // the importer resolves or warns, not the parser
  });

  it("emits a pendingQuote for EUR-priced rows", () => {
    const { rows } = parseDeltaCsv(csv("2024-01-15,BUY,Bitvavo,2,ETH,4000,EUR,,,,,"));
    expect(rows[0]!.pendingQuote).toEqual({ currency: "EUR", total: 4000 });
  });

  it("warns only when a buy/sell has no quote information at all", () => {
    const { rows, warnings } = parseDeltaCsv(csv("2024-01-15,BUY,Binance,10,ETH,,,,,,,"));
    expect(rows).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.reason).toContain("no USD price");
  });

  it("maps bare TRANSFER by the sign of the base amount", () => {
    const { rows, skipped } = parseDeltaCsv(
      csv(
        "2024-01-01,TRANSFER,Wallet,1.5,BTC,,,,,,,",
        "2024-01-02,TRANSFER,Wallet,-0.5,BTC,,,,,,,",
      ),
    );
    expect(skipped).toEqual([]);
    expect(rows.map((r) => r.side)).toEqual(["transfer_in", "transfer_out"]);
  });

  it("passes unresolvable fees through as feeRaw", () => {
    const { rows } = parseDeltaCsv(csv("2024-01-15,BUY,Bitvavo,2,ETH,4000,EUR,4,EUR,,,"));
    expect(rows[0]!.fee).toBe(0);
    expect(rows[0]!.feeRaw).toEqual({ currency: "EUR", amount: 4 });
  });

  it("converts base-currency fees using the derived price", () => {
    const { rows } = parseDeltaCsv(csv("2024-01-15,BUY,Binance,2,ETH,4000,USDT,0.01,ETH,,,"));
    expect(rows[0]!.fee).toBeCloseTo(0.01 * 2000);
  });

  it("skips cash rows, unsupported types, bad amounts, and bad dates with reasons", () => {
    const { rows, skipped } = parseDeltaCsv(
      csv(
        "2024-01-01,DEPOSIT,Bank,1000,USD,,,,,,,",
        "2024-01-02,LOAN,X,1,BTC,,,,,,,",
        "2024-01-03,BUY,X,zero,BTC,100,USDT,,,,,",
        "not-a-date,BUY,X,1,BTC,100,USDT,,,,,",
      ),
    );
    expect(rows).toEqual([]);
    expect(skipped.map((s) => s.line)).toEqual([2, 3, 4, 5]);
    expect(skipped[0]!.reason).toContain("cash row");
    expect(skipped[1]!.reason).toContain("unsupported type");
    expect(skipped[2]!.reason).toContain("invalid base amount");
    expect(skipped[3]!.reason).toContain("unparseable date");
  });

  it("parses thousands separators and european decimals", () => {
    const { rows } = parseDeltaCsv(csv('2024-01-15,BUY,X,"1,250.5",ADA,"0,5",USDT,,,,,'));
    expect(rows[0]!.quantity).toBe(1250.5);
    expect(rows[0]!.price).toBeCloseTo(0.5 / 1250.5);
  });

  it("rejects a file without the required columns", () => {
    const { rows, skipped } = parseDeltaCsv("Foo,Bar\n1,2");
    expect(rows).toEqual([]);
    expect(skipped[0]!.reason).toContain("missing required column");
  });

  it("accepts the 'Way' header variant for the type column", () => {
    const { rows } = parseDeltaCsv(
      "Date,Way,Base amount,Base currency,Quote amount,Quote currency\n2024-01-15,BUY,1,BTC,40000,USDT",
    );
    expect(rows[0]!.side).toBe("buy");
  });
});
