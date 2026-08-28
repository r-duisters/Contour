"use client";

import { use } from "react";
import { useSearchParams } from "next/navigation";
import AssetScreen from "@/ui/screens/AssetScreen";

/**
 * Routing only: the web spells an asset as a path segment. The device build
 * cannot — a static export has no dynamic segments — so it has its own router
 * at `/portfolio/asset` and both hand the same three answers to one screen.
 */
export default function Page({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = use(params);
  const query = useSearchParams();
  const type = query.get("type");
  return (
    <AssetScreen
      symbol={decodeURIComponent(symbol)}
      assetType={type === "equity" ? "equity" : type === "crypto" ? "crypto" : null}
      portfolioId={query.get("p") || null}
    />
  );
}
