/**
 * Heuristic linter for the "Risk Metric Strategy" PineScript (and similar v5 strategies).
 *
 * Each rule is a pure function over (source, lines) that returns zero or more findings.
 * Rules are intentionally regex/string-based — building a real Pine parser is out of scope.
 * Prefer false positives that the reader can dismiss over silent gaps.
 */

export type Severity = "warning" | "info" | "suggestion";

export type Finding = {
  id: string;
  severity: Severity;
  category:
    | "dead-code"
    | "repaint"
    | "correctness"
    | "robustness"
    | "configurability"
    | "documentation";
  line?: number; // 1-based; omitted for whole-file findings
  excerpt?: string;
  message: string;
  /** A concrete code-level suggestion the reader can paste in. */
  fix?: string;
};

type Rule = (source: string, lines: string[]) => Finding[];

function findLine(lines: string[], pattern: RegExp): { line: number; excerpt: string } | null {
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i]!)) return { line: i + 1, excerpt: lines[i]!.trim() };
  }
  return null;
}

function findAllLines(lines: string[], pattern: RegExp): { line: number; excerpt: string }[] {
  const out: { line: number; excerpt: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i]!)) out.push({ line: i + 1, excerpt: lines[i]!.trim() });
  }
  return out;
}

const RULES: Rule[] = [
  // Dead inputs — declared but never referenced anywhere else in the script.
  (src, lines) => {
    const findings: Finding[] = [];
    const candidates = ["takeProfitSelected", "takeProfitPercent", "stopLossSelected", "stopLossPercent", "takeProfitPrice", "stopLossPrice"];
    for (const name of candidates) {
      const decl = findLine(lines, new RegExp(`\\b${name}\\s*=`));
      if (!decl) continue;
      const refs = (src.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length;
      if (refs <= 1) {
        findings.push({
          id: `dead-input:${name}`,
          severity: "warning",
          category: "dead-code",
          line: decl.line,
          excerpt: decl.excerpt,
          message: `Input \`${name}\` is declared but never used. The UI exposes it as a knob the user can turn, but turning it has no effect.`,
          fix: `Either remove the input, or wire it into the entry/exit logic — e.g. \`strategy.exit("TP/SL", from_entry="Buy", profit=takeProfitPrice, loss=stopLossPrice)\` inside each buy block.`,
        });
      }
    }
    return findings;
  },

  // request.security without lookahead=barmerge.lookahead_off → potential repaint.
  (_src, lines) => {
    const hits = findAllLines(lines, /request\.security\s*\(/);
    return hits
      .filter((h) => !/lookahead\s*=/.test(h.excerpt))
      .map((h) => ({
        id: `repaint:lookahead-${h.line}`,
        severity: "warning" as Severity,
        category: "repaint" as const,
        line: h.line,
        excerpt: h.excerpt,
        message: `\`request.security\` defaults to \`lookahead=barmerge.lookahead_off\` in v5, but on a daily script reading "W" data this can still repaint mid-week. Be explicit, and consider passing only \`close[1]\` of the HTF to avoid lookahead bias.`,
        fix: `request.security(syminfo.tickerid, "W", ta.sma(close, 20)[1], lookahead=barmerge.lookahead_off)`,
      }));
  },

  // The compounding branch lets tradingCapital go negative if netprofit drops below -initial_capital.
  (_src, lines) => {
    const hit = findLine(lines, /tradingCapital\s*:=\s*strategy\.initial_capital\s*\+\s*strategy\.netprofit/);
    if (!hit) return [];
    return [{
      id: "correctness:trading-capital-negative",
      severity: "warning",
      category: "correctness",
      line: hit.line,
      excerpt: hit.excerpt,
      message: `\`tradingCapital\` can go ≤ 0 when \`strategy.netprofit\` < -initial_capital (a deep drawdown). Subsequent buys then size to zero or compute negative qty.`,
      fix: `tradingCapital := math.max(strategy.initial_capital + strategy.netprofit, strategy.initial_capital * 0.01)`,
    }];
  },

  // The >0.95 sell tier has no latch — it fires every bar and floods the order log.
  (_src, lines) => {
    const block = findLine(lines, /closeCondition95\s+and\s+inTradeWindow/);
    if (!block) return [];
    return [{
      id: "robustness:unlatched-95-sell",
      severity: "warning",
      category: "robustness",
      line: block.line,
      excerpt: block.excerpt,
      message: `The >0.95 sell tier has no latch (unlike >0.80 and >0.90). At euphoric peaks it can fire dozens of consecutive sells until the position drains, producing a flurry of identical orders.`,
      fix: `Either gate it on \`riskMetric > 0.95 and not sold95\` with a \`sold95\` latch reset by any buy, or rate-limit with \`barssince(closeCondition95[1]) >= 7\` so it fires at most weekly.`,
    }];
  },

  // Sell qty is computed from capital, not from current position.
  (_src, lines) => {
    const hits = findAllLines(lines, /positionSize\s*:=\s*tradingCapital\s*\/\s*close\s*\*\s*0\.5/);
    if (hits.length === 0) return [];
    return [{
      id: "correctness:sell-qty-from-capital",
      severity: "warning",
      category: "correctness",
      line: hits[0]!.line,
      excerpt: hits[0]!.excerpt,
      message: `Sell quantity is computed from \`tradingCapital / close * 0.5\`, not from the currently held position. After several scale-outs, this can request more units than \`strategy.position_size\` holds (Pine silently clips, but the intent is unclear).`,
      fix: `positionSize := strategy.position_size * 0.5  // sell 50% of what we actually hold`,
    }];
  },

  // 80%+40%+30%+30% = 180% of capital across the four buy latches.
  (_src, lines) => {
    const hit = findLine(lines, /default_qty_value\s*=\s*20/);
    if (!hit) return [];
    return [{
      id: "robustness:over-allocation",
      severity: "warning",
      category: "robustness",
      line: hit.line,
      excerpt: hit.excerpt,
      message: `If risk drops fast enough to fire all four buy tiers (30/25/20/10) in sequence without a reset, total allocation is 30+30+40+80 = 180% of capital. With \`pyramiding=5\` Pine will permit this, but it implies margin/leverage that wasn't intended.`,
      fix: `Cap total exposure: skip a buy when \`(strategy.position_size * close) / tradingCapital >= 1\` (no buying with leverage).`,
    }];
  },

  // Hard-coded magic numbers — the script comments them as "Dubious indeed".
  (_src, lines) => {
    const hits = findAllLines(lines, /math\.log\s*\(\s*time\s*\)/);
    if (hits.length === 0) return [];
    return [{
      id: "configurability:hardcoded-time-curves",
      severity: "info",
      category: "configurability",
      line: hits[0]!.line,
      excerpt: hits[0]!.excerpt,
      message: `The "max/min risk" curves are linear in \`ln(time)\` with constants baked in from a specific calibration window. As BTC ages, these drift and the normalised metric loses its [0,1] property. The author already flagged this as "Dubious indeed".`,
      fix: `Either (a) expose the curve constants as inputs so they can be re-calibrated without editing the script, or (b) replace the hard-coded ceilings with rolling percentile rank (e.g. \`ta.percentrank(raw, 1460)\`) for a self-normalising metric.`,
    }];
  },

  // 1460 / 50 / 20 — none are inputs.
  (_src, lines) => {
    const hit = findLine(lines, /ta\.sma\s*\(\s*close\s*,\s*1460\s*\)/);
    if (!hit) return [];
    return [{
      id: "configurability:hardcoded-windows",
      severity: "info",
      category: "configurability",
      line: hit.line,
      excerpt: hit.excerpt,
      message: `Lookback windows (1460, 50, 20) are hard-coded. Promoting them to \`input.int\` lets users tune the metric for assets other than BTC, and makes the warm-up requirement visible in the UI.`,
      fix: `len4y = input.int(1460, "4-year SMA window", group="Metric 1")  // then ta.sma(close, len4y)`,
    }];
  },

  // request.security on the same timeframe as the chart is redundant and obscures the data flow.
  (_src, lines) => {
    const hit = findLine(lines, /request\.security\s*\(\s*syminfo\.tickerid\s*,\s*'D'\s*,\s*close\s*\)/);
    if (!hit) return [];
    return [{
      id: "robustness:redundant-d-fetch",
      severity: "info",
      category: "robustness",
      line: hit.line,
      excerpt: hit.excerpt,
      message: `\`request.security(..., 'D', close)\` is a no-op when the chart is on the daily timeframe (which the strategy expects). It's also a footgun on other timeframes: the script implicitly assumes daily and silently does the wrong thing on, say, a 1h chart.`,
      fix: `Use \`close\` directly when on daily; or add a guard: \`if timeframe.period != "D"\` → \`runtime.error("Run this strategy on a daily chart")\`.`,
    }];
  },

  // No symbol guard — but the metric is calibrated for BTC.
  (src) => {
    // Only fire when this actually looks like the Risk Metric strategy.
    if (!/riskMetric|riskOne|riskTwo|riskThree/.test(src)) return [];
    if (/syminfo\.ticker\s*==\s*["']BTC/.test(src) || /runtime\.error/.test(src)) return [];
    return [{
      id: "robustness:no-symbol-guard",
      severity: "info",
      category: "robustness",
      message: `The metric's hard-coded normalisers are calibrated for Bitcoin. Running the strategy on another ticker produces meaningless [0,1] readings but Pine won't warn you.`,
      fix: `Add at the top: \`if not str.contains(syminfo.ticker, "BTC")\` → \`runtime.error("Risk Metric is calibrated for BTC only")\`.`,
    }];
  },

  // endDate default in the year 2030 — strategy silently stops trading after that.
  (_src, lines) => {
    const hit = findLine(lines, /timestamp\s*\(\s*"1 Jan 2030/);
    if (!hit) return [];
    return [{
      id: "robustness:end-date-stops-trading",
      severity: "info",
      category: "robustness",
      line: hit.line,
      excerpt: hit.excerpt,
      message: `\`endDate\` defaults to 1 Jan 2030. After that, \`inTradeWindow\` becomes false and the strategy silently stops placing orders — easy to miss in live trading.`,
      fix: `Default to a far-future timestamp (\`timestamp("1 Jan 2100 00:00:00")\`) or drop the end gate entirely for live use.`,
    }];
  },

  // log.info("Closing position - 90% risk - ...") in the 95% block — copy-paste bug, not actionable but worth flagging.
  (_src, lines) => {
    const candidates = lines
      .map((l, i) => ({ l: l.trim(), i }))
      .filter((x) => /log\.info\(.*90% risk/.test(x.l));
    // Two log.info("...90% risk...") — one in the 90% block (correct), one in the 95% block (copy-paste bug).
    if (candidates.length < 2) return [];
    return [{
      id: "documentation:copy-paste-log",
      severity: "suggestion",
      category: "documentation",
      line: candidates[1]!.i + 1,
      excerpt: candidates[1]!.l,
      message: `This \`log.info\` says "90% risk" but lives inside the \`closeCondition95\` branch — a copy-paste artefact that will confuse anyone tailing the log.`,
      fix: `log.info("Closing position - 95% risk - {0}", positionSize)`,
    }];
  },

  // strategy() declaration uses overlay=false but the chart wants candles overlaid. Document it.
  (_src, lines) => {
    const hit = findLine(lines, /^strategy\s*\(/);
    if (!hit) return [];
    return [{
      id: "documentation:overlay-false",
      severity: "suggestion",
      category: "documentation",
      line: hit.line,
      excerpt: hit.excerpt.length > 100 ? hit.excerpt.slice(0, 97) + "…" : hit.excerpt,
      message: `\`overlay=false\` is correct (the risk metric is plotted in its own pane), but the strategy doesn't plot price anywhere. On TradingView this means the user sees signals on the risk pane but no candles — they have to add a separate candle layer. Document this in the title or use a companion indicator.`,
      fix: `// In the script header: comment "Apply on a Bitcoin daily chart; the candle pane will show buy/sell labels via strategy.entry comments."`,
    }];
  },
];

export function analyzePineScript(source: string): Finding[] {
  const lines = source.split(/\r?\n/);
  const out: Finding[] = [];
  for (const rule of RULES) {
    try {
      out.push(...rule(source, lines));
    } catch {
      // A buggy rule shouldn't take the whole analyzer down.
    }
  }
  // Stable order: by category, then severity (warning > info > suggestion), then line.
  const sevRank: Record<Severity, number> = { warning: 0, info: 1, suggestion: 2 };
  return out.sort((a, b) =>
    a.category.localeCompare(b.category) ||
    sevRank[a.severity] - sevRank[b.severity] ||
    (a.line ?? 0) - (b.line ?? 0),
  );
}

export function summarize(findings: Finding[]): string {
  if (findings.length === 0) return "No issues detected.";
  const counts = findings.reduce<Record<Severity, number>>(
    (acc, f) => ({ ...acc, [f.severity]: (acc[f.severity] ?? 0) + 1 }),
    { warning: 0, info: 0, suggestion: 0 },
  );
  return `${findings.length} finding(s): ${counts.warning} warning, ${counts.info} info, ${counts.suggestion} suggestion.`;
}
