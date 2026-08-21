import { describe, expect, it } from "vitest";
import { cashBalances, type CashRelevantTx } from "./cash";

function cash(side: string, quantity: number, currency = "EUR"): CashRelevantTx {
  return { assetType: "cash", side, quantity, nativeCurrency: currency };
}

function trade(side: string, quantity: number, currency: string | null = "EUR"): CashRelevantTx {
  return { assetType: "crypto", side, quantity, nativeCurrency: currency };
}

describe("cashBalances", () => {
  it("adds deposits and subtracts withdrawals", () => {
    expect(cashBalances([cash("transfer_in", 1000), cash("transfer_out", 250)])).toEqual({ EUR: 750 });
  });

  it("leaves asset trades alone: the export records their cash leg separately", () => {
    const out = cashBalances([
      cash("transfer_in", 10000),
      trade("buy", 2),   // an ETH purchase...
      cash("transfer_out", 4010), // ...and the euros Delta records leaving for it
    ]);
    expect(out).toEqual({ EUR: 5990 });
  });

  it("keeps currencies apart", () => {
    expect(cashBalances([
      cash("transfer_in", 1000, "EUR"),
      cash("transfer_in", 500, "USD"),
      cash("transfer_out", 200, "USD"),
    ])).toEqual({ EUR: 1000, USD: 300 });
  });

  it("treats a cash row booked as a buy as money arriving", () => {
    expect(cashBalances([cash("buy", 500)])).toEqual({ EUR: 500 });
  });

  it("ignores cash rows with no currency", () => {
    expect(cashBalances([{ assetType: "cash", side: "transfer_in", quantity: 100, nativeCurrency: null }]))
      .toEqual({});
  });

  it("reports a negative balance rather than hiding missing deposits", () => {
    expect(cashBalances([cash("transfer_out", 400)])).toEqual({ EUR: -400 });
  });

  it("drops balances rounded away to nothing", () => {
    expect(cashBalances([cash("transfer_in", 100), cash("transfer_out", 100)])).toEqual({});
    expect(cashBalances([cash("transfer_in", 100), cash("transfer_out", 99.999)])).toEqual({});
  });
});
