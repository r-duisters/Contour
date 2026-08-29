"use client";

import { useState } from "react";
import { hiddenOnPhone, RANGES, type RangeKey } from "@/lib/ranges";

/**
 * The timeframe picker, used by every screen that has one.
 *
 * Periods outside the everyday set collapse behind "More" on a phone and sit
 * inline from `md:` up, where there is room for the whole row. The collapsed
 * state is the initial render on both server and client, so nothing depends on
 * measuring the viewport and there is no hydration mismatch.
 *
 * **"More" opens downwards, never rightwards.** It used to reveal the extra
 * periods into the same fixed row, which pushed it past the right edge of the
 * screen: the last periods were unreachable, and the control that had just
 * been tapped moved out from under the thumb. `flex-wrap` is what fixes that,
 * and it is the whole fix — a wrapped row cannot overflow.
 *
 * Two things were tried and measured before settling here. Forcing a break
 * before the first hidden period always gave two rows, but split them 3/5 —
 * the everyday periods are interleaved with the extras, so a single break
 * cannot put one group above the other without reordering the buttons under
 * somebody's finger. Leaving the wrap to chance fitted all eight on one row at
 * 412px, which is better, but orphaned "All" onto a line of its own at 360px.
 *
 * So the buttons tighten when expanded. Eight periods at `px-2` fit one row on
 * an ordinary phone, and on a narrower one they wrap rather than overflow,
 * which is the guarantee that matters. Deliberately not two rendered lists:
 * that would mean every extra period existing twice in the DOM, one copy
 * hidden at each breakpoint, and a screen reader announcing eight buttons
 * where there are four.
 */
export default function RangePicker({
  value, onChange, only, className = "",
}: {
  value: RangeKey;
  onChange: (next: RangeKey) => void;
  /** Offer a subset — a filter over the canonical list, never a second list. */
  only?: readonly RangeKey[];
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const offered = RANGES.filter((r) => !only || only.includes(r.key));
  const isExtra = (key: RangeKey) => hiddenOnPhone(key, value);
  const hasExtras = offered.some((r) => isExtra(r.key));
  const firstExtra = offered.find((r) => isExtra(r.key))?.key;

  return (
    <div
      className={`inline-flex flex-wrap justify-center items-center gap-1 p-1
                  bg-neutral-900/50 border border-neutral-800/50
                  ${expanded ? "rounded-2xl md:rounded-full" : "rounded-full"} ${className}`}
    >
      {offered.map((r) => (
        <span key={r.key} className="contents">
          {/* The line break, before the first period that was hidden. Zero
              height and full width: it occupies a whole flex line without
              taking a row of its own. */}
          <button
            onClick={() => onChange(r.key)}
            aria-pressed={value === r.key}
            className={`${expanded ? "px-2 md:px-3" : "px-3"} py-1 text-xs rounded ${
              isExtra(r.key) ? (expanded ? "" : "hidden md:inline-block") : ""
            } ${value === r.key ? "bg-neutral-800 text-neutral-100" : "text-neutral-500"}`}
          >
            {r.label}
          </button>
        </span>
      ))}
      {hasExtras && (
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="md:hidden px-2 py-1 text-xs rounded text-neutral-600"
        >
          {expanded ? "Less" : "More"}
        </button>
      )}
    </div>
  );
}
