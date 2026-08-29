import { describe, it, expect, afterEach } from "vitest";
import { axisMoney, money, priceFieldValue, setAmountsHidden, setDisplayCurrency } from "./display";

afterEach(() => { setAmountsHidden(false); setDisplayCurrency("USD"); });

describe("axisMoney", () => {
  it("compacts thousands and millions so the axis stays narrow", () => {
    setDisplayCurrency("EUR");
    expect(axisMoney(142_580.42)).toBe("€143k");
    expect(axisMoney(1_250_000)).toBe("€1.3M");
    expect(axisMoney(12_500_000)).toBe("€13M");
    expect(axisMoney(4_120.5)).toBe("€4.1k");
  });

  it("is far shorter than the full format it replaces", () => {
    setDisplayCurrency("EUR");
    expect(axisMoney(142_580.42).length).toBeLessThan(money(142_580.42).length / 2);
  });

  it("keeps small prices legible rather than rounding them away", () => {
    setDisplayCurrency("USD");
    expect(axisMoney(64.35)).toBe("$64.35");
    expect(axisMoney(0.00001234)).toBe("$0.000012");
  });

  it("signs negatives", () => {
    setDisplayCurrency("EUR");
    expect(axisMoney(-8_755)).toBe("-€8.8k");
  });

  it("never leaks an amount while privacy mode is on", () => {
    setDisplayCurrency("EUR");
    setAmountsHidden(true);
    expect(axisMoney(142_580.42)).not.toMatch(/\d/);
  });
});

describe("money", () => {
  it("puts the symbol in front, whichever currency", () => {
    setDisplayCurrency("EUR");
    expect(money(142_580.42)).toBe("€142.580,42");
    setDisplayCurrency("USD");
    expect(money(142_580.42)).toBe("$142,580.42");
  });

  it("keeps the locale's grouping and decimal mark behind the symbol", () => {
    setDisplayCurrency("EUR");
    expect(money(1_234.5)).toBe("€1.234,50");
  });

  it("signs negatives ahead of the symbol", () => {
    setDisplayCurrency("EUR");
    expect(money(-8_755)).toBe("-€8.755,00");
  });

  it("masks under privacy mode", () => {
    setAmountsHidden(true);
    expect(money(1)).not.toMatch(/\d/);
  });
});

describe("money beyond the dollar and the euro", () => {
  afterEach(() => setDisplayCurrency("USD"));

  it("keeps the symbol in front, whatever the locale would do", () => {
    // de-DE writes "142.580,42 €". The symbol leads here so a column of
    // figures aligns on it — BRAND.md.
    setDisplayCurrency("EUR");
    expect(money(142580.42)).toBe("€142.580,42");
    setDisplayCurrency("USD");
    expect(money(142580.42)).toBe("$142,580.42");
  });

  it("groups and punctuates the way the currency's own country does", () => {
    setDisplayCurrency("INR");
    expect(money(142580.42)).toBe("₹1,42,580.42"); // lakh grouping, not thousands
    setDisplayCurrency("SEK");
    expect(money(142580.42)).toBe("kr 142 580,42");
  });

  it("spaces a word-symbol and closes up a sign", () => {
    // "kr142 580,42" is not how anything is written; "$142.58" is.
    setDisplayCurrency("CHF");
    expect(money(1)).toBe("CHF 1.00");
    setDisplayCurrency("GBP");
    expect(money(1)).toBe("£1.00");
  });

  it("gives a yen no decimals, because a yen has none", () => {
    setDisplayCurrency("JPY");
    expect(money(142580)).toBe("￥142,580");
  });

  it("still honours a caller that asks for more digits", () => {
    // A coin worth millionths needs them whatever the currency is.
    setDisplayCurrency("JPY");
    expect(money(0.000123, 8)).toBe("￥0.000123");
    setDisplayCurrency("EUR");
    expect(money(0.000123, 8)).toBe("€0,000123");
  });

  it("carries the sign outside the symbol", () => {
    setDisplayCurrency("SEK");
    expect(money(-5)).toBe("-kr 5,00");
  });
});

describe("priceFieldValue", () => {
  it("rounds a share-sized price to the two decimals its label shows", () => {
    // The live figure behind AMD's "Use 399.88". The button filled the box
    // with all of this, so it did not do what it said.
    expect(priceFieldValue(399.8797560766)).toBe("399.88");
  });

  it("keeps eight decimals below a cent, where two would round to nothing", () => {
    expect(priceFieldValue(0.00000812)).toBe("0.00000812");
  });

  it("drops trailing zeros rather than typing them into the field", () => {
    // A person edits this value. "400" invites a keystroke; "400.00" invites
    // deleting two characters first.
    expect(priceFieldValue(400)).toBe("400");
    expect(priceFieldValue(1489.80004883)).toBe("1489.8");
  });

  it("never groups, whatever the display currency is", () => {
    // A form field is parsed, not read. "1.489,8" is a number to a European
    // reader and NaN to `Number`.
    setDisplayCurrency("EUR");
    expect(priceFieldValue(1489.80004883)).toBe("1489.8");
  });
});
