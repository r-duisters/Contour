"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AssetScreen from "@/ui/screens/AssetScreen";

/**
 * Routing only, and the reason this route exists at all: under
 * `output: "export"` a dynamic segment needs `generateStaticParams`, and the
 * set of symbols is user data that does not exist at build time. So the symbol
 * travels as a query parameter here and as a path segment on the web, and
 * `assetHref` in `routing.tsx` is what keeps every link honest about which.
 */
function Route() {
  const query = useSearchParams();
  const type = query.get("type");
  return (
    <AssetScreen
      symbol={query.get("symbol") ?? ""}
      assetType={type === "equity" ? "equity" : type === "crypto" ? "crypto" : null}
      portfolioId={query.get("p") || null}
    />
  );
}

export default function Page() {
  // `useSearchParams` suspends during prerender, and a static export prerenders
  // everything. Without a boundary the build fails rather than the page.
  return <Suspense><Route /></Suspense>;
}
