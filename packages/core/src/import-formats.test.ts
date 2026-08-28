import { describe, expect, it } from "vitest";
import { detectFormat, krakenPair, parseImport } from "./import-formats";

describe("detectFormat", () => {
  it("claims a format only when every signature column is there", () => {
    expect(detectFormat("Date(UTC),Pair,Side,Price,Executed,Amount,Fee\n")).toBe("binance");
    expect(detectFormat("Timestamp,Transaction Type,Asset,Quantity Transacted\n")).toBe("coinbase");
    expect(detectFormat("txid,ordertxid,pair,time,type,price,cost,fee,vol\n")).toBe("kraken");
    expect(detectFormat("Action,Time,ISIN,Ticker,No. of shares,Total\n")).toBe("trading212");
    expect(detectFormat("Date,Time,Product,ISIN,Quantity,Price,Local value\n")).toBe("degiro");
  });

  it("recognises Delta whether it heads the column Way or Type", () => {
    const way = "Date,Way,Base amount,Base currency,Quote amount,Quote currency\n";
    const type = "Date,Type,Base amount,Base currency,Quote amount,Quote currency\n";
    expect(detectFormat(way)).toBe("delta");
    expect(detectFormat(type)).toBe("delta");
  });

  it("refuses a near-miss rather than guessing", () => {
    // "Pair" alone is not Binance. Reading someone's ledger with the wrong
    // parser is the failure this whole module is arranged around.
    expect(detectFormat("Pair,Something,Else\n")).toBeNull();
    expect(detectFormat("")).toBeNull();
    expect(detectFormat("a,b,c\n1,2,3\n")).toBeNull();
  });

  it("does not claim DEGIRO's Dutch export, which has different headers", () => {
    expect(detectFormat("Datum,Tijd,Product,ISIN,Aantal,Koers\n")).toBeNull();
  });
});

describe("Binance", () => {
  const csv = [
    "Date(UTC),Pair,Side,Price,Executed,Amount,Fee",
    '2024-03-01 10:00:00,BTCUSDT,BUY,60000,0.5BTC,30000USDT,0.001BTC',
  ].join("\n");

  it("reads the unit out of the value, which is where Binance puts it", () => {
    const { rows } = parseImport(csv, "binance");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      symbol: "BTC", side: "buy", quantity: 0.5, price: 60_000, assetType: "crypto",
    });
  });

  it("prices a coin-quoted pair through the quote rather than mangling it", () => {
    // ETHBTC is ETH priced in BTC. The importer converts it later; what
    // matters here is that it is not read as USD.
    const { rows } = parseImport(
      "Date(UTC),Pair,Side,Price,Executed,Amount,Fee\n2024-03-01 10:00:00,ETHBTC,SELL,0.05,2ETH,0.1BTC,0",
      "binance",
    );
    expect(rows[0]).toMatchObject({ symbol: "ETH", side: "sell", quantity: 2 });
    expect(rows[0]!.pendingQuote).toEqual({ currency: "BTC", total: 0.1 });
    expect(rows[0]!.price).toBe(0);
  });

  it("skips a row it does not understand, with the reason", () => {
    const { rows, skipped } = parseImport(
      "Date(UTC),Pair,Side,Price,Executed,Amount,Fee\n2024-03-01 10:00:00,BTCUSDT,LIQUIDATION,1,1BTC,1USDT,0",
      "binance",
    );
    expect(rows).toHaveLength(0);
    expect(skipped[0]!.reason).toContain("LIQUIDATION");
  });
});

describe("Coinbase", () => {
  const header =
    "Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency," +
    "Spot Price at Transaction,Subtotal,Total,Fees and/or Spread";

  it("prices from the subtotal, which is before fees", () => {
    const { rows } = parseImport(
      `${header}\n2024-03-01T10:00:00Z,Buy,ETH,2,USD,2000,4000,4010,10`,
      "coinbase",
    );
    // 4000/2, not 4010/2 — a fee is not part of the price paid per unit.
    expect(rows[0]).toMatchObject({ symbol: "ETH", side: "buy", quantity: 2, price: 2000, fee: 10 });
  });

  it("treats a staking reward as an arrival with a basis, not as income", () => {
    // `income` is cash. A coin arriving is transfer_in, which has carried a
    // cost-basis price all along.
    const { rows } = parseImport(
      `${header}\n2024-03-01T10:00:00Z,Staking Income,ETH,0.1,USD,2000,200,200,0`,
      "coinbase",
    );
    expect(rows[0]).toMatchObject({ side: "transfer_in", assetType: "crypto", quantity: 0.1 });
  });

  it("refuses a Convert row instead of inventing one side of it", () => {
    const { rows, skipped } = parseImport(
      `${header}\n2024-03-01T10:00:00Z,Convert,ETH,2,USD,2000,4000,4000,0`,
      "coinbase",
    );
    expect(rows).toHaveLength(0);
    expect(skipped[0]!.reason).toContain("two trades");
  });
});

describe("Kraken", () => {
  it("decodes Kraken's own asset alphabet", () => {
    expect(krakenPair("XXBTZUSD")).toEqual({ base: "BTC", quote: "USD" });
    expect(krakenPair("XETHZEUR")).toEqual({ base: "ETH", quote: "EUR" });
    expect(krakenPair("SOLUSD")).toEqual({ base: "SOL", quote: "USD" });
  });

  it("gives up on a pair it cannot split, rather than slicing at a guess", () => {
    expect(krakenPair("WEIRD")).toBeNull();
    const { rows, skipped } = parseImport(
      "txid,pair,time,type,price,cost,fee,vol\nA,WEIRD,2024-03-01 10:00:00,buy,1,10,0,10",
      "kraken",
    );
    expect(rows).toHaveLength(0);
    expect(skipped[0]!.reason).toContain("unrecognised pair");
  });

  it("prices from cost over volume", () => {
    const { rows } = parseImport(
      "txid,pair,time,type,price,cost,fee,vol\nA,XXBTZUSD,2024-03-01 10:00:00,buy,60000,30000,15,0.5",
      "kraken",
    );
    expect(rows[0]).toMatchObject({ symbol: "BTC", side: "buy", quantity: 0.5, price: 60_000, fee: 15 });
  });
});

describe("Trading 212", () => {
  const header = "Action,Time,ISIN,Ticker,No. of shares,Price / share,Total,Currency (Total)";

  it("reads a market buy in the currency it settled in", () => {
    const { rows } = parseImport(
      `${header}\nMarket buy,2024-03-01 10:00:00,NL0010273215,ASML,2,600,1200,EUR`,
      "trading212",
    );
    expect(rows[0]).toMatchObject({ symbol: "ASML", assetType: "equity", side: "buy", quantity: 2 });
    // Not converted here: the importer does that at the trade's own date.
    expect(rows[0]!.pendingQuote).toEqual({ currency: "EUR", total: 1200 });
  });

  it("makes a dividend cash attributed to the payer, never a position change", () => {
    const { rows } = parseImport(
      `${header}\nDividend (Ordinary),2024-03-01 10:00:00,NL0010273215,ASML,0,0,15,EUR`,
      "trading212",
    );
    expect(rows[0]).toMatchObject({
      side: "income", assetType: "cash", symbol: "EUR", quantity: 15, price: 1,
      sourceSymbol: "ASML",
    });
  });
});

describe("DEGIRO", () => {
  const header = "Date,Time,Product,ISIN,Quantity,Price,Local value,Currency,Transaction costs";

  it("reads the European date and takes the side from the sign", () => {
    const { rows } = parseImport(
      `${header}\n02-01-2024,10:00,ASML,NL0010273215,-3,600,1800,EUR,2`,
      "degiro",
    );
    // 02-01-2024 is the second of January, not the first of February.
    expect(new Date(rows[0]!.time).toISOString()).toBe("2024-01-02T10:00:00.000Z");
    expect(rows[0]).toMatchObject({ side: "sell", quantity: 3, symbol: "NL0010273215" });
  });
});

describe("the generic mapper", () => {
  const csv = "when,what,coin,howmany,each\n2024-03-01,bought,btc,0.5,60000\n";
  const mapping = { time: "when", side: "what", symbol: "coin", quantity: "howmany", price: "each" };

  it("reads a file nothing else recognises", () => {
    const { rows } = parseImport(csv, "generic", mapping);
    expect(rows[0]).toMatchObject({ symbol: "BTC", side: "buy", quantity: 0.5, price: 60_000 });
  });

  it("refuses to run without a mapping instead of importing nothing quietly", () => {
    const { rows, skipped } = parseImport(csv, "generic");
    expect(rows).toHaveLength(0);
    expect(skipped[0]!.reason).toContain("mapping");
  });

  it("names the row it could not read", () => {
    const { skipped } = parseImport(
      "when,what,coin,howmany,each\nnot-a-date,bought,btc,1,1\n", "generic", mapping,
    );
    expect(skipped[0]).toMatchObject({ line: 2 });
    expect(skipped[0]!.reason).toContain("not-a-date");
  });
});
