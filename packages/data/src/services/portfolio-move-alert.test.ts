import { describe, expect, it } from "vitest";
import { MemoryStore } from "../testing/memory-store";
import { expandRules, type AlertRule, type HeldAsset } from "@/core/alert-rules";

/**
 * The rule the setup flow's "tell me about big moves" switch creates, end to
 * end through the port and the expander.
 *
 * It is one row that names a portfolio and no symbol, and everything about it
 * that could go wrong is a shape mismatch between the two: a store that cannot
 * hold a null symbol, a summary that drops the portfolio id, an expander that
 * sends a share to Binance. Each of those failed silently in the version this
 * replaces — the alert saved, listed, and never fired.
 */
describe("the portfolio-wide move rule", () => {
  it("stores with no symbol and a portfolio, which is the shape that means everything", async () => {
    const store = MemoryStore();
    const p = await store.portfolios.create("Main");
    const alert = await store.alerts.create({
      kind: "pct_move",
      portfolioId: p.id,
      assetType: "crypto",
      threshold: 5,
      direction: null,
    });
    expect(alert.symbol).toBe(null);
    expect(alert.portfolioId).toBe(p.id);

    // And reads back that way. A store that normalised the missing symbol to
    // "" would turn "every holding" into a holding called nothing.
    const [read] = await store.alerts.list();
    expect(read!.symbol).toBe(null);
    expect(read!.portfolioId).toBe(p.id);
  });

  it("becomes one check per holding, priced at the venue that lists each", () => {
    const rule: AlertRule = {
      id: "r", kind: "pct_move", symbol: null, portfolioId: "p",
      params: { threshold: 5 },
    };
    const held: HeldAsset[] = [
      { symbol: "BTC", assetType: "crypto" },
      { symbol: "AMD", assetType: "equity" },
      { symbol: "ASML.AS", assetType: "equity" },
      { symbol: "EUR", assetType: "crypto" },
    ];
    expect(expandRules([rule], held).map((r) => [r.symbol, r.assetType, r.threshold])).toEqual([
      ["BTCUSDT", "crypto", 5],
      // Not AMDUSDT. That market exists and would have answered with an
      // unrelated token's price, which is the failure nobody can see.
      ["AMD", "equity", 5],
      ["ASML.AS", "equity", 5],
      // The euro balance is not a position anyone took.
    ]);
  });

  it("covers what is bought after it is written", () => {
    // The reason the rule stores a portfolio rather than a list of symbols.
    const rule: AlertRule = {
      id: "r", kind: "pct_move", symbol: null, portfolioId: "p",
      params: { threshold: 5 },
    };
    const later = expandRules([rule], [
      { symbol: "BTC", assetType: "crypto" },
      { symbol: "SOL", assetType: "crypto" },
    ]);
    expect(later.map((r) => r.name)).toEqual(["BTC", "SOL"]);
  });

  it("gives each holding its own dedupe id, so one firing does not silence the rest", () => {
    const rule: AlertRule = {
      id: "r", kind: "pct_move", symbol: null, portfolioId: "p",
      params: { threshold: 5 },
    };
    const ids = expandRules([rule], [
      { symbol: "BTC", assetType: "crypto" },
      { symbol: "ETH", assetType: "crypto" },
    ]).map((r) => r.id);
    expect(new Set(ids).size).toBe(2);
  });
});
