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
   * One exchange's own page, or `null` where this build has none.
   *
   * A static export cannot hold a dynamic segment, so `/markets/aex` does not
   * exist in the APK. Following it did more than fail: the WebView left the
   * document, which remounted the app against a native SQLite connection that
   * was already registered, and the screen read "Contour could not open its
   * database". A dead link on a static export is not a dead end, it is a
   * restart.
   */
  indexHref(slug: string): string | null;
  /**
   * The detailed indicator chart, or `null` where this build has none.
   *
   * The strategy tooling is server-only — the chart proxies Binance through a
   * route — so the APK has no `/chart`. Found by `links.test.ts` rather than on
   * a handset, and it is the same fault as the index card: a link out of a
   * static export does not 404, it restarts the app.
   */
  chartHref(pair: string): string | null;
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
  indexHref: (slug) => `/markets/${encodeURIComponent(slug)}`,
  chartHref: (pair) => withQuery("/chart", { symbol: pair }),
};

export const DEVICE_ROUTING: Routing = {
  assetHref: (symbol, assetType, extra) =>
    withQuery("/portfolio/asset", { symbol, type: assetType, ...extra }),
  // There is no alerts screen in this build, and nothing to configure that
  // would give it one: alerts need a server, and this app is the one with no
  // server behind it.
  // No dynamic segments in a static export. The card still draws its figures;
  // it simply is not a link, which `MarketsScreen` already handles.
  indexHref: () => null,
  chartHref: () => null,
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

/** Null where this build has no page for one exchange — the card is not a link. */
export function useIndexHref(): Routing["indexHref"] {
  return useContext(RoutingContext).indexHref;
}

/** Null where this build has no detailed chart — the caller draws nothing. */
export function useChartHref(pair: string): string | null {
  return useContext(RoutingContext).chartHref(pair);
}
