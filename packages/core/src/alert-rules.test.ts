import { describe, expect, it } from "vitest";
import { expandRules, shouldNotify, type AlertRule, type HeldAsset } from "./alert-rules";

const coin = (symbol: string): HeldAsset => ({ symbol, assetType: "crypto" });
const share = (symbol: string): HeldAsset => ({ symbol, assetType: "equity" });

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
      [coin("BTC"), coin("ETH")],
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
    expect(expandRules([rule({ portfolioId: "p", params: { threshold: 5 } })], [coin("EUR"), coin("BTC")])
      .map((r) => r.symbol)).toEqual(["BTCUSDT"]);
  });

  it("asks for a share by its plain ticker, never as a Binance pair", () => {
    // `ASML.ASUSDT` is not a market. Equities used to be dropped here for that
    // reason; they are priced by their own provider now, and the rule carries
    // which one applies.
    const rules = expandRules(
      [rule({ portfolioId: "p", params: { threshold: 5 } })],
      [share("ASML.AS"), coin("BTC")],
    );
    expect(rules.map((r) => [r.symbol, r.assetType])).toEqual([
      ["ASML.AS", "equity"],
      ["BTCUSDT", "crypto"],
    ]);
  });

  it("never infers the venue from the ticker, because AMD looks like a coin", () => {
    // The bug this replaced: the filter dropped anything containing a dot, so
    // every US listing passed it and AMD was priced as AMDUSDT — a market that
    // exists and answers with an unrelated token. Firing on the wrong number
    // is the failure nobody can see.
    const rules = expandRules(
      [rule({ portfolioId: "p", params: { threshold: 5 } })],
      [share("AMD")],
    );
    expect(rules.map((r) => [r.symbol, r.assetType])).toEqual([["AMD", "equity"]]);
  });

  it("takes a named rule's venue from the alert row, not from its symbol", () => {
    const rules = expandRules(
      [rule({ symbol: "NVDA", assetType: "equity", params: { threshold: 5 } })],
      [],
    );
    expect(rules.map((r) => [r.symbol, r.assetType])).toEqual([["NVDA", "equity"]]);
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
