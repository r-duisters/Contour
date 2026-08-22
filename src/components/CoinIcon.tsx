"use client";

import { useState } from "react";

const QUOTE_ASSETS = ["USDT", "FDUSD", "BUSD", "USDC", "TUSD", "BTC", "ETH", "BNB", "EUR", "TRY"];

/** BTCUSDT -> BTC; falls back to the full symbol for unknown pair shapes. */
export function baseAsset(symbol: string): string {
  const s = symbol.toUpperCase();
  for (const q of QUOTE_ASSETS) {
    if (s.endsWith(q) && s.length > q.length) return s.slice(0, -q.length);
  }
  return s;
}

const FALLBACK_COLORS = ["#3b82f6", "#22c55e", "#eab308", "#a855f7", "#ef4444", "#14b8a6", "#f97316", "#64748b"];

function colorFor(ticker: string): string {
  let h = 0;
  for (let i = 0; i < ticker.length; i++) h = (h * 31 + ticker.charCodeAt(i)) | 0;
  return FALLBACK_COLORS[Math.abs(h) % FALLBACK_COLORS.length]!;
}

// Icons come from our own server, which fetches and caches them once. The
// phone never talks to an icon CDN, so nothing outside learns what is held.
// Unknown tickers 404 there too, leaving the initials fallback its turn.
const ICON_API = "/api/icon";

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
  const base = baseAsset(symbol);

  // Cash has no logo anywhere; equities are looked up by their full ticker,
  // coins by the base asset of the pair.
  const src = assetType === "equity"
    ? `${ICON_API}?symbol=${encodeURIComponent(symbol.toUpperCase())}&type=equity`
    : `${ICON_API}?symbol=${encodeURIComponent(base)}&type=crypto`;

  const failed = failedSrc === src;

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

  // Equity logos are clipped to the same circle as a coin icon so the list is
  // one column of discs. They fill it edge to edge rather than sitting inset.
  if (assetType === "equity") {
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
          style={{ width: size, height: size, objectFit: "cover" }}
          onError={() => setFailedSrc(src)}
        />
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      width={size}
      height={size}
      alt=""
      aria-hidden
      loading="lazy"
      className="rounded-full shrink-0"
      onError={() => setFailedSrc(src)}
    />
  );
}
