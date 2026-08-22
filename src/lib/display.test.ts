import { describe, it, expect, afterEach } from "vitest";
import { axisMoney, money, setAmountsHidden, setDisplayCurrency } from "./display";

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
