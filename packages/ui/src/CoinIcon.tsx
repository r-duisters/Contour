"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { NO_ICONS, type IconSource } from "./icon-source";

const QUOTE_ASSETS = ["USDT", "FDUSD", "BUSD", "USDC", "TUSD", "BTC", "ETH", "BNB", "EUR", "TRY"];

/** BTCUSDT -> BTC; falls back to the full symbol for unknown pair shapes. */
export function baseAsset(symbol: string): string {
  const s = symbol.toUpperCase();
  for (const q of QUOTE_ASSETS) {
    if (s.endsWith(q) && s.length > q.length) return s.slice(0, -q.length);
  }
  return s;
}

/**
 * BTCUSDT -> USDT, and null for anything that is not a pair — a listed
 * security is priced in its venue's currency, which the ticker does not
 * carry. Callers must say "Price" rather than name a currency they guessed.
 */
export function quoteAsset(symbol: string): string | null {
  const s = symbol.toUpperCase();
  for (const q of QUOTE_ASSETS) {
    if (s.endsWith(q) && s.length > q.length) return q;
  }
  return null;
}

const FALLBACK_COLORS = ["#3b82f6", "#22c55e", "#eab308", "#a855f7", "#ef4444", "#14b8a6", "#f97316", "#64748b"];

function colorFor(ticker: string): string {
  let h = 0;
  for (let i = 0; i < ticker.length; i++) h = (h * 31 + ticker.charCodeAt(i)) | 0;
  return FALLBACK_COLORS[Math.abs(h) % FALLBACK_COLORS.length]!;
}

/**
 * Where logos come from, supplied by the app.
 *
 * This component used to name `/api/icon` itself — the server-side proxy that
 * fetches and caches each logo once, so the phone never talks to an icon CDN
 * and nothing outside learns what is held. That route now lives in `apps/web`,
 * because a device has no proxy and calling a CDN from it would break exactly
 * that promise; the device build ships its logos instead.
 *
 * The default is initials. An app that wires nothing gets something legible
 * rather than a broken image.
 */
const IconSourceContext = createContext<IconSource>(NO_ICONS);

export function IconSourceProvider({ source, children }: { source: IconSource; children: ReactNode }) {
  return <IconSourceContext.Provider value={source}>{children}</IconSourceContext.Provider>;
}

export default function CoinIcon({
  symbol, size = 20, assetType,
}: {
  symbol: string;
  size?: number;
  assetType?: "crypto" | "equity" | "cash";
}) {
  // Remember *which* source failed. A page that renders the icon before it
  // knows the asset type would otherwise guess crypto, 404, and keep showing
  // initials even after the type arrives and a real logo becomes available.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const iconSource = useContext(IconSourceContext);
  const base = baseAsset(symbol);

  // Cash has no logo anywhere; equities are looked up by their full ticker,
  // coins by the base asset of the pair.
  const src = iconSource(symbol, assetType, base);

  // `null` is a source saying it has no logo for this ticker — the device
  // build ships a bundle rather than a proxy, so anything outside it takes the
  // initials, which is the honest answer and already looks deliberate.
  const failed = src === null || failedSrc === src;

  if (failed || assetType === "cash") {
    return (
      <span
        aria-hidden
        className="inline-flex items-center justify-center rounded-full font-semibold text-white shrink-0"
        style={{ width: size, height: size, fontSize: size * 0.42, background: colorFor(base) }}
      >
        {base.slice(0, 2)}
      </span>
    );
  }

  /*
   * Every logo sits on a white disc, coins included.
   *
   * Equities had this and coins did not, and the difference was invisible for
   * as long as coin artwork came from a set drawn to one house style. It stops
   * being invisible when the source becomes each project's own mark: CoinGecko
   * serves Immutable X as pure black on transparent, so on this app's
   * `#0a0a0a` ground it rendered as a hole where a logo should be. APT, NMR
   * and ZRX were barely better.
   *
   * Measured before changing it, because the obvious risk is the mirror image
   * — a white-on-transparent mark would vanish the other way. Of the 97 coin
   * logos shipped, the worst contrast against white is 69 out of 255, so
   * nothing is close. And an opaque logo covers the disc completely, which is
   * why the 93 that were already fine look no different.
   */
  return (
    <span
      aria-hidden
      className="inline-flex items-center justify-center rounded-full overflow-hidden shrink-0 bg-white"
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        aria-hidden
        loading="lazy"
        // `cover`, so a logo fills the disc edge to edge rather than sitting
        // inset in it — the list reads as one column of discs either way.
        style={{ width: size, height: size, objectFit: "cover" }}
        onError={() => setFailedSrc(src)}
      />
    </span>
  );
}
