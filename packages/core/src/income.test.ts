import { describe, expect, it } from "vitest";
import { annotateTransactions, computeHoldings, portfolioValueSeries, type Tx } from "./portfolio";
import { flowsByYear, tradeStats } from "./insights";
import { flowsByBar } from "./performance";

/**
 * `income` is cash attributed to a security. Every function here is about
 * positions or invested money, and a dividend is neither — so each must leave
 * its answer exactly as it was.
 *
 * Written as a before/after pair rather than as absolute figures on purpose:
 * the assertion is "adding this row changed nothing", which is the property
 * that matters and which absolute expectations would let drift.
 */
const shares: Tx[] = [
  { symbol: "SHELL.AS", side: "buy", quantity: 100, price: 25, fee: 1, time: 1_700_000_000_000 },
];
const withDividend: Tx[] = [
  ...shares,
  { symbol: "SHELL.AS", side: "income", quantity: 120, price: 0, fee: 0, time: 1_700_100_000_000 },
];

describe("income leaves positions alone", () => {
  it("does not move quantity, cost basis or average cost", () => {
    expect(computeHoldings(withDividend)).toEqual(computeHoldings(shares));
  });

  it("does not appear as a disposal in the annotated ledger", () => {
    const rows = annotateTransactions(withDividend);
    const dividend = rows.find((r) => r.side === "income")!;
    expect(dividend.realized).toBeNull();
    expect(dividend.positionAfter).toBe(100);
    expect(dividend.avgCostAfter).toBeCloseTo(25.01, 6);
  });

  it("does not change the value series", () => {
    const candles = { "SHELL.AS": [{ t: 1_700_000_000_000, o: 25, h: 25, l: 25, c: 25, v: 0 }] };
    expect(portfolioValueSeries(withDividend, candles))
      .toEqual(portfolioValueSeries(shares, candles));
  });

  it("is not a transfer, and not invested money", () => {
    expect(tradeStats(withDividend).transfers).toBe(0);
    expect(flowsByYear(withDividend)).toEqual(flowsByYear(shares));
    expect([...flowsByBar(withDividend).entries()]).toEqual([...flowsByBar(shares).entries()]);
  });
});
