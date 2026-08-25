import { describe, it, expect } from "vitest";
import {
  currencyEffect, currencyShare, portfolioCurrencyEffect,
} from "./attribution";

describe("currencyEffect", () => {
  it("splits a gain into what the asset did and what the rate did", () => {
    // $1,000 of stock bought when a dollar was €0.80, so €800.
    // It is $1,500 today, and a dollar is €0.90: €1,350.
    // Held at 0.80 it would be €1,200 — so €400 is the asset and €150 the rate.
    const e = currencyEffect({ value: 1350, costDisplay: 800, costUsd: 1000 }, 0.9)!;
    expect(e.asset).toBeCloseTo(400, 10);
    expect(e.currency).toBeCloseTo(150, 10);
    expect(e.acquiredRate).toBeCloseTo(0.8, 10);
  });

  it("always adds back up to the gain the app already shows", () => {
    const e = currencyEffect({ value: 1350, costDisplay: 800, costUsd: 1000 }, 0.9)!;
    expect(e.total).toBeCloseTo(1350 - 800, 10);
  });

  it("charges the currency, not the asset, when only the rate moved", () => {
    // Same dollars, same price, a weaker dollar. None of this is the asset's.
    const e = currencyEffect({ value: 900, costDisplay: 1000, costUsd: 1250 }, 0.72)!;
    expect(e.asset).toBeCloseTo(0, 8);
    expect(e.currency).toBeCloseTo(-100, 8);
  });

  it("charges the asset, not the currency, when only the price moved", () => {
    const e = currencyEffect({ value: 1600, costDisplay: 800, costUsd: 1000 }, 0.8)!;
    expect(e.currency).toBeCloseTo(0, 10);
    expect(e.asset).toBeCloseTo(800, 10);
  });

  it("can show a loss the asset made and the currency covered", () => {
    // The asset fell 20% in dollars; the dollar rose enough to hide it.
    const e = currencyEffect({ value: 800, costDisplay: 800, costUsd: 1000 }, 1.0)!;
    expect(e.asset).toBeCloseTo(-160, 10);
    expect(e.currency).toBeCloseTo(160, 10);
    expect(e.total).toBeCloseTo(0, 10);
  });

  it("says nothing rather than guessing when the inputs cannot carry it", () => {
    const ok = { value: 100, costDisplay: 80, costUsd: 100 };
    expect(currencyEffect({ ...ok, value: null }, 0.8)).toBeNull();
    expect(currencyEffect({ ...ok, costUsd: 0 }, 0.8)).toBeNull();
    expect(currencyEffect({ ...ok, costDisplay: 0 }, 0.8)).toBeNull();
    // 0 is what displayContext reports when the rate feed was unreachable.
    expect(currencyEffect(ok, 0)).toBeNull();
  });
});

describe("portfolioCurrencyEffect", () => {
  it("sums exactly the rows a screen can draw beside it", () => {
    const a = { value: 1350, costDisplay: 800, costUsd: 1000 };
    const b = { value: 450, costDisplay: 400, costUsd: 500 };
    const total = portfolioCurrencyEffect([a, b], 0.9)!;
    const parts = [a, b].map((x) => currencyEffect(x, 0.9)!);
    expect(total.asset).toBeCloseTo(parts[0]!.asset + parts[1]!.asset, 10);
    expect(total.currency).toBeCloseTo(parts[0]!.currency + parts[1]!.currency, 10);
    expect(total.covered).toBe(2);
  });

  it("weights the acquisition rate by what each position is worth now", () => {
    // One position acquired at 0.80, one at 1.00. The dollars behind them
    // today are $1,000 and $1,111, so the average is 0.9053 — not the 0.90
    // that weighting by cost would give. The currency effect lands on today's
    // value, so the rate quoted beside it is weighted by today's value.
    const total = portfolioCurrencyEffect([
      { value: 900, costDisplay: 800, costUsd: 1000 },
      { value: 1000, costDisplay: 1000, costUsd: 1000 },
    ], 0.9)!;
    expect(total.acquiredRate).toBeCloseTo((1000 * 0.8 + (1000 / 0.9) * 1.0) / (1000 + 1000 / 0.9), 10);
    expect(total.costDisplay / total.costUsd).toBeCloseTo(0.9, 10);
  });

  it("skips what it cannot attribute rather than dropping the total", () => {
    const total = portfolioCurrencyEffect([
      { value: 1350, costDisplay: 800, costUsd: 1000 },
      { value: null, costDisplay: 400, costUsd: 500 },
    ], 0.9)!;
    expect(total.covered).toBe(1);
    expect(total.asset).toBeCloseTo(400, 10);
  });

  it("is null when nothing qualifies", () => {
    expect(portfolioCurrencyEffect([], 0.9)).toBeNull();
    expect(portfolioCurrencyEffect([{ value: null, costDisplay: 1, costUsd: 1 }], 0.9)).toBeNull();
  });
});

describe("currencyShare", () => {
  it("says what fraction of the gain the currency was", () => {
    const e = currencyEffect({ value: 1350, costDisplay: 800, costUsd: 1000 }, 0.9)!;
    expect(currencyShare(e, 800)).toBeCloseTo((150 / 550) * 100, 10);
  });

  it("refuses a share of a gain that is essentially zero", () => {
    // asset and currency very nearly cancel: the ratio explodes and means
    // nothing. "The currency was 4,200% of your return" is true and useless.
    const e = currencyEffect({ value: 800, costDisplay: 800, costUsd: 1000 }, 1.0)!;
    expect(currencyShare(e, 800)).toBeNull();
  });
});

describe("the portfolio's rate explains the portfolio's currency effect", () => {
  it("reproduces the summed currency figure from the stated rate", () => {
    // The property the sentence on screen depends on. A cost-weighted average
    // does not have it: the currency effect applies to today's value, so the
    // rate quoted beside it has to be weighted the same way.
    const inputs = [
      { value: 1350, costDisplay: 800, costUsd: 1000 },   // acquired at 0.80
      { value: 2000, costDisplay: 1000, costUsd: 1000 },  // acquired at 1.00
      { value: 300, costDisplay: 400, costUsd: 500 },     // acquired at 0.80
    ];
    const rate = 0.9;
    const t = portfolioCurrencyEffect(inputs, rate)!;
    const value = inputs.reduce((a, i) => a + i.value!, 0);
    expect(value * (1 - t.acquiredRate / rate)).toBeCloseTo(t.currency, 8);
  });

  it("differs from the cost-weighted average, which is the point", () => {
    const inputs = [
      { value: 4000, costDisplay: 800, costUsd: 1000 },   // small cost, large value
      { value: 100, costDisplay: 2000, costUsd: 2000 },   // large cost, small value
    ];
    const t = portfolioCurrencyEffect(inputs, 0.9)!;
    expect(t.acquiredRate).not.toBeCloseTo(t.costDisplay / t.costUsd, 3);
  });
});
