import { describe, expect, it } from "vitest";
import { cashBalances, type CashRelevantTx } from "./cash";

function cash(side: string, quantity: number, currency = "EUR"): CashRelevantTx {
  return { assetType: "cash", side, quantity, nativeCurrency: currency, nativePrice: 1, nativeFee: null };
}

function trade(
  side: string, quantity: number, price: number, fee: number | null = null, currency: string | null = "EUR",
): CashRelevantTx {
  return { assetType: "crypto", side, quantity, nativeCurrency: currency, nativePrice: price, nativeFee: fee };
}

describe("cashBalances", () => {
  it("adds deposits and subtracts withdrawals", () => {
    expect(cashBalances([cash("transfer_in", 1000), cash("transfer_out", 250)])).toEqual({ EUR: 750 });
  });

  it("spends cash on a purchase, including its fee", () => {
    expect(cashBalances([cash("transfer_in", 1000), trade("buy", 2, 300, 10)])).toEqual({ EUR: 390 });
  });

  it("returns cash on a sale, net of the fee", () => {
    expect(cashBalances([trade("sell", 1, 500, 5)])).toEqual({ EUR: 495 });
  });

  it("keeps currencies apart", () => {
    const out = cashBalances([
      cash("transfer_in", 1000, "EUR"),
      cash("transfer_in", 500, "USD"),
      trade("buy", 1, 200, null, "USD"),
    ]);
    expect(out).toEqual({ EUR: 1000, USD: 300 });
  });

  it("ignores trades whose settlement currency is unknown", () => {
    expect(cashBalances([cash("transfer_in", 100), trade("buy", 1, 50, null, null)])).toEqual({ EUR: 100 });
    expect(cashBalances([
      cash("transfer_in", 100),
      { assetType: "crypto", side: "buy", quantity: 1, nativeCurrency: "EUR", nativePrice: null, nativeFee: null },
    ])).toEqual({ EUR: 100 });
  });

  it("reports a negative balance rather than hiding missing deposits", () => {
    expect(cashBalances([trade("buy", 1, 400)])).toEqual({ EUR: -400 });
  });

  it("drops balances rounded away to nothing", () => {
    expect(cashBalances([cash("transfer_in", 100), cash("transfer_out", 100)])).toEqual({});
    expect(cashBalances([cash("transfer_in", 100), cash("transfer_out", 99.999)])).toEqual({});
  });

  it("treats transfers of the asset itself as not touching cash", () => {
    const out = cashBalances([
      cash("transfer_in", 1000),
      { assetType: "crypto", side: "transfer_in", quantity: 1, nativeCurrency: "EUR", nativePrice: 500, nativeFee: null },
    ]);
    expect(out).toEqual({ EUR: 1000 });
  });
});
