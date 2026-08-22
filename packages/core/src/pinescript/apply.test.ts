import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyAllFixable, applyImprovements } from "./apply";
import { analyzePineScript } from "./analyze";

const SAMPLE = readFileSync(join(process.cwd(), "samples/risk-metric.pine"), "utf8");

describe("applyImprovements — individual transforms", () => {
  it("removes dead inputs", () => {
    const out = applyImprovements(SAMPLE, [
      "dead-input:takeProfitSelected", "dead-input:takeProfitPercent",
      "dead-input:stopLossSelected", "dead-input:stopLossPercent",
      "dead-input:takeProfitPrice", "dead-input:stopLossPrice",
    ]);
    expect(out.applied).toHaveLength(6);
    expect(out.source).not.toMatch(/takeProfitSelected/);
    expect(out.source).not.toMatch(/stopLossPrice/);
  });

  it("clamps tradingCapital so it can't go negative", () => {
    const out = applyImprovements(SAMPLE, ["correctness:trading-capital-negative"]);
    expect(out.applied).toContain("correctness:trading-capital-negative");
    expect(out.source).toMatch(/math\.max\(strategy\.initial_capital\s*\+\s*strategy\.netprofit/);
  });

  it("switches sell qty to position-relative", () => {
    const out = applyImprovements(SAMPLE, ["correctness:sell-qty-from-capital"]);
    expect(out.source).toMatch(/strategy\.position_size \* 0\.5/);
    expect(out.source).not.toMatch(/positionSize := tradingCapital \/ close \* 0\.5/);
  });

  it("adds sold95 latch and gates the >0.95 branch", () => {
    const out = applyImprovements(SAMPLE, ["robustness:unlatched-95-sell"]);
    expect(out.source).toMatch(/var bool sold95 = false/);
    expect(out.source).toMatch(/closeCondition95 and not sold95 and inTradeWindow/);
    expect(out.source).toMatch(/sold95 := true/);
    expect(out.source).toMatch(/sold95 := false/);
  });

  it("fixes the copy-paste log message in the 95% block", () => {
    const out = applyImprovements(SAMPLE, ["documentation:copy-paste-log"]);
    expect(out.source.match(/Closing position - 90% risk/g)).toHaveLength(1);
    expect(out.source).toMatch(/Closing position - 95% risk/);
  });

  it("bumps the 2030 endDate to 2100", () => {
    const out = applyImprovements(SAMPLE, ["robustness:end-date-stops-trading"]);
    expect(out.source).toMatch(/timestamp\("1 Jan 2100 00:00:00"\)/);
  });

  it("inserts a BTC symbol guard right after strategy(...)", () => {
    const out = applyImprovements(SAMPLE, ["robustness:no-symbol-guard"]);
    expect(out.source).toMatch(/runtime\.error\("Risk Metric is calibrated for BTC only/);
    // Guard appears between strategy() and the first input.bool().
    const stratIdx = out.source.indexOf("strategy(");
    const guardIdx = out.source.indexOf("runtime.error");
    const firstInput = out.source.indexOf("input.bool");
    expect(stratIdx).toBeLessThan(guardIdx);
    expect(guardIdx).toBeLessThan(firstInput);
  });

  it("adds lookahead=barmerge.lookahead_off to every request.security", () => {
    const ids = analyzePineScript(SAMPLE).filter((f) => f.id.startsWith("repaint:lookahead-")).map((f) => f.id);
    const out = applyImprovements(SAMPLE, ids);
    const occurrences = (out.source.match(/lookahead=barmerge\.lookahead_off/g) ?? []).length;
    expect(occurrences).toBe(6); // six request.security calls in the original
  });

  it("reports skipped ids when no transformer exists", () => {
    const out = applyImprovements(SAMPLE, ["configurability:hardcoded-time-curves"]);
    expect(out.applied).toEqual([]);
    expect(out.skipped[0]?.reason).toMatch(/no automated fix/);
  });
});

describe("applyAllFixable", () => {
  it("reduces total findings on the sample", () => {
    const r = applyAllFixable(SAMPLE);
    expect(r.findingsAfter).toBeLessThan(r.findingsBefore);
    // None of the *automatable* findings should remain.
    const remaining = analyzePineScript(r.source);
    const remainingIds = new Set(remaining.map((f) => f.id));
    expect(remainingIds.has("correctness:trading-capital-negative")).toBe(false);
    expect(remainingIds.has("correctness:sell-qty-from-capital")).toBe(false);
    expect(remainingIds.has("robustness:unlatched-95-sell")).toBe(false);
    expect(remainingIds.has("robustness:no-symbol-guard")).toBe(false);
    expect(remainingIds.has("robustness:end-date-stops-trading")).toBe(false);
    expect(remainingIds.has("documentation:copy-paste-log")).toBe(false);
    // Lookahead findings disappear because every request.security now has the kwarg.
    expect([...remainingIds].some((id) => id.startsWith("repaint:lookahead-"))).toBe(false);
  });
});
