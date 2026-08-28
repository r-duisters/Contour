"use client";

import { Database } from "lucide-react";
import PageLabel from "@/components/PageLabel";
import PortfolioManager from "@/components/PortfolioManager";
import ChartCredit from "@/components/ChartCredit";

/**
 * Portfolio data, and an honest list of what this build does not do.
 *
 * Not the web app's More page moved: that one carries the APK download link,
 * which is a route this build has no server for. What it shares is the part
 * that matters — the portfolio manager, which is where a first run imports a
 * Delta CSV, and the chart credit, which is a licence obligation rather than a
 * courtesy.
 */
const ABSENT = [
  ["Alerts", "Price rules are evaluated by the server build. Nothing here fires."],
  ["Home Assistant and push", "Both need a server to send from."],
  ["The risk metric, backtester and analyser", "The strategy tooling stays in the server build."],
  ["Sync", "There is none, by design. This portfolio and the server's are unrelated; the bridge is an export."],
];

export default function MorePage() {
  return (
    <main className="min-h-screen px-4 py-5 max-w-3xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <PageLabel icon={Database}>Portfolio data</PageLabel>
      </div>

      <div className="mb-8">
        <PortfolioManager />
      </div>

      {/*
        Said here rather than left to be discovered. The strategy document's R3
        asks for this in the README; the same argument applies inside the app,
        where someone is more likely to go looking for a feature than to read a
        file on GitHub.
      */}
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400 mb-2">
        What this build does not do
      </h2>
      <dl className="text-xs text-neutral-500 space-y-2 mb-2">
        {ABSENT.map(([what, why]) => (
          <div key={what}>
            <dt className="text-neutral-300">{what}</dt>
            <dd className="mt-0.5">{why}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-neutral-600">
        Everything else runs here, with no server and no network except the price feeds.
      </p>

      <ChartCredit />
    </main>
  );
}
