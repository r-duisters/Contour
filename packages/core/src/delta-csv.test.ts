import { describe, expect, it } from "vitest";
import { parseCsv, parseDeltaCsv, venueAssetType } from "./delta-csv";

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
  it("records the asset bought, not a pair it made up", () => {
    // Delta gives base and quote in their own columns. The importer used to
    // append a constant "USDT" regardless of what the quote column said.
    const { rows } = parseDeltaCsv(csv("2024-01-15,BUY,Bitvavo,1,ETH,2000,EUR,0,EUR,,,"));
    expect(rows[0]!.symbol).toBe("ETH");
    expect(rows[0]!.nativeCurrency).toBe("EUR");
  });

  it("records a coin bought with another coin", () => {
    // 52 rows in the live ledger are this shape, and none of them could say so.
    const { rows } = parseDeltaCsv(csv("2024-01-15,BUY,Binance,100,IOTA,0.5,ETH,,,1200,USD,"));
    expect(rows[0]!.symbol).toBe("IOTA");
  });

  it("leaves an equity ticker alone", () => {
    const { rows } = parseDeltaCsv(csv("2024-01-15,BUY,eToro,10,ASML.AS,6000,EUR,0,EUR,,,"));
    expect(rows[0]!.symbol).toBe("ASML.AS");
  });

  it("maps a buy with USD quote to price per unit and fee", () => {
    const { rows, skipped, warnings } = parseDeltaCsv(
      csv("2024-01-15 10:30:00,BUY,Binance,0.5,BTC,21000,USDT,10,USDT,,,"),
    );
    expect(skipped).toEqual([]);
    expect(warnings).toEqual([]);
    expect(rows).toEqual([{
      symbol: "BTC", assetType: "crypto", base: "BTC", venue: "Binance",
      side: "buy", quantity: 0.5, price: 42000, fee: 10,
      time: Date.parse("2024-01-15T10:30:00"), pendingQuote: undefined, feeRaw: undefined,
      nativeCurrency: "USD", nativePrice: 42000, nativeFee: 10,
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

  it("skips unsupported types, bad amounts, and bad dates with reasons", () => {
    const { rows, skipped } = parseDeltaCsv(
      csv(
        "2024-01-02,LOAN,X,1,BTC,,,,,,,",
        "2024-01-03,BUY,X,zero,BTC,100,USDT,,,,,",
        "not-a-date,BUY,X,1,BTC,100,USDT,,,,,",
      ),
    );
    expect(rows).toEqual([]);
    expect(skipped.map((s) => s.line)).toEqual([2, 3, 4]);
    expect(skipped[0]!.reason).toContain("unsupported type");
    expect(skipped[1]!.reason).toContain("invalid base amount");
    expect(skipped[2]!.reason).toContain("unparseable date");
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

  it("normalizes Delta's verbose currency names and asterisk markers", () => {
    const { rows } = parseDeltaCsv(
      csv('2024-01-15,BUY,Binance,10,"DOT* (POLKADOT)",70,"USDT (TETHER)",,,,,'),
    );
    expect(rows[0]!.symbol).toBe("DOT");
    expect(rows[0]!.price).toBe(7); // USDT (TETHER) recognized as a stable
  });

  it("imports fiat rows as cash and equities as equities", () => {
    const { rows, skipped } = parseDeltaCsv(
      csv(
        '2024-01-01,DEPOSIT,Bank,1000,"EUR (EURO)",,,,,,,',
        '2024-01-02,BUY,DeGiro,10,"SHELL.AS (SHELL PLC)",300,EUR,,,,,',
      ),
    );
    expect(skipped).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      symbol: "EUR", assetType: "cash", side: "transfer_in", quantity: 1000,
      nativeCurrency: "EUR", nativePrice: 1,
    });
    expect(rows[1]).toMatchObject({ symbol: "SHELL.AS", assetType: "equity" });
  });

  it("treats a fiat withdrawal as cash leaving", () => {
    const { rows } = parseDeltaCsv(csv('2024-01-05,WITHDRAW,Bank,250,"EUR (EURO)",,,,,,,'));
    expect(rows[0]).toMatchObject({ assetType: "cash", side: "transfer_out", quantity: 250 });
  });

  it("marks coin rows as crypto and names them by the asset", () => {
    const { rows } = parseDeltaCsv(csv("2024-01-15,BUY,Binance,1,BTC,40000,USDT,,,,,"));
    expect(rows[0]!.assetType).toBe("crypto");
    expect(rows[0]!.symbol).toBe("BTC");
  });

  it("captures the venue and classifies it", () => {
    const { rows } = parseDeltaCsv(csv("2024-01-15,BUY,Binance,1,BTC,40000,USDT,,,,,"));
    expect(rows[0]!.venue).toBe("Binance");
    expect(venueAssetType("Binance")).toBe("crypto");
    expect(venueAssetType("My Ledger wallet")).toBe("crypto");
    expect(venueAssetType("DeGiro")).toBe("equity");
    // Exports often name the exchange rather than the broker.
    expect(venueAssetType("Nasdaq")).toBe("equity");
    expect(venueAssetType("Euronext Amsterdam")).toBe("equity");
    expect(venueAssetType("XETRA")).toBe("equity");
    expect(venueAssetType("Interactive Brokers")).toBe("equity");
    expect(venueAssetType("")).toBeNull();
    expect(venueAssetType("Some Unknown Place")).toBeNull();
  });

  it("records what a EUR-settled trade actually cost in EUR", () => {
    const { rows } = parseDeltaCsv(csv("2017-06-01,BUY,Bitvavo,10,ETH,2000,EUR,5,EUR,,,"));
    expect(rows[0]!.nativeCurrency).toBe("EUR");
    expect(rows[0]!.nativePrice).toBe(200); // 2000 EUR / 10 ETH, untouched by FX
    expect(rows[0]!.nativeFee).toBe(5);
  });

  it("accepts the 'Way' header variant for the type column", () => {
    const { rows } = parseDeltaCsv(
      "Date,Way,Base amount,Base currency,Quote amount,Quote currency\n2024-01-15,BUY,1,BTC,40000,USDT",
    );
    expect(rows[0]!.side).toBe("buy");
  });
});
