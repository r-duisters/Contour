import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analyzePineScript, summarize } from "./analyze";

const SAMPLE = readFileSync(join(process.cwd(), "samples/risk-metric.pine"), "utf8");

describe("analyzePineScript", () => {
  const findings = analyzePineScript(SAMPLE);
  const ids = new Set(findings.map((f) => f.id));

  it("detects the dead take-profit / stop-loss inputs", () => {
    expect(ids.has("dead-input:takeProfitSelected")).toBe(true);
    expect(ids.has("dead-input:takeProfitPercent")).toBe(true);
    expect(ids.has("dead-input:stopLossSelected")).toBe(true);
    expect(ids.has("dead-input:stopLossPercent")).toBe(true);
    expect(ids.has("dead-input:takeProfitPrice")).toBe(true);
    expect(ids.has("dead-input:stopLossPrice")).toBe(true);
  });

  it("flags the negative-capital risk in compounding", () => {
    expect(ids.has("correctness:trading-capital-negative")).toBe(true);
  });

  it("flags the unlatched 95% sell tier", () => {
    expect(ids.has("robustness:unlatched-95-sell")).toBe(true);
  });

  it("flags sell qty derived from capital instead of position", () => {
    expect(ids.has("correctness:sell-qty-from-capital")).toBe(true);
  });

  it("flags the 180% potential over-allocation", () => {
    expect(ids.has("robustness:over-allocation")).toBe(true);
  });

  it("flags hard-coded time curves and lookback windows", () => {
    expect(ids.has("configurability:hardcoded-time-curves")).toBe(true);
    expect(ids.has("configurability:hardcoded-windows")).toBe(true);
  });

  it("flags the copy-paste log.info in the 95% block", () => {
    expect(ids.has("documentation:copy-paste-log")).toBe(true);
  });

  it("flags the request.security calls for repaint risk", () => {
    expect(findings.some((f) => f.id.startsWith("repaint:lookahead-"))).toBe(true);
  });

  it("flags missing BTC symbol guard", () => {
    expect(ids.has("robustness:no-symbol-guard")).toBe(true);
  });

  it("flags the 2030 endDate default", () => {
    expect(ids.has("robustness:end-date-stops-trading")).toBe(true);
  });

  it("each finding has a non-empty message and fix", () => {
    for (const f of findings) {
      expect(f.message.length).toBeGreaterThan(20);
      expect(f.fix && f.fix.length).toBeTruthy();
    }
  });

  it("summarize produces a counts string", () => {
    expect(summarize(findings)).toMatch(/\d+ finding/);
  });

  it("returns no findings on an empty source", () => {
    expect(analyzePineScript("")).toEqual([]);
  });
});
