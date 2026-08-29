"use client";

import { APP_VERSION } from "@/lib/version";

/**
 * What the app is, who it owes, and under what terms.
 *
 * The TradingView credit lived at the bottom of the portfolio-data screen,
 * which is the wrong place for it twice over: it is not portfolio data, and it
 * is a **licence condition** rather than a courtesy — Lightweight Charts is
 * Apache-2.0 and asks for an attribution and a link on a page a user can
 * reach, which is why every chart in the app sets `attributionLogo: false`.
 * Something that must remain reachable belongs somewhere permanent.
 *
 * The licence line is here for the same reason. The repository is AGPL-3.0 as
 * of 2026-08-29, and a person running a modified copy for other people owes
 * them its source — a fact worth stating where they might look for it rather
 * than only in a file they may never open.
 *
 * `extra` is the one slot that differs by build: the desktop offers the
 * Android download, and the device has no server to fetch it from.
 */
export default function AboutSection({ extra }: { extra?: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400 mb-3">
        About
      </h2>

      <dl className="text-sm space-y-2 mb-4">
        <div className="flex items-baseline gap-3">
          <dt className="text-neutral-400">Version</dt>
          <dd className="ml-auto tabular-nums font-mono text-neutral-300">{APP_VERSION}</dd>
        </div>
        <div className="flex items-baseline gap-3">
          <dt className="text-neutral-400">Licence</dt>
          <dd className="ml-auto">
            <a
              href="https://www.gnu.org/licenses/agpl-3.0.html"
              target="_blank"
              rel="noreferrer noopener"
              className="text-blue-500"
            >
              AGPL-3.0
            </a>
          </dd>
        </div>
      </dl>

      {extra}

      <p className="text-xs text-neutral-500 max-w-prose">
        Charts by{" "}
        <a
          href="https://www.tradingview.com/"
          target="_blank"
          rel="noreferrer noopener"
          className="text-blue-500"
        >
          TradingView
        </a>{" "}
        — Lightweight Charts™, Copyright © 2023 TradingView, Inc. Prices from Binance,
        Yahoo Finance and CoinGecko; exchange rates from the ECB.
      </p>

      <p className="text-xs text-neutral-500 mt-3 max-w-prose">
        Run a modified copy as a service and you owe its users the source. Running it
        unmodified, or for yourself, asks nothing of you.
      </p>
    </section>
  );
}
