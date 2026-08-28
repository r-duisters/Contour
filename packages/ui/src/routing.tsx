"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Where a screen's links point, which the two apps spell differently.
 *
 * Under `output: "export"` a dynamic segment needs `generateStaticParams`, and
 * the set of symbols is user data that does not exist at build time. So the
 * asset page is a path segment on the web and a query string on a device:
 *
 *   web     /portfolio/BTC?type=crypto
 *   device  /portfolio/asset?symbol=BTC&type=crypto
 *
 * A shared screen cannot know which it is in, and a link built the wrong way
 * is a dead end that only appears in the APK — nothing in a browser or a test
 * would ever notice. So the shape comes from the app, through context.
 */
export type Routing = {
  /**
   * The asset's own page. `extra` is for the parameters a caller adds — the
   * movers list passes the portfolio it came from — and it is the helper's
   * job rather than the caller's because whether the next one needs `?` or
   * `&` depends on a URL shape the caller is not supposed to know.
   */
  assetHref(symbol: string, assetType?: string | null, extra?: Record<string, string>): string;
};

function withQuery(path: string, params: Record<string, string | null | undefined>): string {
  const q = Object.entries(params)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
    .join("&");
  return q ? `${path}?${q}` : path;
}

export const WEB_ROUTING: Routing = {
  assetHref: (symbol, assetType, extra) =>
    withQuery(`/portfolio/${encodeURIComponent(symbol)}`, { type: assetType, ...extra }),
};

export const DEVICE_ROUTING: Routing = {
  assetHref: (symbol, assetType, extra) =>
    withQuery("/portfolio/asset", { symbol, type: assetType, ...extra }),
};

/**
 * The web shape is the default, so a screen rendered without a provider still
 * links correctly in the app that has always existed. The device build must
 * supply its own, and does so in `providers.tsx` beside the client.
 */
const RoutingContext = createContext<Routing>(WEB_ROUTING);

export function RoutingProvider({ routing, children }: { routing: Routing; children: ReactNode }) {
  return <RoutingContext.Provider value={routing}>{children}</RoutingContext.Provider>;
}

export function useAssetHref(): Routing["assetHref"] {
  return useContext(RoutingContext).assetHref;
}
