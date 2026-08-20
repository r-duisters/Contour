import { describe, expect, it } from "vitest";
import { computeHoldings, portfolioValueSeries, valueHoldings, type Tx } from "./portfolio";
import type { Bar } from "./types";

const DAY = 86_400_000;

function tx(partial: Partial<Tx> & Pick<Tx, "side" | "quantity" | "price">): Tx {
  return { symbol: "BTCUSDT", fee: 0, time: 0, ...partial };
}

function bar(t: number, c: number): Bar {
  return { t, o: c, h: c, l: c, c, v: 0 };
}

describe("computeHoldings", () => {
  it("averages cost across multiple buys, fees included", () => {
    const [h] = computeHoldings([
      tx({ side: "buy", quantity: 1, price: 100, fee: 10, time: 1 }),
      tx({ side: "buy", quantity: 1, price: 200, fee: 0, time: 2 }),
    ]);
    expect(h!.quantity).toBe(2);
    expect(h!.costBasis).toBe(310); // 100 + 10 fee + 200
    expect(h!.avgCost).toBe(155);
  });

  it("realizes P&L on sell at average cost, net of sell fee", () => {
    const [h] = computeHoldings([
      tx({ side: "buy", quantity: 2, price: 100, time: 1 }),
      tx({ side: "sell", quantity: 1, price: 150, fee: 5, time: 2 }),
    ]);
    expect(h!.realizedPnl).toBe(45); // (150-100)*1 - 5
    expect(h!.quantity).toBe(1);
    expect(h!.costBasis).toBe(100);
    expect(h!.avgCost).toBe(100); // selling never moves average cost
  });

  it("clamps disposals to the held quantity", () => {
    const [h] = computeHoldings([
      tx({ side: "buy", quantity: 1, price: 100, time: 1 }),
      tx({ side: "sell", quantity: 5, price: 150, time: 2 }),
    ]);
    expect(h!.quantity).toBe(0);
    expect(h!.realizedPnl).toBe(50); // only the held 1 unit realizes
  });

  it("transfers move quantity without realizing P&L", () => {
    const [h] = computeHoldings([
      tx({ side: "transfer_in", quantity: 2, price: 100, time: 1 }),
      tx({ side: "transfer_out", quantity: 1, price: 0, time: 2 }),
    ]);
    expect(h!.quantity).toBe(1);
    expect(h!.realizedPnl).toBe(0);
    expect(h!.avgCost).toBe(100);
  });

  it("orders transactions by time regardless of input order", () => {
    const [h] = computeHoldings([
      tx({ side: "sell", quantity: 1, price: 200, time: 2 }),
      tx({ side: "buy", quantity: 1, price: 100, time: 1 }),
    ]);
    expect(h!.realizedPnl).toBe(100);
  });

  it("tracks symbols independently", () => {
    const holdings = computeHoldings([
      tx({ side: "buy", quantity: 1, price: 100, time: 1 }),
      tx({ symbol: "ETHUSDT", side: "buy", quantity: 10, price: 20, time: 1 }),
    ]);
    expect(holdings).toHaveLength(2);
    expect(holdings.find((h) => h.symbol === "ETHUSDT")!.costBasis).toBe(200);
  });
});

describe("valueHoldings", () => {
  it("computes value and unrealized P&L from live prices", () => {
    const holdings = computeHoldings([tx({ side: "buy", quantity: 2, price: 100, time: 1 })]);
    const [v] = valueHoldings(holdings, { BTCUSDT: 150 });
    expect(v!.value).toBe(300);
    expect(v!.unrealizedPnl).toBe(100);
  });

  it("returns nulls when a price is missing", () => {
    const holdings = computeHoldings([tx({ side: "buy", quantity: 2, price: 100, time: 1 })]);
    const [v] = valueHoldings(holdings, {});
    expect(v!.value).toBeNull();
    expect(v!.unrealizedPnl).toBeNull();
  });
});

describe("portfolioValueSeries", () => {
  it("values held quantity at each day's close", () => {
    const candles = { BTCUSDT: [bar(0, 100), bar(DAY, 110), bar(2 * DAY, 120)] };
    const series = portfolioValueSeries(
      [tx({ side: "buy", quantity: 1, price: 100, time: DAY / 2 })],
      candles,
    );
    expect(series.map((p) => p.value)).toEqual([100, 110, 120]);
  });

  it("applies buys and sells on the day they happen", () => {
    const candles = { BTCUSDT: [bar(0, 100), bar(DAY, 110), bar(2 * DAY, 120)] };
    const series = portfolioValueSeries(
      [
        tx({ side: "buy", quantity: 2, price: 100, time: 1 }),
        tx({ side: "sell", quantity: 1, price: 110, time: DAY + 1 }),
      ],
      candles,
    );
    expect(series.map((p) => p.value)).toEqual([200, 110, 120]);
  });

  it("omits days before the first transaction", () => {
    const candles = { BTCUSDT: [bar(0, 100), bar(DAY, 110), bar(2 * DAY, 120)] };
    const series = portfolioValueSeries(
      [tx({ side: "buy", quantity: 1, price: 115, time: DAY + DAY / 2 })],
      candles,
    );
    expect(series.map((p) => p.t)).toEqual([DAY, 2 * DAY]);
  });

  it("sums multiple symbols and carries the last close over gaps", () => {
    const candles = {
      BTCUSDT: [bar(0, 100), bar(DAY, 110), bar(2 * DAY, 120)],
      ETHUSDT: [bar(0, 10), bar(2 * DAY, 30)], // gap on day 1
    };
    const series = portfolioValueSeries(
      [
        tx({ side: "buy", quantity: 1, price: 100, time: 1 }),
        tx({ symbol: "ETHUSDT", side: "buy", quantity: 5, price: 10, time: 1 }),
      ],
      candles,
    );
    expect(series.map((p) => p.value)).toEqual([150, 160, 270]); // day 1 reuses ETH close 10
  });

  it("returns empty for no transactions", () => {
    expect(portfolioValueSeries([], { BTCUSDT: [bar(0, 100)] })).toEqual([]);
  });
});

describe("portfolioValueSeries with intraday bars", () => {
  it("applies transactions within a smaller bar width", () => {
    const HOUR = 3_600_000;
    const candles = {
      BTCUSDT: [bar(0, 100), bar(HOUR, 110), bar(2 * HOUR, 120)],
    };
    const series = portfolioValueSeries(
      [
        tx({ side: "buy", quantity: 1, price: 100, time: 1 }),
        tx({ side: "buy", quantity: 1, price: 110, time: HOUR + 1 }),
      ],
      candles,
      HOUR,
    );
    expect(series.map((p) => p.value)).toEqual([100, 220, 240]);
  });
});
