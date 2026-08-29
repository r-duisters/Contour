"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { DISCLESS_LOGOS } from "@/lib/logo-discs";
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
   * Most logos sit on a white disc; a measured few sit on nothing.
   *
   * The white disc exists because a logo can be a hole otherwise: CoinGecko
   * serves Immutable X as pure black on transparent, which on this app's
   * `#0a0a0a` ground rendered as an absence where a mark should be. APT, NMR
   * and ZRX were barely better.
   *
   * But a single colour cannot serve both ends. Of the 274 logos bundled, the
   * disc is only visible on 35 — the rest fill the circle with their own
   * artwork, and `rounded-full` crops the corners where it would otherwise
   * show. Of those 35, white is the wrong answer for 23: GAS covers 83% of its
   * disc and meets white at 1.6:1, and THETA, HOT and NEO are no better.
   *
   * So the choice is per logo, taken from the artwork rather than by eye —
   * `scripts/logo-disc.mjs` measures the ink at each mark's rim against both
   * grounds and writes the list. Worst contrast after the split is 4.5:1,
   * against 1.6:1 before it. A discless logo sits on whatever surface is
   * behind it, which is the page ground or a card; it was checked against both.
   */
  const disc = DISCLESS_LOGOS.has(base) ? "" : "bg-white";
  return (
    <span
      aria-hidden
      className={`inline-flex items-center justify-center rounded-full overflow-hidden shrink-0 ${disc}`}
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
