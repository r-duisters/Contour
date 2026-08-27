import { describe, expect, it } from "vitest";
import { cashBalances, cashBalancesOver, type CashRelevantTx } from "./cash";

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

describe("cashBalancesOver", () => {
  const DAY = 86_400_000;
  const tx = (day: number, side: string, quantity: number, nativeCurrency = "EUR") =>
    ({ assetType: "cash", side, quantity, nativeCurrency });

  it("gives the balance as it stood at each moment", () => {
    const txs = [tx(0, "transfer_in", 100), tx(0, "transfer_out", 30)];
    const at = [0, 1, 2].map((d) => d * DAY);
    // Both movements share a timestamp of 0 here; the shape under test is the
    // running total, so drive it with times rather than days.
    expect(cashBalancesOver(
      [{ ...txs[0]!, time: 0 }, { ...txs[1]!, time: DAY }],
      at,
    )).toEqual([{ EUR: 100 }, { EUR: 70 }, { EUR: 70 }]);
  });

  it("is empty before the first movement", () => {
    expect(cashBalancesOver([{ ...tx(0, "transfer_in", 100), time: DAY }], [0])).toEqual([{}]);
  });

  it("keeps currencies apart", () => {
    const txs = [
      { ...tx(0, "transfer_in", 100, "EUR"), time: 0 },
      { ...tx(0, "transfer_in", 50, "USD"), time: 0 },
    ];
    expect(cashBalancesOver(txs, [0])).toEqual([{ EUR: 100, USD: 50 }]);
  });

  it("reports a negative balance rather than hiding it", () => {
    // The caller decides what to do with an impossible balance; suppressing it
    // here would leave no way to tell "no cash" from "the ledger is wrong".
    const txs = [{ ...tx(0, "transfer_out", 40, "EUR"), time: 0 }];
    expect(cashBalancesOver(txs, [0])).toEqual([{ EUR: -40 }]);
  });

  it("agrees with cashBalances at the final moment", () => {
    const txs = [
      { ...tx(0, "transfer_in", 100, "EUR"), time: 0 },
      { ...tx(0, "transfer_out", 25, "EUR"), time: DAY },
      { ...tx(0, "transfer_in", 7, "USD"), time: 2 * DAY },
    ];
    const [last] = cashBalancesOver(txs, [3 * DAY]);
    expect(last).toEqual(cashBalances(txs));
  });
});

describe("income", () => {
  const dividend = {
    assetType: "cash", side: "income", quantity: 120, nativeCurrency: "EUR",
  };

  it("credits cash, it does not debit it", () => {
    expect(cashBalances([dividend])).toEqual({ EUR: 120 });
  });

  it("credits the running balance too", () => {
    const at = 1_700_000_000_000;
    expect(cashBalancesOver([{ ...dividend, time: at }], [at - 1, at + 1]))
      .toEqual([{}, { EUR: 120 }]);
  });
});

describe("a dividend's fee", () => {
  it("credits a dividend net of its fee", () => {
    // Delta's real dividend row carries a withholding. Gross in `quantity`,
    // the withholding in `fee`, so both figures stay truthful and the ledger
    // shows what was taken.
    expect(cashBalances([{ assetType: "cash", side: "income", quantity: 2.5,
                           fee: 0.5, nativeCurrency: "USD" }])).toEqual({ USD: 2 });
  });

  it("leaves every other cash row alone, which all have fee 0", () => {
    expect(cashBalances([{ assetType: "cash", side: "transfer_in", quantity: 100,
                           fee: 0, nativeCurrency: "EUR" }])).toEqual({ EUR: 100 });
  });
});
