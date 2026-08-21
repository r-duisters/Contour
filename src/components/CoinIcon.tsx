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

const COIN_CDN = "https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color";
// Company logos by ticker, exchange suffix included (SHELL.AS, EUDF.DE).
// Unknown tickers 404 rather than returning a placeholder, so the initials
// fallback below still gets its turn.
const STOCK_LOGOS = "https://assets.parqet.com/logos/symbol";

export default function CoinIcon({
  symbol, size = 20, assetType,
}: {
  symbol: string;
  size?: number;
  assetType?: "crypto" | "equity" | "cash";
}) {
  const [failed, setFailed] = useState(false);
  const base = baseAsset(symbol);

  // Cash has no logo anywhere; equities have one, but not on the coin CDN.
  const src = assetType === "equity"
    ? `${STOCK_LOGOS}/${encodeURIComponent(symbol.toUpperCase())}`
    : `${COIN_CDN}/${base.toLowerCase()}.svg`;

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
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      width={size}
      height={size}
      alt=""
      aria-hidden
      loading="lazy"
      // Company marks are drawn to their own edges; rounding would clip them.
      className={assetType === "equity" ? "shrink-0" : "rounded-full shrink-0"}
      onError={() => setFailed(true)}
    />
  );
}
