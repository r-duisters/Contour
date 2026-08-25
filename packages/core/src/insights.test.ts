import { describe, expect, it } from "vitest";
import { allocation, concentration, contributions, flowsByYear, tradeStats, realisedByYear } from "./insights";
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

describe("allocation", () => {
  const mixed = [
    { ...holding({ symbol: "BTCUSDT", value: 600 }), assetType: "crypto" as const },
    { ...holding({ symbol: "ETHUSDT", value: 200 }), assetType: "crypto" as const },
    { ...holding({ symbol: "ASML.AS", value: 100 }), assetType: "equity" as const, instrumentType: "EQUITY" },
    { ...holding({ symbol: "EUDF.DE", value: 60 }), assetType: "equity" as const, instrumentType: "ETF" },
    { ...holding({ symbol: "EUR", value: 40 }), assetType: "cash" as const },
  ];

  it("separates funds from shares using the provider's instrument type", () => {
    const rows = allocation(mixed);
    expect(rows.map((r) => r.label)).toEqual(["Crypto", "Stocks", "ETFs", "Cash"]);
    expect(rows.map((r) => r.value)).toEqual([800, 100, 60, 40]);
  });

  it("shares are of the whole portfolio, and add up to it", () => {
    const rows = allocation(mixed);
    expect(rows.map((r) => r.share)).toEqual([80, 10, 6, 4]);
    expect(rows.reduce((a, r) => a + r.share, 0)).toBeCloseTo(100);
  });

  // A provider that does not report the type must not invent a fund.
  it("treats an equity of unknown type as a share", () => {
    const rows = allocation([
      { ...holding({ symbol: "AMD", value: 1 }), assetType: "equity" as const },
      { ...holding({ symbol: "GME", value: 1 }), assetType: "equity" as const, instrumentType: null },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.label).toBe("Stocks");
  });

  it("carries each class's own positions, largest first, shared against the whole", () => {
    const crypto = allocation(mixed)[0]!;
    expect(crypto.positions.map((p) => p.symbol)).toEqual(["BTCUSDT", "ETHUSDT"]);
    // 600 of a 1000 portfolio, not 75% of its own class.
    expect(crypto.positions[0]!.share).toBe(60);
  });

  it("leaves out classes and positions with no value", () => {
    const rows = allocation([
      { ...holding({ symbol: "BTCUSDT", value: 100 }), assetType: "crypto" as const },
      { ...holding({ symbol: "SUBUSDT", value: null }), assetType: "crypto" as const },
      { ...holding({ symbol: "AMD", value: 0 }), assetType: "equity" as const },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.positions.map((p) => p.symbol)).toEqual(["BTCUSDT"]);
  });

  it("is empty rather than dividing by zero when nothing is priced", () => {
    expect(allocation([{ ...holding({ symbol: "SUBUSDT", value: null }), assetType: "crypto" as const }]))
      .toEqual([]);
  });
});

describe("realisedByYear", () => {
  const buy = (symbol: string, time: number, quantity: number, price: number) =>
    ({ symbol, side: "buy" as const, quantity, price, fee: 0, time });
  const sell = (symbol: string, time: number, quantity: number, price: number, fee = 0) =>
    ({ symbol, side: "sell" as const, quantity, price, fee, time });
  const Y = (y: number) => Date.UTC(y, 5, 1);

  it("reports the profit a sale actually made, in the year it was made", () => {
    const out = realisedByYear([buy("BTC", Y(2020), 1, 10_000), sell("BTC", Y(2021), 1, 30_000)]);
    expect(out).toEqual([{ year: 2021, realised: 20_000 }]);
  });

  it("says nothing about years that only bought", () => {
    // A year of accumulation realised nothing. Reporting it as zero would put
    // a row on screen that reads like a flat year rather than a quiet one.
    const out = realisedByYear([buy("BTC", Y(2020), 1, 10_000)]);
    expect(out).toEqual([]);
  });

  it("separates the years, oldest first", () => {
    const out = realisedByYear([
      buy("BTC", Y(2019), 2, 1_000),
      sell("BTC", Y(2020), 1, 3_000),
      sell("BTC", Y(2021), 1, 500),
    ]);
    expect(out).toEqual([
      { year: 2020, realised: 2_000 },
      { year: 2021, realised: -500 },
    ]);
  });

  it("adds every asset's sales into the same year", () => {
    const out = realisedByYear([
      buy("BTC", Y(2020), 1, 1_000), sell("BTC", Y(2021), 1, 1_500),
      buy("ETH", Y(2020), 1, 100), sell("ETH", Y(2021), 1, 400),
    ]);
    expect(out).toEqual([{ year: 2021, realised: 800 }]);
  });

  it("nets the sale's fee out of the profit", () => {
    const out = realisedByYear([buy("BTC", Y(2020), 1, 1_000), sell("BTC", Y(2021), 1, 2_000, 50)]);
    expect(out).toEqual([{ year: 2021, realised: 950 }]);
  });

  it("replays each asset separately, so one asset's average cost never touches another's", () => {
    // Two assets at wildly different prices. Pooling them would value the ETH
    // sale against a basis that includes bitcoin.
    const out = realisedByYear([
      buy("BTC", Y(2020), 1, 50_000),
      buy("ETH", Y(2020), 1, 1_000),
      sell("ETH", Y(2021), 1, 2_000),
    ]);
    expect(out).toEqual([{ year: 2021, realised: 1_000 }]);
  });

  it("realises nothing for a transfer out — moving coins is not a disposal", () => {
    const out = realisedByYear([
      buy("BTC", Y(2020), 1, 1_000),
      { symbol: "BTC", side: "transfer_out" as const, quantity: 1, price: 9_000, fee: 0, time: Y(2021) },
    ]);
    expect(out).toEqual([]);
  });

  it("is empty for an empty ledger", () => {
    expect(realisedByYear([])).toEqual([]);
  });
});
