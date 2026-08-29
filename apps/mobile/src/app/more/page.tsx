"use client";

import { Database } from "lucide-react";
import PageLabel from "@/components/PageLabel";
import PortfolioManager from "@/components/PortfolioManager";

/**
 * Portfolio data. One subject, the same on both builds.
 *
 * This carried a "What this build does not do" list — Home Assistant and push,
 * the strategy tooling, sync. Two of the three were the desktop's features
 * named on a screen that cannot offer them, under a heading about imports:
 * a person reading about their own data was told about a backtester they
 * have no way to reach. Where those absences still need saying they are said
 * where the question is asked — Settings → Notifications explains that alerts
 * are checked on this phone, and the More menu simply does not list the
 * strategy screens.
 *
 * The sync line stayed, because it is not about a missing feature. It is
 * about *this* data: two portfolios that can disagree, and no warning
 * anywhere else on the phone that they do.
 */
export default function MorePage() {
  return (
    <main className="min-h-screen px-4 py-5 max-w-3xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <PageLabel icon={Database}>Portfolio data</PageLabel>
      </div>

      <PortfolioManager />

      <p className="text-xs text-neutral-500 mt-8 max-w-prose">
        This phone keeps its own portfolio. Nothing syncs to or from the desktop
        app, so the two can drift apart — a backup taken there and restored here
        is the way across.
      </p>
    </main>
  );
}
