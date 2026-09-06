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
 * proxy keeps the claim true. The device build fetched nothing for a while,
 * shipping 274 logos inside the APK instead — until it turned out we had no
 * right to redistribute most of them. It fetches on demand and caches now,
 * which tells the CDN what is held. That is a real cost, taken deliberately;
 * `docs/asset-logos.md` argues it.
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
