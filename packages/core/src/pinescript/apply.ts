/**
 * String-edit transformers that take a PineScript v5 source plus a set of finding IDs
 * and emit a new version with those fixes applied. Each transformer is best-effort:
 * if it can't safely make the change, it adds the id to `skipped` instead of mangling code.
 *
 * Why string edits and not a parser: we only have a handful of well-known patterns to
 * rewrite in this one script. A real parser would be the right tool for a 100-script
 * codemod; for this scope it's overkill.
 */

import { analyzePineScript } from "./analyze";

export type ApplyResult = {
  source: string;
  applied: string[];
  skipped: { id: string; reason: string }[];
};

type Transform = (src: string) => { src: string; ok: boolean; reason?: string };

const TRANSFORMS: Record<string, Transform> = {
  // Remove a dead input line entirely. id format: dead-input:<name>
  ...buildDeadInputTransforms(),

  "correctness:trading-capital-negative": (src) => {
    const target = /tradingCapital\s*:=\s*strategy\.initial_capital\s*\+\s*strategy\.netprofit/;
    if (!target.test(src)) return { src, ok: false, reason: "compounding line not found" };
    return {
      src: src.replace(target, "tradingCapital := math.max(strategy.initial_capital + strategy.netprofit, strategy.initial_capital * 0.01)"),
      ok: true,
    };
  },

  "correctness:sell-qty-from-capital": (src) => {
    // Replace every `positionSize := tradingCapital / close * 0.5` with `strategy.position_size * 0.5`.
    const pattern = /positionSize\s*:=\s*tradingCapital\s*\/\s*close\s*\*\s*0\.5/g;
    if (!pattern.test(src)) return { src, ok: false, reason: "sell sizing line not found" };
    return {
      src: src.replace(pattern, "positionSize := strategy.position_size * 0.5"),
      ok: true,
    };
  },

  "robustness:unlatched-95-sell": (src) => {
    if (!/closeCondition95/.test(src)) return { src, ok: false, reason: "no >0.95 branch found" };
    if (/var\s+bool\s+sold95\b/.test(src)) return { src, ok: false, reason: "sold95 already exists" };

    // Add `var bool sold95 = false` alongside the other sold latches.
    let out = src.replace(
      /(var\s+bool\s+sold90\s*=\s*false)/,
      "$1\nvar bool sold95 = false",
    );
    // Gate the closeCondition95 branch on `not sold95` and set the latch.
    out = out.replace(
      /if\s*\(\s*closeCondition95\s+and\s+inTradeWindow\s*\)/,
      "if ( closeCondition95 and not sold95 and inTradeWindow )",
    );
    // Set sold95 := true inside the block (after the strategy.close line in that branch).
    out = out.replace(
      /(strategy\.close\("Buy", qty = positionSize, comment="95% risk[^\n]*\n)/,
      "$1    sold95 := true\n",
    );
    // Reset sold95 to false whenever any buy fires.
    out = out.replace(/(filled10\s*:=\s*true\s*\n\s*sold80\s*:=\s*false\s*\n\s*sold90\s*:=\s*false)/g,
                       "$1\n    sold95 := false");
    out = out.replace(/(filled20\s*:=\s*true\s*\n\s*sold80\s*:=\s*false\s*\n\s*sold90\s*:=\s*false)/g,
                       "$1\n    sold95 := false");
    out = out.replace(/(filled25\s*:=\s*true\s*\n\s*sold80\s*:=\s*false\s*\n\s*sold90\s*:=\s*false)/g,
                       "$1\n    sold95 := false");
    out = out.replace(/(filled30\s*:=\s*true\s*\n\s*sold80\s*:=\s*false\s*\n\s*sold90\s*:=\s*false)/g,
                       "$1\n    sold95 := false");
    return { src: out, ok: true };
  },

  "documentation:copy-paste-log": (src) => {
    // Only the *second* "90% risk" log occurrence is inside the 95% block. Replace it.
    let count = 0;
    const out = src.replace(/log\.info\(\s*"Closing position - 90% risk - \{0\}",\s*positionSize\)/g, (m) => {
      count++;
      return count === 2 ? 'log.info("Closing position - 95% risk - {0}", positionSize)' : m;
    });
    if (count < 2) return { src, ok: false, reason: "couldn't locate the duplicated log line" };
    return { src: out, ok: true };
  },

  "robustness:end-date-stops-trading": (src) => {
    const target = /timestamp\(\s*"1 Jan 2030 00:00:00"\s*\)/;
    if (!target.test(src)) return { src, ok: false, reason: "2030 end-date default not found" };
    return { src: src.replace(target, 'timestamp("1 Jan 2100 00:00:00")'), ok: true };
  },

  "robustness:no-symbol-guard": (src) => {
    if (/runtime\.error\(.*BTC/i.test(src)) return { src, ok: false, reason: "guard already present" };
    // Insert immediately after the strategy(...) declaration line.
    const m = src.match(/^strategy\([^\n]*\)\n/m);
    if (!m) return { src, ok: false, reason: "strategy() declaration not found" };
    const insertAt = m.index! + m[0].length;
    const guard =
      "\nif not str.contains(str.upper(syminfo.ticker), \"BTC\")\n" +
      "    runtime.error(\"Risk Metric is calibrated for BTC only — apply this strategy to a Bitcoin chart.\")\n";
    return { src: src.slice(0, insertAt) + guard + src.slice(insertAt), ok: true };
  },

  // Lookahead-off on every request.security call that doesn't already specify it.
  ...buildLookaheadTransforms(),
};

function buildDeadInputTransforms(): Record<string, Transform> {
  const names = [
    "takeProfitSelected", "takeProfitPercent", "stopLossSelected", "stopLossPercent",
    "takeProfitPrice", "stopLossPrice",
  ];
  const out: Record<string, Transform> = {};
  for (const name of names) {
    out[`dead-input:${name}`] = (src) => {
      // Strip the whole line containing `^<name>\s*=`.
      const re = new RegExp(`^[ \\t]*(var\\s+\\w+\\s+)?${name}\\b[^\\n]*\\n`, "m");
      if (!re.test(src)) return { src, ok: false, reason: `declaration of ${name} not found` };
      return { src: src.replace(re, ""), ok: true };
    };
  }
  return out;
}

function buildLookaheadTransforms(): Record<string, Transform> {
  // The analyzer emits one finding per offending line: `repaint:lookahead-<line>`.
  // Implement them as a single transform keyed on the prefix, applied once for the whole batch.
  return {
    "repaint:lookahead-*": (src) => {
      const before = src;
      const after = src.replace(
        /request\.security\(([^)]*?)\)/g,
        (match, args: string) => /lookahead\s*=/.test(args) ? match : `request.security(${args}, lookahead=barmerge.lookahead_off)`,
      );
      if (after === before) return { src, ok: false, reason: "no request.security calls to update" };
      return { src: after, ok: true };
    },
  };
}

/**
 * Apply the requested set of fixes (by finding ID) to a PineScript source.
 * Order matters because some edits depend on earlier line numbers — apply in declared order:
 * dead-input first (smallest diffs), then correctness, then robustness, then lookahead, then header.
 */
export function applyImprovements(source: string, ids: string[]): ApplyResult {
  const order: string[] = [
    // dead inputs
    ...Object.keys(TRANSFORMS).filter((k) => k.startsWith("dead-input:")),
    "correctness:trading-capital-negative",
    "correctness:sell-qty-from-capital",
    "documentation:copy-paste-log",
    "robustness:unlatched-95-sell",
    "robustness:end-date-stops-trading",
    "robustness:no-symbol-guard",
    "repaint:lookahead-*",
  ];

  const wanted = new Set(ids);
  // Collapse all `repaint:lookahead-<N>` IDs to the single wildcard transform.
  if ([...wanted].some((id) => id.startsWith("repaint:lookahead-"))) wanted.add("repaint:lookahead-*");

  let src = source;
  const applied: string[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const id of order) {
    if (!wanted.has(id)) continue;
    const t = TRANSFORMS[id];
    if (!t) { skipped.push({ id, reason: "no transformer registered" }); continue; }
    const res = t(src);
    if (res.ok) { src = res.src; applied.push(id); }
    else skipped.push({ id, reason: res.reason ?? "transformer reported no change" });
  }

  // For any wanted id that doesn't exist as a registered transform (and isn't lookahead-*),
  // record it as skipped so the caller can surface "no automation for this finding."
  for (const id of ids) {
    if (id.startsWith("repaint:lookahead-")) continue; // covered by the wildcard
    if (!TRANSFORMS[id]) skipped.push({ id, reason: "no automated fix available" });
  }

  return { source: src, applied, skipped };
}

/** Convenience: analyze + apply all auto-fixable findings in one call. */
export function applyAllFixable(source: string): ApplyResult & { findingsBefore: number; findingsAfter: number } {
  const before = analyzePineScript(source);
  const result = applyImprovements(source, before.map((f) => f.id));
  const after = analyzePineScript(result.source);
  return { ...result, findingsBefore: before.length, findingsAfter: after.length };
}
