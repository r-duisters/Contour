"use client";

import PortfolioRuleSetting from "./PortfolioRuleSetting";

/**
 * The rule whose subject is the money rather than a ticker.
 *
 * "Daily move" beside this one watches each holding separately, which is
 * dominated by whichever position is smallest: a 5% move in 2% of the book is
 * 0.1% of the money and notifies exactly as loudly as 5% of half of it. This
 * asks whether the total moved — the figure on the portfolio screen — which no
 * rule could express before at any threshold.
 *
 * A lower default than the per-asset rule, and deliberately. A portfolio moving
 * 3% in a day is a notable day; an asset moving 3% is a Tuesday. Setting both
 * to the same number would make this one either silent or a duplicate.
 *
 * Cash is left out of the total by `expandPortfolioRules` — a balance does not
 * move against itself, and including it would damp every percentage by the
 * share of the book sitting in currency.
 */
const DEFAULT_PORTFOLIO_THRESHOLD = 3;

export default function PortfolioMoveSetting() {
  return (
    <PortfolioRuleSetting
      copy={{
        kind: "portfolio_move",
        title: "Portfolio move",
        description:
          "One notification when everything you hold, added up, rises or falls by " +
          "more than the figure below in a day. Cash is left out — it does not move.",
        unit: "% in a day",
        defaultThreshold: DEFAULT_PORTFOLIO_THRESHOLD,
        confirm: (v) => `Watching for days when the portfolio moves over ${v}%.`,
        offMessage: "Turned off. Your per-holding alerts still fire.",
      }}
    />
  );
}
