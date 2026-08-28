"use client";

import { useCallback, useEffect, useState } from "react";
import type { TxSide } from "@/lib/portfolio";
import TxForm, { type NewTx } from "@/components/TxForm";
import Sheet from "@/components/Sheet";
import Link from "next/link";
import {
  ArrowUpDown, BarChart3, Plus, TrendingDown, TrendingUp, Wallet, X,
} from "lucide-react";
import CoinIcon from "@/components/CoinIcon";
import PageLabel from "@/components/PageLabel";
import { useDataClient } from "@/data/client/context";
import { useAssetHref } from "@/components/routing";
import { money, quantity, setDisplayCurrency } from "@/lib/display";
import { changeFromPct } from "@/lib/change";
import { useStoredRange } from "@/components/useStoredRange";
import { KEYS } from "@/lib/storage-keys";
import dynamic from "next/dynamic";
import RangePicker from "@/components/RangePicker";
import { usePrivacy } from "@/components/usePrivacy";
import { useCachedValuation } from "@/components/useCachedValuation";
import { pruneRememberedPortfolio } from "@/lib/valuation-cache";
import StaleNote from "@/components/StaleNote";
import { RANGE_KEYS, type RangeKey } from "@/lib/ranges";
import EmptyState from "@/components/EmptyState";
import type { DisplayCurrency } from "@/lib/currencies";

// ~300 KB of charting: loaded after the figures are on screen, never on the
// server, so opening the app paints numbers immediately.
const ValueChart = dynamic(() => import("@/components/ValueChart"), {
  ssr: false,
  loading: () => <div className="h-56 md:h-64 border border-neutral-800 rounded" />,
});

type PortfolioRow = { id: string; name: string; transactionCount: number };

type Tx = {
  id: string;
  symbol: string;
  side: TxSide;
  quantity: number;
  price: number;
  fee: number;
  time: number;
  note: string | null;
};

type SortKey = "value" | "pnlPct" | "pnl" | "realized" | "quantity" | "symbol";

type ValuedHolding = {
  symbol: string;
  assetType?: "crypto" | "equity" | "cash";
  dayChange?: DayChange | null;
  unreliable?: boolean;
  name?: string | null;
  quantity: number;
  avgCost: number;
  costBasis: number;
  realizedPnl: number;
  fees: number;
  price: number | null;
  value: number | null;
  unrealizedPnl: number | null;
};

type DayChange = { abs: number; pct: number };




type Valuation = {
  holdings: ValuedHolding[];
  totals: {
    value: number; costBasis: number; unrealizedPnl: number; realizedPnl: number; fees: number;
    cash?: number; invested?: number;
    dayChange: (DayChange & { covered: number }) | null;
  };
  currency?: DisplayCurrency;
  rate?: number;
};

// Formatting lives in lib/display so hiding amounts applies everywhere at once.
const fmtUsd = money;
const fmtQty = quantity;

export default function PortfolioScreen() {
  const client = useDataClient();
  const assetHref = useAssetHref();
  const [portfolios, setPortfolios] = useState<PortfolioRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Tx[]>([]);
  const [valuation, setValuation] = useState<Valuation | null>(null);
  // Whether the valuation request has settled. The chart and the per-row
  // changes wait on it: see the note on the series effect below.
  const [primed, setPrimed] = useState(false);
  const [valuationLoading, setValuationLoading] = useState(false);
  const [valuationError, setValuationError] = useState<string | null>(null);
  const [series, setSeries] = useState<{ t: number; value: number }[] | null>(null);
  // Opening the app asks "what happened today" — unless a period was chosen
  // before, in which case it asks that again.
  const [range, setRange, rangeReady] = useStoredRange<RangeKey>(
    KEYS.rangePortfolio, "1d", RANGE_KEYS,
  );
  const [rangeChange, setRangeChange] = useState<{ abs: number; pct: number | null } | null>(null);
  const [assetChanges, setAssetChanges] = useState<Record<string, number>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [showClosed, setShowClosed] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [assetTab, setAssetTab] = useState<"all" | "crypto" | "equity" | "cash">("all");
  usePrivacy(); // re-render when amounts are hidden or shown

  const loadPortfolios = useCallback(async () => {
    // Matches the other four list-portfolios sites: a failed list leaves the
    // screen as it was rather than rejecting into an unhandled promise.
    const rows = await client.listPortfolios().catch(() => null);
    if (!rows) return;
    // The home screen is the one every launch passes through, so it is where a
    // pointer at a deleted portfolio gets cleared. Without this, a portfolio
    // removed before the cleanup existed keeps the ledger and asset screens
    // showing its holdings for good: they open on the remembered id, and the
    // fetch that should correct them answers "not found", which a screen
    // falling back to its cache cannot tell from "not yet".
    pruneRememberedPortfolio(localStorage, rows.map((p) => p.id), KEYS.lastPortfolio);
    setPortfolios(rows);
    setSelectedId((cur) => cur ?? rows[0]?.id ?? null);
  }, [client]);
  useEffect(() => { loadPortfolios(); }, [loadPortfolios]);

  // Opening the app should show last night's numbers instantly, then correct
  // them, rather than a spinner over an empty screen.
  const { cached, at: stale, remember } = useCachedValuation<Valuation>(selectedId);
  // Set during render, not in an effect: `money()` reads a module variable
  // rather than React state, so an effect would run after the figures below
  // had already been formatted — and with the cache derived rather than
  // copied into state there is no second render to correct them. The call is
  // an idempotent assignment, so repeating it costs nothing.
  if (cached?.currency) setDisplayCurrency(cached.currency);
  // Derived, not copied into state: the cache is a fallback for what has not
  // arrived yet, and holding the same figures in two places is how the two
  // disagree.
  const shown = valuation ?? cached;

  const loadSelected = useCallback(async () => {
    if (!selectedId) { setTransactions([]); setValuation(null); setSeries(null); return; }
    setValuationLoading(true);
    setPrimed(false);
    // Two requests in flight at once, each falling back to null on its own:
    // the valuation is the slow one, and holding the ledger behind it would
    // leave the table blank for as long as the prices take.
    let failure: string | null = null;
    const [detail, val] = await Promise.all([
      client.getPortfolio(selectedId).catch(() => null),
      // The reason is kept, not discarded. A valuation that fails with a
      // cache behind it is invisible by design — yesterday's numbers are
      // better than a spinner — but with nothing cached the screen used to
      // draw its header, its transaction count and no holdings at all, which
      // reads as an empty portfolio rather than as a failure. That is how a
      // Map lost to JSON in the persisted cache stayed hidden.
      client.getValuation(selectedId).catch((e: unknown) => {
        failure = e instanceof Error ? e.message : String(e);
        return null;
      }),
    ]);
    setValuationError(failure);
    setTransactions(detail?.transactions ?? []);
    if (val) {
      setDisplayCurrency(val.currency ?? "USD");
      setValuation(val);
      remember(selectedId, val);
    }
    setValuationLoading(false);
    // Settled, not succeeded: a failed valuation must still release the
    // requests below, or one bad response leaves the chart blank for good.
    setPrimed(true);
  }, [client, selectedId, remember]);

  /**
   * The value history is slow to build, so it waits for the numbers and
   * refetches only when the selected range changes.
   *
   * It used to say that and not do it: this fired the moment an id existed, in
   * parallel with the valuation, and the two then competed for one server —
   * Node runs the handlers on a single thread, and both fan out to the same
   * price feeds. Measured cold on the real ledger, the headline figure took
   * 3.65s racing the chart and 1.82s once the chart waited its turn. The chart
   * arrived sooner too, at 2.53s against 5.50s.
   *
   * `primed` is what makes waiting real. It is the valuation request having
   * *settled*, not having succeeded.
   */
  useEffect(() => {
    if (!selectedId || !rangeReady || !primed) return;
    let cancelled = false;
    setSeries(null);
    client.getSeries(selectedId, range)
      .then((d) => {
        if (cancelled) return;
        setSeries(d.series);
        // A portfolio holding nothing priceable answers with the thin shape,
        // which carries no period change at all.
        setRangeChange("change" in d ? d.change : null);
      })
      .catch(() => { if (!cancelled) { setSeries([]); setRangeChange(null); } });
    return () => { cancelled = true; };
  }, [client, selectedId, range, rangeReady, primed]);
  useEffect(() => { loadSelected(); }, [loadSelected]);

  // Takes the form's own type, not this page's display row. They differ by
  // exactly the two fields cash and income need — `assetType` and
  // `sourceSymbol` — and the narrower signature carried them at runtime while
  // claiming not to, which is how a field gets parsed and silently dropped.
  async function addTransaction(tx: NewTx) {
    setFormError(null);
    // With nothing selected this used to post to a route that answered 404 and
    // land in the message below; the client needs a real id, so the check is
    // explicit and the outcome is the same sentence.
    try {
      if (!selectedId) throw new Error("no portfolio selected");
      await client.addTransaction(selectedId, tx);
    } catch {
      setFormError("Failed to add transaction — check the fields.");
      return;
    }
    await loadSelected();
    await loadPortfolios();
  }

  // Per-asset price change over the selected period, so the rows speak about
  // the same window as the chart above them. Waits on the valuation for the
  // same reason the chart does — the rows it decorates are not on screen
  // until the valuation supplies them.
  useEffect(() => {
    if (!selectedId || !rangeReady || !primed) return;
    let cancelled = false;
    setAssetChanges({});
    client.getChanges(selectedId, range)
      .then((d) => { if (!cancelled) setAssetChanges(d.changes); })
      // Silent: the rows already reset to {} above, and a missing period
      // change is not worth an error beside real prices.
      .catch(() => {});
    return () => { cancelled = true; };
  }, [client, selectedId, range, rangeReady, primed]);

  const allHoldings = shown?.holdings ?? [];
  // A closed position has nothing left to decide about; it belongs in history,
  // not in the list you scan every morning.
  const closed = allHoldings.filter((h) => h.quantity <= 1e-12);
  const holdings = showClosed ? allHoldings : allHoldings.filter((h) => h.quantity > 1e-12);
  const totalValue = shown?.totals.value ?? 0;
  const sortedHoldings = [...holdings].sort((a, b) => {
    const pct = (h: ValuedHolding) =>
      h.costBasis > 0 && h.unrealizedPnl !== null ? h.unrealizedPnl / h.costBasis : -Infinity;
    switch (sortKey) {
      case "symbol": return a.symbol.localeCompare(b.symbol);
      case "quantity": return b.quantity - a.quantity;
      case "pnl": return (b.unrealizedPnl ?? -Infinity) - (a.unrealizedPnl ?? -Infinity);
      case "realized": return b.realizedPnl - a.realizedPnl;
      case "pnlPct": return pct(b) - pct(a);
      default: return (b.value ?? -Infinity) - (a.value ?? -Infinity);
    }
  });

  const periodWord = {
    "1d": "today", "1w": "this week", "1m": "1M", ytd: "YTD",
    "1y": "1Y", "2y": "2Y", "5y": "5Y", all: "all time",
  }[range];

  const crypto = sortedHoldings.filter((h) => (h.assetType ?? "crypto") === "crypto");
  const equities = sortedHoldings.filter((h) => h.assetType === "equity");
  const cash = sortedHoldings.filter((h) => h.assetType === "cash");
  const tabs = [
    { key: "all" as const, label: "All", items: sortedHoldings },
    { key: "crypto" as const, label: "Crypto", items: crypto },
    { key: "equity" as const, label: "Stocks & ETFs", items: equities },
    { key: "cash" as const, label: "Cash", items: cash },
  ].filter((t) => t.key === "all" || t.items.length > 0);
  const visibleHoldings = (tabs.find((t) => t.key === assetTab) ?? tabs[0]!).items;

  return (
    <main className="min-h-screen md:min-h-[calc(100vh-3.5rem)] px-3 py-4 md:p-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 mb-4 md:mb-6">
        <PageLabel icon={Wallet}>Portfolio</PageLabel>
        <span className="flex-1" />
        {portfolios.length > 1 && (
          <select
            aria-label="Portfolio"
            className="bg-neutral-900 border border-neutral-800 rounded-full px-3 py-1 text-xs text-neutral-400"
            value={selectedId ?? ""}
            onChange={(e) => setSelectedId(e.target.value || null)}
          >
            {portfolios.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
        <button
          onClick={() => setAddOpen((v) => !v)}
          aria-label={addOpen ? "Close add transaction" : "Add transaction"}
          aria-expanded={addOpen}
          className="w-11 h-11 flex items-center justify-center rounded-full border border-neutral-800 text-neutral-400 active:bg-neutral-900"
        >
          {addOpen ? <X size={16} aria-hidden /> : <Plus size={16} aria-hidden />}
        </button>
        <Link
          href="/insights"
          aria-label="Insights"
          className="md:hidden w-11 h-11 flex items-center justify-center rounded-full border border-neutral-800 text-neutral-400 active:bg-neutral-900"
        >
          <BarChart3 size={16} aria-hidden />
        </Link>
      </div>

      {selectedId && (
        <>
          {shown && (
            <>
              {/* The page answers one question: what is it worth, and what has
                  it done over the chosen period. Cost basis, realised P&L,
                  fees, unrealised P&L and cash are accounting, and live on
                  Insights. */}
              <header className="mb-6">
                <div className="text-[34px] md:text-[42px] font-semibold tracking-tight leading-none">
                  {fmtUsd(shown.totals.value)}
                </div>
                {rangeChange && (
                  <div className="flex items-center gap-2 text-sm mt-1.5">
                    <span className={`font-medium inline-flex items-center gap-1 ${
                      rangeChange.abs >= 0 ? "text-green-500" : "text-red-500"
                    }`}>
                      {rangeChange.abs >= 0
                        ? <TrendingUp size={14} aria-hidden />
                        : <TrendingDown size={14} aria-hidden />}
                      {rangeChange.pct !== null && (
                        <>{rangeChange.pct >= 0 ? "+" : ""}{rangeChange.pct.toFixed(2)}%</>
                      )}
                      <span>{fmtUsd(rangeChange.abs)}</span>
                    </span>
                    <span
                      className="text-neutral-500"
                      title="Value movement over the period. Money added or withdrawn in that time counts towards it."
                    >
                      {periodWord}
                    </span>
                  </div>
                )}
              </header>
              <StaleNote at={stale} />
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <RangePicker value={range} onChange={setRange} />
              </div>
              <div className="mb-6 md:mb-8">
                <ValueChart series={series} />
              </div>

              <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
                  Holdings
                </h2>
                {tabs.length > 2 && (
                  <div className="flex items-center gap-4 text-xs font-medium text-neutral-500">
                    {tabs.map((t) => (
                      <button
                        key={t.key}
                        onClick={() => setAssetTab(t.key)}
                        aria-pressed={assetTab === t.key}
                        className={assetTab === t.key
                          ? "text-blue-500 border-b border-blue-500 pb-0.5"
                          : "pb-0.5 border-b border-transparent"}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Sort belongs with the list it orders, not in the heading row:
                  the design puts the filter there, and three controls on one
                  line at 390px leaves none of them room. */}
              <div className="flex justify-end mb-3">
                <label className="text-xs text-neutral-500 inline-flex items-center gap-1">
                  <ArrowUpDown size={12} aria-hidden />
                  <span className="sr-only">Sort holdings by</span>
                  <select
                    className="bg-transparent text-xs text-neutral-400 border-0 p-0 pr-4"
                    value={sortKey}
                    onChange={(e) => setSortKey(e.target.value as SortKey)}
                  >
                    <option value="value">value</option>
                    <option value="pnlPct">gain %</option>
                    <option value="pnl">unrealised P&L</option>
                    <option value="realized">realised P&L</option>
                    <option value="quantity">quantity</option>
                    <option value="symbol">name</option>
                  </select>
                </label>
              </div>

              <Sheet open={addOpen} onClose={() => setAddOpen(false)} title="Add a transaction">
                <div className="p-3">
                  <TxForm onSubmit={addTransaction} error={formError} />
                </div>
              </Sheet>
              {/* Rows carry no border or card: the draft separates them with
                  space alone, and the icon column does the aligning. */}
              <ul className="space-y-7 mb-8">
                {visibleHoldings.map((h) => {
                  const share = totalValue > 0 && h.value !== null ? (h.value / totalValue) * 100 : null;
                  const periodChange = assetChanges[h.symbol];
                  const periodMoney = changeFromPct(h.value, periodChange ?? null);
                  const isCash = h.assetType === "cash";
                  const inner = (
                    <>
                      {isCash ? (
                        <span className="w-10 h-10 rounded-full bg-neutral-800 text-[11px] font-medium
                                         flex items-center justify-center shrink-0 text-neutral-300">
                          {h.symbol.slice(0, 3)}
                        </span>
                      ) : (
                        <CoinIcon symbol={h.symbol} size={40} assetType={h.assetType} />
                      )}
                      <span className="flex-1 min-w-0 flex flex-col justify-center">
                        <span className="flex items-baseline justify-between gap-3 mb-0.5">
                          <span className="text-base font-medium truncate">
                            {h.name ?? h.symbol}{isCash && " cash"}
                          </span>
                          <span className="text-base tabular-nums tracking-tight shrink-0">
                            {h.unreliable ? (
                              <span className="text-amber-500 text-xs">not counted</span>
                            ) : h.value !== null ? fmtUsd(h.value) : "—"}
                          </span>
                        </span>
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="text-[11px] text-neutral-500 tabular-nums truncate">
                            <span className="font-mono tracking-wider">{h.symbol}</span>
                            {" · "}{fmtQty(h.quantity)}
                            {share !== null && <> · {share.toFixed(1)}%</>}
                          </span>
                          <span className="text-[11px] shrink-0">
                            {periodChange !== undefined ? (
                              <span className={periodChange >= 0 ? "text-green-500" : "text-red-500"}>
                                {periodChange >= 0 ? "+" : ""}{periodChange.toFixed(1)}%
                                {/* What that move is worth on this holding. Absent
                                    where there is no value to apply it to, rather
                                    than shown as a misleading zero. */}
                                {periodMoney !== null && (
                                  <> <span className="tabular-nums">
                                    {periodMoney >= 0 ? "+" : ""}{fmtUsd(periodMoney)}
                                  </span></>
                                )}
                              </span>
                            ) : h.price === null ? (
                              <span className={h.quantity > 0 ? "text-amber-500" : "text-neutral-500"}>
                                no price
                              </span>
                            ) : null}
                          </span>
                        </span>
                      </span>
                    </>
                  );
                  return (
                    <li key={h.symbol}>
                      {isCash ? (
                        <div className="flex items-center gap-4">{inner}</div>
                      ) : (
                        <Link
                          // The kind travels with the link because this row knows it and the
                          // asset page would otherwise have to guess from the ticker —
                          // and a bare coin name like ETH looks exactly like a stock.
                          href={assetHref(h.symbol, h.assetType)
                            + `&p=${encodeURIComponent(selectedId ?? "")}`}
                          className="flex items-center gap-4 active:opacity-70 transition-opacity"
                        >
                          {inner}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
              {closed.length > 0 && (
                <button onClick={() => setShowClosed((v) => !v)}
                        className="text-xs text-neutral-500 underline mb-6">
                  {showClosed
                    ? `Hide ${closed.length} closed positions`
                    : `Show ${closed.length} closed positions`}
                </button>
              )}
              {sortedHoldings.length === 0 && (
                <EmptyState className="py-2 mb-6">No holdings yet — add a transaction below.</EmptyState>
              )}
            </>
          )}
          {valuationLoading && !shown && (
            <p className="text-sm text-neutral-500 mb-8">Loading valuation…</p>
          )}
          {/*
            Amber, per BRAND.md's rule for degraded data. Holdings absent
            because nothing could be worked out is a different fact from a
            portfolio holding nothing, and the transaction count below makes
            the difference obvious once it is said.
          */}
          {!valuationLoading && !shown && (
            <p className="text-sm text-amber-500 mb-8">
              Could not work out what this portfolio is worth.
              {valuationError ? ` ${valuationError}` : ""}
            </p>
          )}

          <p className="text-xs text-neutral-500">
            {transactions.length} transactions · open a holding to see its own
          </p>
        </>
      )}
      {/*
        First run, and the only screen a fresh install opens on. It used to be
        a bare sentence with nothing to act on — true, and a dead end. Both
        paths the plan names live on the same screen, so one link serves both:
        start empty, or import a Delta export.
      */}
      {!selectedId && portfolios.length === 0 && (
        <EmptyState>
          Nothing here yet.{" "}
          <Link href="/more" className="text-blue-500">Create a portfolio</Link>{" "}
          to start tracking, or import a Delta export into it.
        </EmptyState>
      )}
    </main>
  );
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

