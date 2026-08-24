import PortfolioManager from "@/components/PortfolioManager";
import { Download } from "lucide-react";

/**
 * What the More menu could not hold.
 *
 * This was the More page, and its list of destinations is now the menu behind
 * the More control in both navigations — a handful of links did not deserve a
 * screen load and a trip back. What is left is the part that needs room: the
 * portfolio manager and its import, the Android build, and the attribution
 * credit the charts depend on.
 */
export default function MorePage() {
  return (
    <main className="min-h-screen md:min-h-[calc(100vh-3.5rem)] px-4 py-5 md:p-8 max-w-3xl mx-auto">
      <h1 className="text-xl md:text-2xl font-semibold mb-4 md:mb-6">Portfolio data</h1>

      <div className="mb-8">
        <PortfolioManager />
      </div>

      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400 mb-2">Android app</h2>
      <a href="/api/app/download"
         className="inline-flex items-center gap-2 text-sm text-blue-500 mb-2">
        <Download size={16} aria-hidden className="text-neutral-400" />
        Download the latest build
      </a>
      <p className="text-xs text-neutral-500 mb-8">
        Only needed when the app shell itself changes — icons, permissions, the
        lock screen. Everything else updates the moment the server does, so
        pull to refresh is usually enough. Inside the app this hands the file
        to your browser, which installs it.
      </p>

      {/*
        This is not decoration. Lightweight Charts is Apache 2.0, and its terms
        additionally ask for the attribution notice and a link to tradingview.com
        on a page the user can reach. Its on-chart logo is one way to satisfy
        that; this is ours, which is why `attributionLogo: false` is set on all
        four charts. Remove this and those four become a licence breach.
      */}
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400 mt-8 mb-2">Credits</h2>
      <p className="text-xs text-neutral-500">
        Charts by{" "}
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer noopener"
           className="text-blue-500">TradingView</a>
        {" "}— Lightweight Charts™, Copyright © 2023 TradingView, Inc.
      </p>
    </main>
  );
}
