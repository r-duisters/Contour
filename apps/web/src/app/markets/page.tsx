"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, TrendingUp } from "lucide-react";
import PageLabel from "@/components/PageLabel";
import CoinIcon from "@/components/CoinIcon";
import EmptyState from "@/components/EmptyState";
import SubHeading from "@/components/SubHeading";
import Segmented from "@/components/Segmented";
import Sparkline from "@/components/Sparkline";
import { useDataClient } from "@/data/client/context";
import type { MarketBoard, MarketCategory, MarketRow } from "@/data/client/data-client";
import type { IndexSeries } from "@/data/sources/markets";
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
  // Per category: someone who opens the crypto strip has said nothing about
  // the stock one. Not persisted — a fresh visit starts from the two that
  // matter, and re-opening is one tap.
  const [expanded, setExpanded] = useState<Record<MarketCategory, boolean>>({
    crypto: false, stocks: false,
  });

  useEffect(() => {
    let live = true;
    // The previous category's board stays on screen while the next one is in
    // flight. Blanking to a spinner on every toggle makes a switch that takes
    // 400ms feel like a page load. For the same reason the failure notice is
    // cleared when the next board *arrives*, not when its request starts.
    client.getMarkets(category)
      .then((b) => { if (live) { setBoard(b); setFailed(false); } })
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

      {board && board.indices.length > 0 && (
        <IndexStrip
          indices={board.indices}
          open={expanded[category]}
          onToggle={() => setExpanded((e) => ({ ...e, [category]: !e[category] }))}
        />
      )}

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

/**
 * The market before its outliers: two cards, and the rest a tap down.
 *
 * Two because that is what fits above the fold without pushing the movers off
 * it — the whole point of the strip is to be read before them, not instead of
 * them. Every card is already loaded, so opening it costs no request and shows
 * no spinner.
 */
function IndexStrip({
  indices, open, onToggle,
}: {
  indices: IndexSeries[];
  open: boolean;
  onToggle: () => void;
}) {
  const [lead, rest] = [indices.slice(0, 2), indices.slice(2)];
  return (
    <section className="mb-6">
      <div className="grid grid-cols-2 gap-2.5">
        {lead.map((ix) => <IndexCard key={ix.label} index={ix} />)}
      </div>
      {open && rest.length > 0 && (
        <div className="grid grid-cols-2 gap-2.5 mt-2.5">
          {rest.map((ix) => <IndexCard key={ix.label} index={ix} />)}
        </div>
      )}
      {rest.length > 0 && (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="mt-2.5 w-full flex items-center justify-center gap-1.5 py-1.5
                     rounded border border-neutral-800/60 text-xs text-neutral-500"
        >
          {open ? "Less" : "More"}
          {!open && (
            <span className="rounded-full border border-neutral-800 px-1.5 text-[11px] tabular-nums">
              {rest.length}
            </span>
          )}
          <ChevronDown
            size={12}
            aria-hidden
            className={`transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
          />
        </button>
      )}
    </section>
  );
}

function IndexCard({ index }: { index: IndexSeries }) {
  const up = index.changePct >= 0;
  return (
    <div className="rounded-lg border border-neutral-800/60 bg-neutral-900/40 px-2.5 pt-2 pb-1.5 min-w-0">
      <div className="flex items-baseline justify-between gap-1.5">
        <span className="text-[11px] text-neutral-500 truncate">{index.label}</span>
        {/* A price only where somebody reads one. "S&P 500 7,674" is a level
            almost nobody holds in their head; a coin's price they do. */}
        {index.price !== undefined && (
          <span className="text-[11px] text-neutral-500 tabular-nums shrink-0">
            {marketMoney(index.price)}
          </span>
        )}
      </div>
      <Sparkline points={index.points} up={up} />
      <div className="flex items-baseline justify-between">
        <span className={`text-xs tabular-nums ${up ? "text-green-500" : "text-red-500"}`}>
          {percent(index.changePct)}
        </span>
        <span className="text-[11px] text-neutral-500">30d</span>
      </div>
    </div>
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
              <span className="w-4 text-[11px] text-neutral-500 tabular-nums shrink-0">{i + 1}</span>
            )}
            <CoinIcon symbol={r.symbol} size={20} assetType={r.assetType} />
            {/*
              Name leads, ticker beneath — the portfolio's row, at this list's
              density. The same asset read two ways on two screens was the last
              thing separating them. Crypto movers arrive with no name, so the
              ticker steps up rather than leaving the line empty; that is a
              fallback, not a second idiom.

              The cap rides on the sub-line rather than in a column of its own:
              a phone has no room for a fourth column, and a heading that says
              "largest by market cap" over a table with no cap in it asks the
              reader to take the ranking on trust.
            */}
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">{r.name ?? r.symbol}</span>
                {held.has(baseOf(r.symbol)) && (
                  <span className="text-[11px] uppercase tracking-wide text-neutral-500 shrink-0">Held</span>
                )}
              </span>
              {/* The ticker is only worth a line of its own when the name
                  above it is something else. A crypto mover arrives with no
                  name, so the primary is already the ticker and repeating it
                  underneath read as "PROM / PROM". */}
              {(r.name || (showCap && r.marketCap !== undefined)) && (
                <span className="block text-[11px] text-neutral-500 tabular-nums truncate">
                  {r.name && <span className="font-mono tracking-wider">{r.symbol}</span>}
                  {showCap && r.marketCap !== undefined && (
                    <>{r.name ? " · " : ""}{marketCap(r.marketCap)}</>
                  )}
                </span>
              )}
            </span>
            <span className="text-right shrink-0">
              <span className="block text-sm tabular-nums">{marketMoney(r.price)}</span>
              <span
                className={`block text-[11px] tabular-nums ${
                  r.changePct >= 0 ? "text-green-500" : "text-red-500"
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
