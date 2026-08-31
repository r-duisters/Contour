"use client";

import PortfolioRuleSetting from "./PortfolioRuleSetting";
import { DEFAULT_MOVE_THRESHOLD } from "./move-threshold";

/**
 * The daily move rule: tell me when anything I hold moves more than N% in a day.
 *
 * It was called "big moves", which is how somebody describes the feature to a
 * friend rather than what a tool calls it. The app already has one alert kind
 * with a proper name — a price target — and this is the other one, so it takes
 * a name of the same register. "Daily move" also says the two things the old
 * label left out: what is measured (a move) and over what (a day).
 *
 * One stored rule: a `pct_move` alert naming a portfolio and no symbol, which
 * `expandRules` turns into one check per holding at evaluation time. That
 * indirection is the point — something bought next week is covered by a rule
 * written today.
 *
 * The machinery is in `PortfolioRuleSetting`, shared with the portfolio-level
 * rule beside it; what is here is the words and the kind.
 */
export default function DailyMoveSetting() {
  return (
    <PortfolioRuleSetting
      copy={{
        kind: "pct_move",
        title: "Daily move",
        description:
          "Watches every holding, coins and shares. One notification a day per " +
          "holding that rises or falls by more than the figure below — including " +
          "anything bought after this was set.",
        unit: "% in a day",
        defaultThreshold: DEFAULT_MOVE_THRESHOLD,
        confirm: (v) => `Watching for moves over ${v}%.`,
        offMessage: "Turned off. Alerts you set on an asset still fire.",
      }}
    />
  );
}
