/**
 * The app's timeframes, defined once.
 *
 * Every screen that offers a period offers it from this list, with the same
 * keys and the same labels. Screens may offer a subset — a time-weighted
 * return over a single day says nothing, so Insights starts at a month — but
 * a subset is a filter over this list, never a second list with its own
 * spelling. Four separate definitions is what this replaces.
 */
export const RANGES = [
  { key: "1d", label: "1D", long: "1 day" },
  { key: "1w", label: "1W", long: "1 week" },
  { key: "1m", label: "1M", long: "1 month" },
  { key: "ytd", label: "YTD", long: "Year to date" },
  { key: "1y", label: "1Y", long: "1 year" },
  { key: "2y", label: "2Y", long: "2 years" },
  { key: "5y", label: "5Y", long: "5 years" },
  { key: "all", label: "All", long: "All time" },
] as const;

export type RangeKey = (typeof RANGES)[number]["key"];

export const RANGE_KEYS = RANGES.map((r) => r.key) as readonly RangeKey[];

/**
 * The periods worth a tap every day. The rest stay one tap further away on a
 * phone, where eight buttons wrap onto a second line and cost more room than
 * they earn.
 */
export const EVERYDAY_RANGES: readonly RangeKey[] = ["1d", "1w", "1m", "1y", "all"];

/** Periods where a time-weighted return is meaningful. */
export const PERFORMANCE_RANGES: readonly RangeKey[] = ["1m", "ytd", "1y", "2y", "5y", "all"];

/** The label a screen should print for a key. */
export function rangeLabel(key: RangeKey, long = false): string {
  const r = RANGES.find((x) => x.key === key);
  return r ? (long ? r.long : r.label) : key;
}

/**
 * Whether a period collapses behind "More" on a phone.
 *
 * The selected period never hides, whichever group it belongs to — collapsing
 * the active choice would leave the row showing no selection at all, which
 * reads as a bug rather than as tidiness.
 */
export function hiddenOnPhone(key: RangeKey, selected: RangeKey): boolean {
  return !EVERYDAY_RANGES.includes(key) && key !== selected;
}
