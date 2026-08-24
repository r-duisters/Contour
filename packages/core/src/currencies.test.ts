import { describe, expect, it } from "vitest";
import { FIAT, STABLES, needsRate } from "./currencies";

describe("needsRate", () => {
  it("is false for USD and for the stables that track it", () => {
    // A USDT price is already a USD price; asking Binance for USDTUSDT would
    // fetch a market that does not exist to learn something already known.
    for (const c of ["USD", "USDT", "USDC", "FDUSD", "BUSD", "TUSD", "DAI"]) {
      expect(needsRate(c)).toBe(false);
    }
  });

  it("is true for a fiat currency and for a coin quote", () => {
    for (const c of ["EUR", "GBP", "CHF", "BTC", "ETH", "BNB"]) {
      expect(needsRate(c)).toBe(true);
    }
  });

  it("is case-insensitive, because a CSV column is not", () => {
    expect(needsRate("usdt")).toBe(false);
    expect(needsRate("eur")).toBe(true);
  });
});

describe("the sets themselves", () => {
  it("keeps every stable out of FIAT and vice versa", () => {
    // They answer different questions — "has an ECB rate" and "is already a
    // dollar" — and a currency in both would be looked up twice, differently.
    for (const c of STABLES) expect(FIAT.has(c)).toBe(false);
  });

  it("covers the currencies the ledger actually contains", () => {
    // From the live ledger, 2026-08-24. A currency here that is in neither set
    // silently prices at zero on import.
    for (const c of ["EUR", "USD", "USDT", "ETH", "BTC"]) {
      expect(needsRate(c) || STABLES.has(c) || c === "USD").toBe(true);
    }
  });
});
