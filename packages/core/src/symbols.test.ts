import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { QUOTE_ASSETS, assetOf, pricingPair } from "./symbols";

describe("assetOf", () => {
  it("strips a known quote asset", () => {
    expect(assetOf("ETHUSDT")).toBe("ETH");
    expect(assetOf("IOTAETH")).toBe("IOTA");
  });

  it("leaves a bare asset alone, so it can run twice", () => {
    // The migration and the readers both call this; it must be idempotent or
    // a second pass would eat real characters.
    expect(assetOf("ETH")).toBe("ETH");
    expect(assetOf(assetOf("ETHUSDT"))).toBe("ETH");
  });

  it("leaves an equity ticker alone", () => {
    expect(assetOf("ASML.AS")).toBe("ASML.AS");
    expect(assetOf("AMD")).toBe("AMD");
  });

  it("does not eat a symbol that is only its own quote asset", () => {
    // USDT ends with USDT. Stripping would leave nothing.
    expect(assetOf("USDT")).toBe("USDT");
    expect(assetOf("ETH")).toBe("ETH");
  });

  it("is case-insensitive on input and upper on output", () => {
    expect(assetOf("ethusdt")).toBe("ETH");
  });
});

describe("pricingPair", () => {
  it("appends the quote Binance prices in", () => {
    expect(pricingPair("ETH")).toBe("ETHUSDT");
  });

  it("leaves a symbol that is already a pair alone", () => {
    // Callers hand it whatever the database holds, migrated or not.
    expect(pricingPair("ETHUSDT")).toBe("ETHUSDT");
  });

  it("does not double-suffix USDT itself", () => {
    // Tether is unpriceable either way — Binance has no USDT ticker — so this
    // only has to avoid inventing one. The holding reads "no price", as it
    // does today under USDTUSDT.
    expect(pricingPair("USDT")).toBe("USDT");
  });

  it("is nonsense on an equity, which is why callers must not hand it one", () => {
    // Documented rather than defended: the function cannot tell AMD from a
    // coin, and a guard here would hide the caller's bug instead of the
    // caller splitting equities off as valuation and series both do.
    expect(pricingPair("AMD")).toBe("AMDUSDT");
    expect(pricingPair("ASML.AS")).toBe("ASML.ASUSDT");
  });
});

it("agrees with CoinIcon's quote list, which predates this one", () => {
  // Two lists that must match, in packages that cannot import each other
  // (core must not depend on ui). Read the source rather than let them drift.
  const src = readFileSync("packages/ui/src/CoinIcon.tsx", "utf8");
  const found = src.match(/const QUOTE_ASSETS = \[([^\]]*)\]/);
  if (!found) throw new Error("CoinIcon no longer declares QUOTE_ASSETS");
  const theirs = [...found[1]!.matchAll(/"([A-Z]+)"/g)].map((m) => m[1]!);
  expect([...QUOTE_ASSETS].sort()).toEqual(theirs.sort());
});
