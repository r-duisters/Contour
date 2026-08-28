import type { IconSource } from "@/components/icon-source";

/**
 * The server-side proxy: each logo fetched and cached once, by us.
 *
 * The privacy property `CoinIcon` used to claim in a comment, kept true by
 * this route existing — the browser asks our server, our server asks the CDN,
 * and the CDN learns nothing about who holds what. It lives here rather than
 * in `packages/ui` because it names a route, and a shared component that names
 * a route is a blank panel on a device with nothing to say why.
 */
export const WEB_ICON_SOURCE: IconSource = (symbol, assetType, base) =>
  assetType === "equity"
    ? `/api/icon?symbol=${encodeURIComponent(symbol.toUpperCase())}&type=equity`
    : `/api/icon?symbol=${encodeURIComponent(base)}&type=crypto`;
