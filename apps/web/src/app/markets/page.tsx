"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TrendingUp } from "lucide-react";
import PageLabel from "@/components/PageLabel";
import CoinIcon from "@/components/CoinIcon";
import EmptyState from "@/components/EmptyState";
import SubHeading from "@/components/SubHeading";
import Segmented from "@/components/Segmented";
import { useDataClient } from "@/data/client/context";
import type { MarketBoard, MarketCategory, MarketRow } from "@/data/client/data-client";
import { marketCap, marketMoney, percent } from "@/lib/display";

/**
 * What the market did today, for people who are not looking at their own
 * holdings.
 *
 * Figures here deliberately ignore privacy mode. Hiding the price of Bitcoin
 * protects nothing — it is on every screen in the world — and masking it would
 * empty the page of the only thing it exists to show. `marketMoney` is the
 * non-masking formatter, and says so.
 */

const CATEGORIES = [
  { key: "crypto" as const, label: "Crypto" },
  { key: "stocks" as const, label: "Stocks" },
];

export default function MarketsPage() {
  const client = useDataClient();
  const [category, setCategory] = useState<MarketCategory>("crypto");
  const [board, setBoard] = useState<MarketBoard | null>(null);
  const [failed, setFailed] = useState(false);
  const [held, setHeld] = useState<Set<string>>(new Set());
  const [portfolioId, setPortfolioId] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setFailed(false);
    // The previous category's board stays on screen while the next one is in
    // flight. Blanking to a spinner on every toggle makes a switch that takes
    // 400ms feel like a page load.
    client.getMarkets(category)
      .then((b) => { if (live) setBoard(b); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [client, category]);

  // Which symbols the owner already holds, so a row can say so. Best-effort:
  // a failure here costs a marker, not the page.
  useEffect(() => {
    let live = true;
    client.listPortfolios()
      .then(async (rows) => {
        const id = rows[0]?.id;
        if (!id || !live) return;
        setPortfolioId(id);
        const v = await client.getValuation(id);
        if (!live) return;
        setHeld(new Set(v.holdings.map((h) => baseOf(h.symbol))));
      })
      .catch(() => {});
    return () => { live = false; };
  }, [client]);

  return (
    <main className="min-h-screen md:min-h-[calc(100vh-3.5rem)] px-4 py-5 md:p-8 max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-3">
        <PageLabel icon={TrendingUp}>Markets</PageLabel>
        <Segmented value={category} options={CATEGORIES} onChange={setCategory} />
      </div>

      {board && (
        <p className="text-xs text-neutral-500 mb-5">
          {board.source} · {new Date(board.at).toLocaleTimeString()}
        </p>
      )}

      {!board && failed && (
        <EmptyState>Could not reach the market data. Pull to refresh, or try again in a minute.</EmptyState>
      )}
      {!board && !failed && <EmptyState>Loading the board…</EmptyState>}

      {board && (
        <>
          <div className="grid gap-6 md:grid-cols-2 mb-8">
            <section>
              <SubHeading className="mb-2">Up today</SubHeading>
              <Rows rows={board.up} held={held} portfolioId={portfolioId} />
            </section>
            <section>
              <SubHeading className="mb-2">Down today</SubHeading>
              {board.down.length === 0
                ? <EmptyState>Nothing liquid is down today.</EmptyState>
                : <Rows rows={board.down} held={held} portfolioId={portfolioId} />}
            </section>
          </div>

          <section>
            <SubHeading className="mb-2">Largest by market cap</SubHeading>
            <Rows rows={board.largest} held={held} portfolioId={portfolioId} showCap ranked />
          </section>
        </>
      )}
    </main>
  );
}

/** BTCUSDT and BTC both mean Bitcoin; the board speaks base assets. */
function baseOf(symbol: string): string {
  const s = symbol.toUpperCase();
  return s.endsWith("USDT") && s.length > 4 ? s.slice(0, -4) : s;
}

function Rows({
  rows, held, portfolioId, showCap = false, ranked = false,
}: {
  rows: MarketRow[];
  held: Set<string>;
  portfolioId: string | null;
  showCap?: boolean;
  ranked?: boolean;
}) {
  if (rows.length === 0) return <EmptyState>Nothing to show.</EmptyState>;
  return (
    <ul className="divide-y divide-neutral-800/60">
      {rows.map((r, i) => (
        <li key={r.symbol}>
          <Link
            href={`/portfolio/${encodeURIComponent(r.symbol)}${portfolioId ? `?p=${portfolioId}` : ""}`}
            className="flex items-center gap-3 py-2.5"
          >
            {ranked && (
              <span className="w-4 text-xs text-neutral-600 tabular-nums shrink-0">{i + 1}</span>
            )}
            <CoinIcon symbol={r.symbol} size={20} assetType={r.assetType} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="font-mono text-sm">{r.symbol}</span>
                {held.has(baseOf(r.symbol)) && (
                  <span className="text-[10px] uppercase tracking-wide text-neutral-500">Held</span>
                )}
              </span>
              {(r.name || (showCap && r.marketCap !== undefined)) && (
                // The cap rides with the name rather than in a column of its
                // own: a phone has no room for a fourth column, and a heading
                // that says "largest by market cap" over a table with no cap
                // in it is asking the reader to take the ranking on trust.
                <span className="block text-xs text-neutral-500 truncate">
                  {r.name}
                  {showCap && r.marketCap !== undefined && (
                    <>{r.name ? " · " : ""}{marketCap(r.marketCap)}</>
                  )}
                </span>
              )}
            </span>
            <span className="text-right shrink-0">
              <span className="block text-sm tabular-nums">{marketMoney(r.price)}</span>
              <span
                className={`block text-xs tabular-nums ${
                  r.changePct >= 0 ? "text-emerald-500" : "text-red-500"
                }`}
              >
                {percent(r.changePct)}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
