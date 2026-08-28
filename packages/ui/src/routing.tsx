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
  /**
   * Where "Alert me" goes, or `null` where there is nowhere for it to go.
   *
   * Alerts are permanently server-only — the routes, Home Assistant, web-push
   * and FCM are all listed in CLAUDE.md as things the device build will never
   * call — so the standalone app has no `/alerts` page at all. A link to it
   * was a link to nothing.
   *
   * Null rather than a disabled button, and rather than the screen asking
   * which app it is in: `data-client.ts` sets the rule that a capability one
   * platform cannot have is *absent*, not throwing and not visibly broken.
   * This is the same rule, for a destination instead of a method.
   */
  alertsHref(pair: string): string | null;
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
  alertsHref: (pair) => withQuery("/alerts", { symbol: pair }),
};

export const DEVICE_ROUTING: Routing = {
  assetHref: (symbol, assetType, extra) =>
    withQuery("/portfolio/asset", { symbol, type: assetType, ...extra }),
  // There is no alerts screen in this build, and nothing to configure that
  // would give it one: alerts need a server, and this app is the one with no
  // server behind it.
  alertsHref: () => null,
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

/** Null where this build has no alerts screen — the caller draws nothing. */
export function useAlertsHref(pair: string): string | null {
  return useContext(RoutingContext).alertsHref(pair);
}
