import { describe, expect, it } from "vitest";
import { alertCondition, alertSubject, type AlertWords } from "./alert-wording";

const a = (over: Partial<AlertWords>): AlertWords => ({
  kind: "price_target", symbol: "ETH", params: {}, repeat: true, ...over,
});

describe("alert wording", () => {
  /**
   * The bug this file exists for: a two-way branch on `price_target` sent the
   * three other kinds down the percentage line, where they read
   * "Moves ±undefined% in a day" — the same sentence for a return target and
   * for a portfolio total.
   */
  it("says something different for every kind", () => {
    const lines = [
      a({ kind: "price_target", params: { direction: "below", price: 2000 } }),
      a({ kind: "pct_move", params: { threshold: 5 } }),
      a({ kind: "pct_move", symbol: null, params: { threshold: 5 } }),
      a({ kind: "portfolio_move", symbol: null, params: { threshold: 3 } }),
      a({ kind: "position_pnl", params: { direction: "down", pct: 20 } }),
      a({ kind: "indicator" }),
    ].map(alertCondition);
    expect(new Set(lines).size).toBe(lines.length);
    for (const line of lines) expect(line).not.toContain("undefined");
  });

  /**
   * The two portfolio rules share a subject line, so the condition is the only
   * place they can be told apart — which is the confusion that putting them
   * side by side exposes.
   */
  it("distinguishes the total from its members", () => {
    const total = alertCondition(a({ kind: "portfolio_move", symbol: null, params: { threshold: 3 } }));
    const each = alertCondition(a({ kind: "pct_move", symbol: null, params: { threshold: 3 } }));
    expect(total).toMatch(/total/i);
    expect(each).toMatch(/any one/i);
  });

  it("names the portfolio rather than leaving the subject blank", () => {
    expect(alertSubject(null, "My portfolio")).toBe("Everything in My portfolio");
    expect(alertSubject(null, null)).toBe("Everything you own");
    expect(alertSubject("ETH", "My portfolio")).toBe("ETH");
  });
});
