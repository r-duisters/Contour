import { describe, expect, it } from "vitest";
import {
  flowsByBar, indexSeries, moneyWeightedReturn, simulateFlowsInto, timeWeightedSeries,
} from "./performance";
import type { Tx } from "./portfolio";

const DAY = 86_400_000;

function tx(partial: Partial<Tx> & Pick<Tx, "side" | "quantity" | "price">): Tx {
  return { symbol: "BTCUSDT", fee: 0, time: 0, ...partial };
}

describe("flowsByBar", () => {
  it("treats a purchase as an inflow of its full cost, fee included", () => {
    const flows = flowsByBar([tx({ side: "buy", quantity: 2, price: 100, fee: 5, time: DAY + 1 })]);
    expect(flows.get(DAY)).toBe(205);
  });

  it("treats a sale as an outflow of its net proceeds", () => {
    const flows = flowsByBar([tx({ side: "sell", quantity: 1, price: 100, fee: 5, time: 1 })]);
    expect(flows.get(0)).toBe(-95);
  });

  it("nets several transactions in the same bar", () => {
    const flows = flowsByBar([
      tx({ side: "buy", quantity: 1, price: 100, time: 1 }),
      tx({ side: "sell", quantity: 1, price: 40, time: 2 }),
    ]);
    expect(flows.get(0)).toBe(60);
  });

  it("ignores free arrivals so staking rewards count as return", () => {
    const flows = flowsByBar([tx({ side: "transfer_in", quantity: 1, price: 0, time: 1 })]);
    expect(flows.size).toBe(0);
  });

  it("counts a priced transfer as a flow at that price", () => {
    const flows = flowsByBar([tx({ side: "transfer_in", quantity: 2, price: 50, time: 1 })]);
    expect(flows.get(0)).toBe(100);
  });
});

describe("timeWeightedSeries", () => {
  it("reports pure market growth when nothing is added", () => {
    const { totalPct } = timeWeightedSeries(
      [{ t: 0, value: 100 }, { t: DAY, value: 110 }, { t: 2 * DAY, value: 121 }],
      new Map(),
    );
    expect(totalPct).toBeCloseTo(21); // 10% then 10%
  });

  it("does not count a deposit as a gain", () => {
    // Value doubles, but only because 100 was added on day 1.
    const { totalPct } = timeWeightedSeries(
      [{ t: 0, value: 100 }, { t: DAY, value: 200 }],
      new Map([[DAY, 100]]),
    );
    expect(totalPct).toBeCloseTo(0);
  });

  it("does not count a withdrawal as a loss", () => {
    const { totalPct } = timeWeightedSeries(
      [{ t: 0, value: 200 }, { t: DAY, value: 100 }],
      new Map([[DAY, -100]]),
    );
    expect(totalPct).toBeCloseTo(0);
  });

  it("separates market movement from a same-bar deposit", () => {
    // Started at 100, grew 10% to 110, then 50 was added -> 160.
    const { totalPct } = timeWeightedSeries(
      [{ t: 0, value: 100 }, { t: DAY, value: 160 }],
      new Map([[DAY, 50]]),
    );
    expect(totalPct).toBeCloseTo(10);
  });

  it("starts the index at 100 and ignores bars before any value exists", () => {
    const { points } = timeWeightedSeries(
      [{ t: 0, value: 0 }, { t: DAY, value: 100 }, { t: 2 * DAY, value: 150 }],
      new Map([[DAY, 100]]),
    );
    expect(points[0]!.index).toBe(100);
    expect(points[1]!.index).toBe(100);
    expect(points[2]!.index).toBeCloseTo(150);
  });

  it("returns null for a series too short to have a return", () => {
    expect(timeWeightedSeries([{ t: 0, value: 100 }], new Map()).totalPct).toBeNull();
  });
});

describe("indexSeries", () => {
  it("rebases a price series to 100", () => {
    const pts = indexSeries([{ t: 0, c: 50 }, { t: DAY, c: 75 }]);
    expect(pts.map((p) => p.index)).toEqual([100, 150]);
  });

  it("skips leading zero prices when choosing the base", () => {
    const pts = indexSeries([{ t: 0, c: 0 }, { t: DAY, c: 20 }, { t: 2 * DAY, c: 30 }]);
    expect(pts[1]!.index).toBe(100);
    expect(pts[2]!.index).toBe(150);
  });

  it("returns empty when no positive price exists", () => {
    expect(indexSeries([{ t: 0, c: 0 }])).toEqual([]);
  });
});

describe("moneyWeightedReturn", () => {
  it("returns the simple rate for one flow held a year", () => {
    const r = moneyWeightedReturn([{ t: 0, amount: 100 }], 110, 365 * DAY);
    expect(r).toBeCloseTo(10, 1);
  });

  it("annualises a half-year gain", () => {
    const r = moneyWeightedReturn([{ t: 0, amount: 100 }], 110, 182.5 * DAY);
    expect(r).toBeCloseTo(21, 0); // 1.1^2 - 1
  });

  it("rewards money added before a rise more than a time-weighted view would", () => {
    // Small early stake, large stake just before the value doubles.
    const early = moneyWeightedReturn(
      [{ t: 0, amount: 100 }, { t: 300 * DAY, amount: 900 }],
      2000,
      365 * DAY,
    );
    expect(early).not.toBeNull();
    expect(early!).toBeGreaterThan(50);
  });

  it("reports a loss as a negative rate", () => {
    const r = moneyWeightedReturn([{ t: 0, amount: 100 }], 80, 365 * DAY);
    expect(r).toBeLessThan(0);
  });

  it("returns null when nothing was ever invested", () => {
    expect(moneyWeightedReturn([], 0, DAY)).toBeNull();
    expect(moneyWeightedReturn([{ t: 0, amount: 100 }], 0, 0)).toBeNull();
  });
});

describe("simulateFlowsInto", () => {
  it("buys units with each flow at that bar's price", () => {
    const prices = new Map([[0, 10], [DAY, 20]]);
    const out = simulateFlowsInto([{ t: 0, amount: 100 }], prices, [0, DAY]);
    expect(out.map((p) => p.value)).toEqual([100, 200]); // 10 units, price doubles
  });

  it("sells proportionally on a negative flow", () => {
    const prices = new Map([[0, 10], [DAY, 10]]);
    const out = simulateFlowsInto(
      [{ t: 0, amount: 100 }, { t: DAY, amount: -50 }],
      prices,
      [0, DAY],
    );
    expect(out[1]!.value).toBe(50);
  });

  it("never goes negative when withdrawals exceed the position", () => {
    const prices = new Map([[0, 10], [DAY, 10]]);
    const out = simulateFlowsInto(
      [{ t: 0, amount: 100 }, { t: DAY, amount: -500 }],
      prices,
      [0, DAY],
    );
    expect(out[1]!.value).toBe(0);
  });

  it("carries the last price across bars with no quote", () => {
    const prices = new Map([[0, 10], [2 * DAY, 30]]);
    const out = simulateFlowsInto([{ t: 0, amount: 100 }], prices, [0, DAY, 2 * DAY]);
    expect(out.map((p) => p.value)).toEqual([100, 100, 300]);
  });
});
