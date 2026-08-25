import { describe, it, expect } from "vitest";
import { toDisplayTxs, toUsdTxs } from "./display-tx";
import { computeHoldings } from "./portfolio";

const DAY = 86_400_000;
const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

function row(over: Partial<Parameters<typeof toDisplayTxs>[0][number]> = {}) {
  return {
    symbol: "AAPL", side: "buy", quantity: 10, price: 100, fee: 0,
    nativeCurrency: null as string | null,
    nativePrice: null as number | null,
    nativeFee: null as number | null,
    time: day("2021-06-15"),
    ...over,
  };
}

/** USD->EUR was 0.82 when the trade happened and 0.86 today. */
const RATES = new Map<number, number>([
  [day("2021-06-15"), 0.82],
  [day("2026-08-24"), 0.86],
]);
const TODAY = 0.86;

describe("toDisplayTxs", () => {
  it("keeps what a trade settled in the display currency actually cost", () => {
    const [tx] = toDisplayTxs(
      [row({ nativeCurrency: "EUR", nativePrice: 84, nativeFee: 1 })],
      "EUR", TODAY, RATES,
    );
    expect(tx!.price).toBe(84);
    expect(tx!.fee).toBe(1);
  });

  it("converts a foreign trade at the rate on its own day, not today's", () => {
    // The bug this argument exists for: a 2021 dollar purchase reported at
    // today's rate has a cost basis that moves every morning.
    const [tx] = toDisplayTxs([row({ fee: 5 })], "EUR", TODAY, RATES);
    expect(tx!.price).toBeCloseTo(82, 10);
    expect(tx!.fee).toBeCloseTo(4.1, 10);
  });

  it("reads back to the last fixing when the trade fell on a weekend", () => {
    // ECB publishes on weekdays; rateOn looks back up to five days.
    const [tx] = toDisplayTxs(
      [row({ time: day("2021-06-15") + 2 * DAY })], "EUR", TODAY, RATES,
    );
    expect(tx!.price).toBeCloseTo(82, 10);
  });

  it("falls back to the current rate when no dated rate reaches back far enough", () => {
    const [tx] = toDisplayTxs(
      [row({ time: day("2015-01-05") })], "EUR", TODAY, RATES,
    );
    expect(tx!.price).toBeCloseTo(86, 10);
  });

  it("converts everything at the current rate when there is no rate history", () => {
    // Null is both "displaying dollars" and "the feed was unreachable".
    const [tx] = toDisplayTxs([row()], "EUR", TODAY, null);
    expect(tx!.price).toBeCloseTo(86, 10);
  });

  it("leaves a cost basis unmoved when only today's rate changes", () => {
    // The property the whole change is for. Same ledger, a different rate
    // today, and what the position cost is the same number.
    const rows = [row(), row({ time: day("2021-06-16"), price: 120 })];
    const at = (todayRate: number) =>
      computeHoldings(toDisplayTxs(rows, "EUR", todayRate, RATES))[0]!.costBasis;
    expect(at(0.86)).toBeCloseTo(at(1.02), 10);
  });
});

describe("toUsdTxs", () => {
  it("hands back the stored figures untouched, whatever the native currency", () => {
    const [tx] = toUsdTxs([row({ nativeCurrency: "EUR", nativePrice: 84, nativeFee: 1, fee: 2 })]);
    expect(tx!.price).toBe(100);
    expect(tx!.fee).toBe(2);
  });

  it("pairs with toDisplayTxs to give the rate a position was acquired at", () => {
    // costDisplay / costUsd is the average rate the position was bought at —
    // the denominator currency attribution needs.
    const rows = [row(), row({ time: day("2021-06-16"), price: 120 })];
    const usd = computeHoldings(toUsdTxs(rows))[0]!.costBasis;
    const eur = computeHoldings(toDisplayTxs(rows, "EUR", TODAY, RATES))[0]!.costBasis;
    expect(eur / usd).toBeCloseTo(0.82, 10);
  });
});
