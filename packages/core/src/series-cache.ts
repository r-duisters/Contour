import type { KeyValueStore } from "./valuation-cache";
import { RANGE_KEYS, type RangeKey } from "./ranges";

/**
 * The last value history a screen drew, per portfolio and per range, kept so
 * the chart can open on a line instead of a blank.
 *
 * The companion to `valuation-cache.ts`, and the same BRAND.md rule: "Never
 * block the screen on the network. Show cached values immediately and say
 * they are stale." The headline figure got that treatment first; the chart
 * under it kept blanking on every open and every range tap, waiting on the
 * slowest request the portfolio page makes.
 *
 * `change` rides along because the header's period line is derived from the
 * same response as the chart — cached separately they would disagree, one
 * stale and one absent.
 *
 * Pure over an injected storage, like everything else here: the APK has no
 * `localStorage`, and a hook reaching for the global could not be tested.
 */

export type CachedSeries = {
  at: number;
  series: { t: number; value: number }[];
  change: { abs: number; pct: number | null } | null;
};

/** Unprefixed for the reason `valuationKey` gives: a cache key is not a preference. */
export function seriesKey(portfolioId: string, range: RangeKey): string {
  return `series:${portfolioId}:${range}`;
}

/** The cached series, or null — absent, unparseable, or shaped by an older version. */
export function readCachedSeries(
  store: KeyValueStore, portfolioId: string, range: RangeKey,
): CachedSeries | null {
  try {
    const raw = store.getItem(seriesKey(portfolioId, range));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedSeries;
    if (!parsed || typeof parsed.at !== "number" || !Array.isArray(parsed.series)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Store a fresh series. Storage being full or blocked is not an error. */
export function writeCachedSeries(
  store: KeyValueStore,
  portfolioId: string,
  range: RangeKey,
  series: CachedSeries["series"],
  change: CachedSeries["change"],
  at: number,
): void {
  try {
    store.setItem(seriesKey(portfolioId, range), JSON.stringify({ at, series, change }));
  } catch {
    // private mode, or the quota is gone: caching is an optimisation
  }
}

/** Drop every range's entry for one portfolio. `forgetPortfolio` calls this. */
export function forgetSeries(
  store: KeyValueStore & { removeItem(key: string): void }, portfolioId: string,
): void {
  try {
    for (const range of RANGE_KEYS) store.removeItem(seriesKey(portfolioId, range));
  } catch {
    // Blocked storage: the entries stay, unreachable and harmless.
  }
}
