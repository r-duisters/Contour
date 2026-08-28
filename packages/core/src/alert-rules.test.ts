import { describe, expect, it } from "vitest";
import { expandRules, shouldNotify, type AlertRule } from "./alert-rules";

const rule = (over: Partial<AlertRule>): AlertRule => ({
  id: "a", kind: "pct_move", symbol: null, portfolioId: null, params: {}, ...over,
});

describe("expandRules", () => {
  it("expands a portfolio-scoped rule into one check per held symbol", () => {
    // Today this rule is silently dropped: BackgroundAlerts filters on
    // `a.symbol &&`, and a portfolio-scoped alert has symbol null. It has
    // never fired for anyone.
    const rules = expandRules(
      [rule({ id: "a", portfolioId: "p", params: { threshold: 5 } })],
      ["BTC", "ETH"],
    );
    expect(rules.map((r) => r.symbol)).toEqual(["BTCUSDT", "ETHUSDT"]);
    expect(rules.every((r) => r.id.startsWith("a:"))).toBe(true);
  });

  it("leaves indicator rules out — they need 1,460 bars of warm-up", () => {
    expect(expandRules([rule({ id: "i", kind: "indicator", symbol: "BTCUSDT" })], [])).toEqual([]);
  });

  it("prices a coin by its pair, never by the bare asset", () => {
    // The rename made a stored symbol an asset; Binance still wants the pair.
    expect(
      expandRules(
        [rule({ id: "t", kind: "price_target", symbol: "ETH", params: { direction: "above", price: 1 } })],
        [],
      ).map((r) => r.symbol),
    ).toEqual(["ETHUSDT"]);
  });

  it("keeps cash out of a portfolio-wide rule, so the euro is not a holding", () => {
    // A EUR balance is a positive quantity under the symbol EUR, and
    // `pricingPair` turns that into EURUSDT — a real Binance market. Without
    // this filter a portfolio-wide swing rule pages its owner about the euro.
    expect(expandRules([rule({ portfolioId: "p", params: { threshold: 5 } })], ["EUR", "BTC"])
      .map((r) => r.symbol)).toEqual(["BTCUSDT"]);
  });

  it("keeps equities out, rather than asking Binance for ASML.ASUSDT", () => {
    expect(expandRules([rule({ portfolioId: "p", params: { threshold: 5 } })], ["ASML.AS", "BTC"])
      .map((r) => r.symbol)).toEqual(["BTCUSDT"]);
  });

  it("drops a disabled rule", () => {
    expect(expandRules([rule({ symbol: "BTC", enabled: false, params: { threshold: 5 } })], [])).toEqual([]);
  });

  it("carries the asset through as the name, so a notification says BTC not BTCUSDT", () => {
    expect(expandRules([rule({ symbol: "BTCUSDT", params: { threshold: 5 } })], [])[0]!.name).toBe("BTC");
  });

  it("drops a rule whose params do not parse, rather than firing on undefined", () => {
    expect(expandRules([rule({ kind: "price_target", symbol: "BTC", params: {} })], [])).toEqual([]);
    expect(expandRules([rule({ symbol: "BTC", params: { threshold: -1 } })], [])).toEqual([]);
  });
});

describe("shouldNotify", () => {
  it("notifies once per rule per UTC day, so a standing condition stays quiet", () => {
    const sent: Record<string, number> = {};
    expect(shouldNotify(sent, "m:a:up", 20_000)).toBe(true);
    sent["m:a:up"] = 20_000;
    expect(shouldNotify(sent, "m:a:up", 20_000)).toBe(false);
    expect(shouldNotify(sent, "m:a:up", 20_001)).toBe(true);
  });

  it("separates the directions, so a fall after a rise still notifies", () => {
    const sent = { "m:a:up": 20_000 };
    expect(shouldNotify(sent, "m:a:down", 20_000)).toBe(true);
  });
});
