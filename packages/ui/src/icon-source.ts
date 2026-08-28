/**
 * Where a logo comes from.
 *
 * A string, not a promise: `CoinIcon` needs a value for an `<img src>` and
 * cannot await one during render. `null` means "no logo" and the initials
 * fallback takes over, which is already implemented and already looks
 * deliberate rather than broken.
 *
 * It is supplied per app because the two get logos differently, and the
 * difference is a privacy property rather than plumbing. `CoinIcon` used to
 * name `/api/icon` directly, with a comment claiming that the phone never
 * talks to an icon CDN so nothing outside learns what is held. On the web that
 * proxy keeps the claim true. A device has no proxy, and calling a CDN from it
 * would quietly break a promise written into the code — in an app whose entire
 * pitch is that the portfolio does not leave the phone. So the device build
 * ships its logos instead (spec section 7).
 */
export type IconSource = (
  symbol: string,
  assetType: "crypto" | "equity" | "cash" | undefined,
  base: string,
) => string | null;

/**
 * The default, and deliberately the empty one: initials for everything.
 *
 * The web app's source names a route, so it lives in `apps/web` rather than
 * here — `packages/ui` now names no route at all, which is the property
 * `boundary.test.ts` exists to keep and the reason its allowlist is empty.
 * An app that supplies nothing gets initials, which is legible rather than
 * broken.
 */
export const NO_ICONS: IconSource = () => null;

/**
 * Bundled with the app. Only the tickers in `icons/index.json` exist; anything
 * else returns null and gets initials, which is the honest answer for a coin
 * whose logo was never shipped.
 */
export function bundledIconSource(available: ReadonlySet<string>): IconSource {
  return (symbol, assetType, base) => {
    const ticker = (assetType === "equity" ? symbol : base).toUpperCase();
    return available.has(ticker) ? `/icons/assets/${encodeURIComponent(ticker)}.png` : null;
  };
}
