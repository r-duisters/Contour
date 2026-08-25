import { describe, expect, it } from "vitest";
import {
  CURRENCY_NAMES, DISPLAY_CURRENCIES, FIAT, STABLES, asDisplayCurrency, isFiat, needsRate,
} from "./currencies";

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

describe("isFiat", () => {
  it("includes USD, which FIAT itself cannot", () => {
    // FIAT is the ECB's quote list, and the ECB does not quote USD against
    // USD. Every caller asking "is this real money" needs USD in the answer.
    expect(FIAT.has("USD")).toBe(false);
    expect(isFiat("USD")).toBe(true);
  });

  it("covers the currencies the ledger audits", () => {
    for (const c of ["EUR", "USD", "GBP", "CHF"]) expect(isFiat(c)).toBe(true);
  });

  it("excludes coins and stables that are not currencies", () => {
    for (const c of ["BTC", "ETH", "USDT", "USDC"]) expect(isFiat(c)).toBe(false);
  });
});

describe("display currencies", () => {
  it("offers every currency the ECB rate feed can price", () => {
    // The list is hard-coded rather than fetched (see the note on
    // DISPLAY_CURRENCIES). This pins its size so a hand-edit that drops one
    // is a failing test rather than a currency that quietly stops appearing.
    expect(DISPLAY_CURRENCIES).toHaveLength(30);
    expect(DISPLAY_CURRENCIES).toContain("USD");
    expect(DISPLAY_CURRENCIES).toContain("EUR");
    expect(DISPLAY_CURRENCIES).toContain("JPY");
  });

  it("names every one of them, because a code is not an answer", () => {
    for (const c of DISPLAY_CURRENCIES) {
      expect(CURRENCY_NAMES[c]).toBeTruthy();
    }
  });

  it("keeps FIAT as the display list minus the dollar it is quoted against", () => {
    expect(FIAT.size).toBe(DISPLAY_CURRENCIES.length - 1);
    expect(FIAT.has("USD")).toBe(false);
    for (const c of DISPLAY_CURRENCIES) {
      if (c !== "USD") expect(FIAT.has(c)).toBe(true);
    }
  });

  it("accepts a stored code in any case", () => {
    expect(asDisplayCurrency("eur")).toBe("EUR");
    expect(asDisplayCurrency("SEK")).toBe("SEK");
  });

  it("falls back to the dollar rather than trusting an unknown code", () => {
    // The column is a plain string, so a hand-edited row can hold anything.
    expect(asDisplayCurrency("XYZ")).toBe("USD");
    expect(asDisplayCurrency("")).toBe("USD");
    expect(asDisplayCurrency(null)).toBe("USD");
    expect(asDisplayCurrency(undefined)).toBe("USD");
  });
});
