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

  return (
    <div
      className={`inline-flex items-center gap-1 p-1 rounded-full
                  bg-neutral-900/50 border border-neutral-800/50 ${className}`}
    >
      {offered.map((r) => (
        <button
          key={r.key}
          onClick={() => onChange(r.key)}
          aria-pressed={value === r.key}
          className={`px-3 py-1 text-xs rounded ${
            isExtra(r.key) ? (expanded ? "" : "hidden md:inline-block") : ""
          } ${value === r.key ? "bg-neutral-800 text-neutral-100" : "text-neutral-500"}`}
        >
          {r.label}
        </button>
      ))}
      {hasExtras && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="md:hidden px-2 py-1 text-xs rounded text-neutral-600"
        >
          {expanded ? "Less" : "More"}
        </button>
      )}
    </div>
  );
}
