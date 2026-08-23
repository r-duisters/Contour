/**
 * The last valuation a screen saw, kept so the next one can open on numbers
 * instead of a spinner.
 *
 * `BRAND.md`: "Never block the screen on the network. Show cached values
 * immediately and say they are stale." Three screens — the portfolio, the
 * ledger and a single holding — all render the same `Valuation`, so they
 * share one cache rather than growing three.
 *
 * The logic is here, pure and over an injected storage, for the same reason
 * everything else in this package is: the APK has no `localStorage`, and a
 * hook that reached for the global directly could not be tested in node or
 * reused on a device.
 */

/** The part of `Storage` this needs — a device implementation supplies its own. */
export type KeyValueStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type Cached<V> = { at: number; valuation: V };

/**
 * Deliberately unprefixed, unlike the keys in `storage-keys.ts`.
 *
 * That prefix exists to carry preferences through the Nabla→Contour rename;
 * a preference silently lost is a bug. This is a cache. Renaming it would
 * strand every entry already written under the old spelling — real bytes in
 * every installed browser, never read again — to gain a tidiness no one can
 * see. The cache re-fills on the next fetch either way.
 */
export function valuationKey(portfolioId: string): string {
  return `valuation:${portfolioId}`;
}

/**
 * The cached valuation, or null if there is none worth showing.
 *
 * Every failure answers null: absent, unparseable, or written by a version
 * that shaped it differently. A cache that throws is worse than a cache that
 * misses, because the fetch behind it would have healed the miss.
 */
export function readCachedValuation<V>(store: KeyValueStore, portfolioId: string): Cached<V> | null {
  try {
    const raw = store.getItem(valuationKey(portfolioId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cached<V>;
    if (!parsed || typeof parsed.at !== "number" || !parsed.valuation) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Store a fresh valuation. Storage being full or blocked is not an error. */
export function writeCachedValuation<V>(
  store: KeyValueStore, portfolioId: string, valuation: V, at: number,
): void {
  try {
    store.setItem(valuationKey(portfolioId), JSON.stringify({ at, valuation }));
  } catch {
    // private mode, or the quota is gone: caching is an optimisation
  }
}
