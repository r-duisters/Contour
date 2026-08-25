import { beforeEach, describe, expect, it } from "vitest";
import { invalidate } from "@/core/cache";
import { MemoryStore } from "../testing/memory-store";
import { FakeNet, respondWith } from "../testing/fake-net";
import {
  clearPortfolio, exportCsv, exportJson, importDelta, InvalidBackupError, restore,
} from "./transfer";
import { NotFoundError } from "../errors";

/**
 * `sources/*` memoise through `packages/core/src/cache.ts`, a module-level map
 * shared by every test in the process. Without this a leftover entry — from
 * another suite, or from `packages/core`'s copy under the same key — answers
 * before the `FakeNet` is consulted and the suite proves nothing.
 */
beforeEach(() => invalidate());

const DAY_MS = 86_400_000;
const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/**
 * A Delta export in miniature: `samples/` carries no CSV, so this covers the
 * shapes the importer treats differently — a EUR-quoted buy, a stable-quoted
 * sell, a transfer, a fiat row, an unsuffixed US ticker on a broker venue, a
 * buy in a currency Binance does not list, and a row the parser rejects.
 */
const CSV = [
  "Date,Way,Base amount,Base currency,Quote amount,Quote currency,Fee amount,Fee currency,Exchange",
  "2024-03-01 12:00:00,BUY,0.5,BTC,20000,EUR,10,EUR,Bitvavo",
  "2024-04-01 12:00:00,SELL,2,ETH,7000,USDT,3.5,USDT,Binance",
  "2024-05-01 12:00:00,DEPOSIT,1,BTC,,,,,Ledger",
  "2024-02-01 12:00:00,DEPOSIT,1000,EUR,,,,,Bitvavo",
  "2024-07-01 12:00:00,BUY,10,AMD,1500,USD,,,DEGIRO",
  "2024-08-01 12:00:00,BUY,5,SOL,100,ZWL,,,MyVault",
  "2024-09-01 12:00:00,SLASHED,1,BTC,,,,,Binance",
].join("\n");

/** Binance klines, one daily bar per UTC day in the requested window. */
function klines(close: number) {
  return (url: string) => {
    const params = new URL(url).searchParams;
    const from = Number(params.get("startTime"));
    const to = Number(params.get("endTime"));
    const out: unknown[] = [];
    for (let t = Math.floor(from / DAY_MS) * DAY_MS; t <= to; t += DAY_MS) {
      out.push([t, "1", "1", "1", String(close), "1", t + DAY_MS - 1, "0", 0, "0", "0", "0"]);
    }
    return out;
  };
}

const EXCHANGE_INFO = {
  symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "EURUSDT"].map((symbol) => ({
    symbol, status: "TRADING", quoteAsset: "USDT", isSpotTradingAllowed: true,
  })),
};

/** EUR is worth 1.10 USD on every day the importer asks about. */
function importNet() {
  return FakeNet({
    "/api/v3/exchangeInfo": EXCHANGE_INFO,
    "symbol=EURUSDT": klines(1.1),
    "symbol=ZWLUSDT": respondWith(400, { code: -1121, msg: "Invalid symbol." }),
  });
}

async function seeded() {
  const store = MemoryStore();
  const p = await store.portfolios.create("Scratch");
  const report = await importDelta(store, importNet(), p.id, CSV);
  return { store, id: p.id, report };
}

describe("importDelta", () => {
  it("writes every parsed row, and the count matches", async () => {
    const { store, id, report } = await seeded();
    const portfolio = await store.portfolios.get(id);
    expect(report.imported).toBe(6);
    expect(report.duplicates).toBe(0);
    expect(portfolio!.transactions).toHaveLength(6);
    expect(portfolio!.transactions.every((t) => t.note === "delta-import")).toBe(true);
  });

  it("reports the row it could not read, with the reason", async () => {
    const { report } = await seeded();
    expect(report.skipped).toEqual([{ line: 8, reason: 'unsupported type "SLASHED"' }]);
  });

  it("reports the row it could not price, with the reason", async () => {
    const { report } = await seeded();
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]!.reason).toBe(
      "no ZWLUSDT market to price SOL — imported with price 0",
    );
  });

  it("prices a EUR-quoted buy through that day's EURUSDT close, keeping the native figures", async () => {
    const { store, id } = await seeded();
    const rows = (await store.portfolios.get(id))!.transactions;
    const btc = rows.find((t) => t.symbol === "BTC" && t.side === "buy")!;
    expect(btc.price).toBeCloseTo(44_000, 6);   // 20000/0.5 EUR * 1.10
    expect(btc.fee).toBeCloseTo(11, 6);         // 10 EUR * 1.10
    expect(btc.nativeCurrency).toBe("EUR");
    expect(btc.nativePrice).toBe(40_000);
    expect(btc.nativeFee).toBe(10);
  });

  it("reclassifies an unsuffixed ticker on a broker venue as an equity", async () => {
    const { store, id } = await seeded();
    const rows = (await store.portfolios.get(id))!.transactions;
    const amd = rows.find((t) => t.symbol === "AMD")!;
    expect(amd.assetType).toBe("equity");
    expect(amd.price).toBe(150);
  });

  it("keeps a fiat row as cash and a wallet deposit as a crypto transfer", async () => {
    const { store, id } = await seeded();
    const rows = (await store.portfolios.get(id))!.transactions;
    const eur = rows.find((t) => t.symbol === "EUR")!;
    expect(eur.assetType).toBe("cash");
    expect(eur.side).toBe("transfer_in");
    expect(eur.nativeCurrency).toBe("EUR");
    const deposit = rows.find((t) => t.symbol === "BTC" && t.side === "transfer_in")!;
    expect(deposit.assetType).toBe("crypto");
  });

  it("re-importing the same file writes nothing and counts the duplicates", async () => {
    const { store, id } = await seeded();
    const again = await importDelta(store, importNet(), id, CSV);
    expect(again.imported).toBe(0);
    expect(again.duplicates).toBe(6);
    expect((await store.portfolios.get(id))!.transactions).toHaveLength(6);
  });

  it("refuses a portfolio that does not exist", async () => {
    const store = MemoryStore();
    await expect(importDelta(store, importNet(), "nope", CSV)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("clearPortfolio", () => {
  it("removes only the imported rows, and only in the named portfolio", async () => {
    const { store, id } = await seeded();
    const other = await store.portfolios.create("Other");
    await importDelta(store, importNet(), other.id, CSV);
    await store.transactions.add(id, {
      symbol: "BTCUSDT", assetType: "crypto", side: "buy", quantity: 1, price: 1, fee: 0,
      time: day("2024-10-01"), nativeCurrency: null, nativePrice: null, nativeFee: null,
      note: "typed by hand",
    });

    expect(await clearPortfolio(store, id)).toBe(6);
    const left = (await store.portfolios.get(id))!.transactions;
    expect(left.map((t) => t.note)).toEqual(["typed by hand"]);
    expect((await store.portfolios.get(other.id))!.transactions).toHaveLength(6);
  });

  it("answers zero for a portfolio that does not exist, as the route always has", async () => {
    expect(await clearPortfolio(MemoryStore(), "nope")).toBe(0);
  });
});

describe("exportCsv", () => {
  it("keeps Ghostfolio's column order, and drops cash rows", async () => {
    const { store, id } = await seeded();
    const { body } = await exportCsv(store, FakeNet({}), id, "ghostfolio");
    const lines = body.trimEnd().split("\r\n");
    expect(lines[0]).toBe("Date,Symbol,Type,Quantity,UnitPrice,Fee,Currency");
    expect(lines).toHaveLength(6); // header + 5 non-cash rows
    expect(lines[1]).toBe("2024-03-01,BTC,BUY,0.5,44000,11,USD");
  });

  it("keeps the full transactions column order", async () => {
    const { store, id } = await seeded();
    const { body } = await exportCsv(store, FakeNet({}), id, "csv");
    expect(body.split("\r\n")[0]).toBe(
      "date,symbol,assetType,side,quantity,price,fee,currency,nativeCurrency,nativePrice,sourceSymbol,note",
    );
  });

  it("uses the amount actually paid when the display currency matches the native one", async () => {
    const { store, id } = await seeded();
    await store.settings.save({ displayCurrency: "EUR" });
    const net = FakeNet({ "frankfurter.dev/v1/latest": { rates: { USD: 1.25 } } });
    const { body } = await exportCsv(store, net, id, "ghostfolio");
    const btc = body.split("\r\n").find((l) => l.startsWith("2024-03-01"))!;
    // The EUR-native buy keeps 40 000, not 44 000/1.25; the USD-quoted sell converts.
    expect(btc).toBe("2024-03-01,BTC,BUY,0.5,40000,10,EUR");
    const eth = body.split("\r\n").find((l) => l.startsWith("2024-04-01"))!;
    expect(eth).toBe("2024-04-01,ETH,SELL,2,2800,2.8000000000000003,EUR");
  });

  it("labels the figures USD when the euro rate cannot be fetched", async () => {
    const { store, id } = await seeded();
    await store.settings.save({ displayCurrency: "EUR" });
    const net = FakeNet({ "frankfurter.dev/v1/latest": respondWith(503, "down") });
    const { body } = await exportCsv(store, net, id, "ghostfolio");
    expect(body.trimEnd().split("\r\n")[1]!.endsWith(",USD")).toBe(true);
  });
});

describe("exportJson and restore", () => {
  it("round-trips a portfolio: export, restore, export again, identical transactions", async () => {
    const { store, id } = await seeded();
    const first = await exportJson(store, id);

    const { portfolio, restored } = await restore(store, first.body);
    expect(restored).toBe(6);
    // A name collision must not overwrite the original.
    expect(portfolio.id).not.toBe(id);
    expect(portfolio.name).toMatch(/^Scratch \(restored \d{4}-\d{2}-\d{2}\)$/);

    const second = await exportJson(store, portfolio.id);
    const txsOf = (raw: string) => JSON.parse(raw).portfolio.transactions;
    expect(txsOf(second.body)).toEqual(txsOf(first.body));
  });

  it("carries the native figures through both directions", async () => {
    const { store, id } = await seeded();
    const { portfolio } = await restore(store, (await exportJson(store, id)).body);
    const btc = (await store.portfolios.get(portfolio.id))!.transactions
      .find((t) => t.symbol === "BTC" && t.side === "buy")!;
    expect(btc.nativeCurrency).toBe("EUR");
    expect(btc.nativePrice).toBe(40_000);
    expect(btc.nativeFee).toBe(10);
    expect(btc.note).toBe("delta-import");
  });

  it("keeps the backup's own name when nothing else claims it", async () => {
    const { store, id } = await seeded();
    const backup = (await exportJson(store, id)).body;
    await store.portfolios.remove(id);
    const { portfolio } = await restore(store, backup);
    expect(portfolio.name).toBe("Scratch");
  });

  it("names the download after the portfolio and the day", async () => {
    const { store, id } = await seeded();
    const stamp = new Date().toISOString().slice(0, 10);
    expect((await exportJson(store, id)).filename).toBe(`scratch-backup-${stamp}.json`);
    expect((await exportCsv(store, FakeNet({}), id, "ghostfolio")).filename)
      .toBe(`scratch-ghostfolio-${stamp}.csv`);
  });

  it("rejects a backup it cannot read, saying why", async () => {
    const store = MemoryStore();
    await expect(restore(store, "{oops")).rejects.toBeInstanceOf(InvalidBackupError);
    await expect(restore(store, "{oops")).rejects.toThrow("not valid JSON");
    await expect(restore(store, JSON.stringify({ version: 1 })))
      .rejects.toThrow(/exportedAt/);
  });

  it("refuses a portfolio that does not exist", async () => {
    await expect(exportJson(MemoryStore(), "nope")).rejects.toBeInstanceOf(NotFoundError);
  });
});
