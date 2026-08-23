"use client";

import type { ReactNode } from "react";

/**
 * The tier below a section heading: "Best" and "Worst" inside "What made the
 * money", "Headlines" inside an asset's background panel.
 *
 * It is the section heading held constant and stepped down twice — `text-xs`
 * rather than `text-sm`, `text-neutral-500` rather than `text-neutral-400`,
 * with weight, case and tracking unchanged. Deriving it that way is what makes
 * it a tier rather than a fourth idiom: the two documented headings are both
 * semibold uppercase, and an undocumented third that dropped the weight on one
 * of its two uses read as a different kind of thing entirely.
 *
 * Not every small uppercase label belongs here. The ledger's row labels and
 * the analyzer's severity line are labels on a figure, not headings over a
 * group, and they keep their own spellings.
 */
export default function SubHeading({
  className = "", children,
}: { className?: string; children: ReactNode }) {
  return (
    <h3 className={`text-xs font-semibold uppercase tracking-wide text-neutral-500 ${className}`}>
      {children}
    </h3>
  );
}
