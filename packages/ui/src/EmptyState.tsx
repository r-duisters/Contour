"use client";

import type { ReactNode } from "react";

/**
 * `BRAND.md`: "one muted sentence saying what to do, never an illustration."
 *
 * Nine of these existed and eight agreed on the tier, which is the kind of
 * near-miss prose cannot police — the ninth was `text-xs` and simply looked
 * like a different thing. The tier lives here now.
 *
 * Padding stays with the caller, deliberately. An empty state stands in for
 * rows, and the spacing that makes it look right is the spacing of the rows
 * it replaced: `py-4` in the alerts list, `py-2` beside the passkeys, nothing
 * at all where a section already provides it. Forcing one value would make
 * every list slightly wrong in exchange for a consistency no one can see.
 */
export default function EmptyState({
  as: Tag = "p", className = "", children,
}: {
  as?: "p" | "li";
  className?: string;
  children: ReactNode;
}) {
  return <Tag className={`text-sm text-neutral-500 ${className}`}>{children}</Tag>;
}
