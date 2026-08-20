import { describe, expect, it } from "vitest";
import { classSplit, concentration, contributions, flowsByYear, tradeStats } from "./insights";
import type { Tx, ValuedHolding } from "./portfolio";

const DAY = 86_400_000;

function tx(partial: Partial<Tx> & Pick<Tx, "side" | "quantity" | "price">): Tx {
  return { symbol: "BTCUSDT", fee: 0, time: Date.UTC(2024, 0, 1), ...partial };
}

function holding(partial: Partial<ValuedHolding> & { symbol: string }): ValuedHolding {
  return {
    quantity: 1, avgCost: 0, costBasis: 0, realizedPnl: 0, fees: 0,
    price: null, value: null, unrealizedPnl: null, ...partial,
  };
}

describe("tradeStats", () => {
  it("counts sides and totals bought, sold and paid in fees", () => {
    const s = tradeStats([
      tx({ side: "buy", quantity: 1, price: 100, fee: 2 }),
      tx({ side: "buy", quantity: 1, price: 300, fee: 4 }),
      tx({ side: "sell", quantity: 1, price: 150, fee: 1 }),
      tx({ side: "transfer_in", quantity: 1, price: 0 }),
    ]);
    expect([s.trades, s.buys, s.sells, s.transfers]).toEqual([4, 2, 1, 1]);
    expect(s.totalBought).toBe(400);
    expect(s.totalSold).toBe(150);
    expect(s.fees).toBe(7);
    expect(s.avgBuySize).toBe(200);
    expect(s.feeRatePct).toBeCloseTo(1.75);
  });

  it("reports the first and last trade and how many assets were touched", () => {
    const s = tradeStats([
      tx({ side: "buy", quantity: 1, price: 1, time: 5 * DAY }),
      tx({ symbol: "ETHUSDT", side: "buy", quantity: 1, price: 1, time: DAY }),
    ]);
    expect(s.firstTrade).toBe(DAY);
    expect(s.lastTrade).toBe(5 * DAY);
    expect(s.assetsTraded).toBe(2);
  });

  it("finds the busiest year", () => {
    const s = tradeStats([
      tx({ side: "buy", quantity: 1, price: 1, time: Date.UTC(2021, 5, 1) }),
      tx({ side: "buy", quantity: 1, price: 1, time: Date.UTC(2023, 5, 1) }),
      tx({ side: "buy", quantity: 1, price: 1, time: Date.UTC(2023, 8, 1) }),
    ]);
    expect(s.busiestYear).toEqual({ year: 2023, trades: 2 });
  });

  it("handles an empty ledger without dividing by zero", () => {
    const s = tradeStats([]);
    expect(s.trades).toBe(0);
    expect(s.feeRatePct).toBeNull();
    expect(s.avgBuySize).toBeNull();
    expect(s.busiestYear).toBeNull();
  });
});

describe("flowsByYear", () => {
  it("nets purchases against sales per year, oldest first", () => {
    const rows = flowsByYear([
      tx({ side: "buy", quantity: 1, price: 1000, fee: 10, time: Date.UTC(2022, 1, 1) }),
      tx({ side: "sell", quantity: 1, price: 400, time: Date.UTC(2022, 6, 1) }),
      tx({ side: "buy", quantity: 1, price: 500, time: Date.UTC(2021, 1, 1) }),
    ]);
    expect(rows).toEqual([
      { year: 2021, net: 500 },
      { year: 2022, net: 610 },
    ]);
  });
});

describe("concentration", () => {
  it("measures the largest position and the herfindahl index", () => {
    const c = concentration([
      holding({ symbol: "A", value: 600 }),
      holding({ symbol: "B", value: 300 }),
      holding({ symbol: "C", value: 100 }),
    ]);
    expect(c.topShare).toBeCloseTo(60);
    expect(c.top3Share).toBeCloseTo(100);
    expect(c.herfindahl).toBeCloseTo(0.46); // .36 + .09 + .01
    expect(c.pricedCount).toBe(3);
  });

  it("ignores unpriced holdings and reports nulls when nothing is valued", () => {
    const c = concentration([holding({ symbol: "DEAD", value: null })]);
    expect(c.topShare).toBeNull();
    expect(c.pricedCount).toBe(0);
  });
});

describe("contributions", () => {
  it("ranks holdings by realized plus unrealized profit", () => {
    const rows = contributions([
      holding({ symbol: "WIN", realizedPnl: 100, unrealizedPnl: 400, costBasis: 1000 }),
      holding({ symbol: "LOSS", realizedPnl: 0, unrealizedPnl: -200, costBasis: 500 }),
    ]);
    expect(rows.map((r) => r.symbol)).toEqual(["WIN", "LOSS"]);
    expect(rows[0]!.total).toBe(500);
    expect(rows[0]!.pct).toBeCloseTo(40);
    expect(rows[1]!.total).toBe(-200);
  });
});

describe("classSplit", () => {
  it("splits value between crypto and equities", () => {
    const rows = classSplit([
      { ...holding({ symbol: "BTCUSDT", value: 300 }), assetType: "crypto" as const },
      { ...holding({ symbol: "ASML.AS", value: 700 }), assetType: "equity" as const },
    ]);
    expect(rows[0]).toEqual({ label: "Stocks & ETFs", value: 700, share: 70 });
    expect(rows[1]).toEqual({ label: "Crypto", value: 300, share: 30 });
  });
});
