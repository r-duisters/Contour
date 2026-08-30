import PortfolioManager from "@/components/PortfolioManager";
import { Database } from "lucide-react";
import PageLabel from "@/components/PageLabel";

/**
 * What the More menu could not hold.
 *
 * This was the More page, and its list of destinations is now the menu behind
 * the More control in both navigations — a handful of links did not deserve a
 * screen load and a trip back.
 *
 * What is left is one subject, which the name already promised. The Android
 * build and the TradingView credit moved to Settings → About: neither is
 * portfolio data, and they were here only because this screen inherited
 * whatever the menu could not hold. The credit in particular is a licence
 * condition, and belongs somewhere permanent rather than under a heading about
 * imports.
 */
export default function MorePage() {
  return (
    <main className="min-h-screen md:min-h-[calc(100vh-3.5rem)] px-4 py-5 md:p-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 mb-4 md:mb-6">
        <PageLabel icon={Database}>Portfolio data</PageLabel>
      </div>

      <PortfolioManager />

    </main>
  );
}
