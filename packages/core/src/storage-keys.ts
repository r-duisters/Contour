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
