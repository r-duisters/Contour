/**
 * Local storage keys, and the rename that carried them forward.
 *
 * The app was called Nabla until it was called Contour. Preferences are keyed
 * by name, so without this every phone would silently forget its privacy
 * setting and its chart periods on the version that renamed things. The move
 * happens once per key, on first read, and old keys are removed after.
 */
const RENAMED_FROM = "nabla:";
const PREFIX = "contour:";

export const KEYS = {
  hideAmounts: `${PREFIX}hide-amounts`,
  privacyEvent: `${PREFIX}privacy`,
  rangePortfolio: `${PREFIX}range:portfolio`,
  rangeAsset: `${PREFIX}range:asset`,
  /**
   * Whether the asset page's cost-and-fees fold-out is open.
   *
   * Remembered rather than reset per asset, because the person it costs a tap
   * is the one reconciling a sale across several holdings in one sitting —
   * exactly the case where re-opening it on every page would be the annoying
   * half of the trade. Somebody who never wants it pays nothing either way.
   */
  assetLedgerOpen: `${PREFIX}asset-ledger-open`,
  /**
   * The portfolio a screen last resolved.
   *
   * The ledger learns which portfolio it is showing from the network, so
   * without a remembered id its cached valuation is unreachable until the
   * very request the cache exists to hide has already returned. This is a
   * hint, never an authority: the fetch still decides, and a wrong guess
   * costs one corrected render.
   */
  lastPortfolio: `${PREFIX}last-portfolio`,
  /**
   * When an alert check last completed, and which rules have already been
   * notified today.
   *
   * Both belong to the device rather than the server: the reliable check is
   * the app opening, and only the device knows when that last happened. The
   * marks are what stop a standing condition notifying on every launch.
   */
  alertsLastChecked: `${PREFIX}alerts-last-checked`,
  alertsSent: `${PREFIX}alerts-sent`,
  /**
   * That first-run setup has been through once, whether it was completed or
   * skipped. Skipping means "don't ask again"; without this the flow would
   * reappear on every launch until a portfolio existed, which is the opposite
   * of what the button says.
   */
  setupDone: `${PREFIX}setup-done`,
} as const;

/** Read a key, adopting any value the old name still holds. */
export function readKey(key: string): string | null {
  try {
    const current = localStorage.getItem(key);
    if (current !== null) return current;
    if (!key.startsWith(PREFIX)) return null;
    const legacy = localStorage.getItem(RENAMED_FROM + key.slice(PREFIX.length));
    if (legacy === null) return null;
    localStorage.setItem(key, legacy);
    localStorage.removeItem(RENAMED_FROM + key.slice(PREFIX.length));
    return legacy;
  } catch {
    // private mode or blocked storage: callers fall back to their default
    return null;
  }
}
