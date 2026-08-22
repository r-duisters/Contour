"use client";

import { useCallback, useEffect, useState } from "react";
import TxForm from "@/components/TxForm";
import Link from "next/link";
import {
  ArrowUpDown, BarChart3, Plus, TrendingDown, TrendingUp, Wallet, X,
} from "lucide-react";
import CoinIcon from "@/components/CoinIcon";
import { money, quantity, setDisplayCurrency } from "@/lib/display";
import { useStoredRange } from "@/components/useStoredRange";
import { KEYS } from "@/lib/storage-keys";
import dynamic from "next/dynamic";
import RangePicker from "@/components/RangePicker";
import { RANGE_KEYS, type RangeKey } from "@/lib/ranges";

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
  side: "buy" | "sell" | "transfer_in" | "transfer_out";
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
  currency?: "USD" | "EUR";
  rate?: number;
};

// Formatting lives in lib/display so hiding amounts applies everywhere at once.
const fmtUsd = money;
const fmtQty = quantity;

export default function PortfolioPage() {
  const [portfolios, setPortfolios] = useState<PortfolioRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Tx[]>([]);
  const [valuation, setValuation] = useState<Valuation | null>(null);
  const [valuationLoading, setValuationLoading] = useState(false);
  const [stale, setStale] = useState<number | null>(null);
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

  const loadPortfolios = useCallback(async () => {
    const d = await fetch("/api/portfolios").then((r) => r.json());
    setPortfolios(d.portfolios);
    setSelectedId((cur) => cur ?? d.portfolios[0]?.id ?? null);
  }, []);
  useEffect(() => { loadPortfolios(); }, [loadPortfolios]);

  // Opening the app should show last night's numbers instantly, then correct
  // them, rather than a spinner over an empty screen.
  useEffect(() => {
    if (!selectedId) return;
    try {
      const raw = localStorage.getItem(`valuation:${selectedId}`);
      if (!raw) return;
      const cached = JSON.parse(raw) as { at: number; valuation: Valuation };
      setDisplayCurrency(cached.valuation.currency ?? "USD");
      setValuation((current) => current ?? cached.valuation);
      setStale(cached.at);
    } catch {
      // a corrupt cache is not worth reporting; the fetch will replace it
    }
  }, [selectedId]);

  const loadSelected = useCallback(async () => {
    if (!selectedId) { setTransactions([]); setValuation(null); setSeries(null); return; }
    setValuationLoading(true);
    const [detail, val] = await Promise.all([
      fetch(`/api/portfolios/${selectedId}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/portfolios/${selectedId}/valuation`).then((r) => (r.ok ? r.json() : null)),
    ]);
    setTransactions(detail?.portfolio.transactions ?? []);
    if (val) {
      setDisplayCurrency(val.currency ?? "USD");
      setValuation(val);
      setStale(null);
      try {
        localStorage.setItem(`valuation:${selectedId}`, JSON.stringify({ at: Date.now(), valuation: val }));
      } catch {
        // storage full or blocked: caching is an optimisation, not a feature
      }
    }
    setValuationLoading(false);
  }, [selectedId]);

  // The value history is slow to build, so it loads after the numbers and
  // refetches only when the selected range changes.
  useEffect(() => {
    if (!selectedId || !rangeReady) return;
    let cancelled = false;
    setSeries(null);
    fetch(`/api/portfolios/${selectedId}/series?range=${range}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: {
        series?: { t: number; value: number }[];
        change?: { abs: number; pct: number | null } | null;
      } | null) => {
        if (cancelled) return;
        setSeries(d?.series ?? []);
        setRangeChange(d?.change ?? null);
      })
      .catch(() => { if (!cancelled) { setSeries([]); setRangeChange(null); } });
    return () => { cancelled = true; };
  }, [selectedId, range, rangeReady]);
  useEffect(() => { loadSelected(); }, [loadSelected]);

  async function addTransaction(tx: Omit<Tx, "id" | "note">) {
    setFormError(null);
    const res = await fetch(`/api/portfolios/${selectedId}/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tx),
    });
    if (!res.ok) { setFormError("Failed to add transaction — check the fields."); return; }
    await loadSelected();
    await loadPortfolios();
  }

  // Per-asset price change over the selected period, so the rows speak about
  // the same window as the chart above them.
  useEffect(() => {
    if (!selectedId || !rangeReady) return;
    let cancelled = false;
    setAssetChanges({});
    fetch(`/api/portfolios/${selectedId}/changes?range=${range}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { changes?: Record<string, number> } | null) => {
        if (!cancelled) setAssetChanges(d?.changes ?? {});
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedId, range, rangeReady]);

  const allHoldings = valuation?.holdings ?? [];
  // A closed position has nothing left to decide about; it belongs in history,
  // not in the list you scan every morning.
  const closed = allHoldings.filter((h) => h.quantity <= 1e-12);
  const holdings = showClosed ? allHoldings : allHoldings.filter((h) => h.quantity > 1e-12);
  const totalValue = valuation?.totals.value ?? 0;
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
    <main className="min-h-screen md:min-h-[calc(100vh-3.5rem)] px-3 py-4 md:p-8 max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-4 md:mb-6">
        <span className="inline-flex items-center gap-2">
          <Wallet size={18} aria-hidden className="text-neutral-500" />
          <h1 className="text-sm font-semibold uppercase tracking-widest text-neutral-500">
            Portfolio
          </h1>
        </span>
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
          className="w-9 h-9 flex items-center justify-center rounded-full border border-neutral-800 text-neutral-400 active:bg-neutral-900"
        >
          {addOpen ? <X size={16} aria-hidden /> : <Plus size={16} aria-hidden />}
        </button>
        <Link
          href="/insights"
          aria-label="Insights"
          className="md:hidden w-9 h-9 flex items-center justify-center rounded-full border border-neutral-800 text-neutral-400 active:bg-neutral-900"
        >
          <BarChart3 size={16} aria-hidden />
        </Link>
      </div>

      {selectedId && (
        <>
          {valuation && (
            <>
              {/* The page answers one question: what is it worth, and what has
                  it done over the chosen period. Cost basis, realised P&L,
                  fees, unrealised P&L and cash are accounting, and live on
                  Insights. */}
              <header className="mb-6">
                <div className="text-[34px] md:text-[42px] font-semibold tracking-tight leading-none">
                  {fmtUsd(valuation.totals.value)}
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
              {stale !== null && (
                <p className="text-xs text-neutral-500 mb-3">
                  Showing values from {new Date(stale).toLocaleTimeString()} while refreshing…
                </p>
              )}
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

              {addOpen && (
                <div className="mb-6">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400 mb-2">
                    Add transaction
                  </h2>
                  <TxForm onSubmit={addTransaction} error={formError} />
                </div>
              )}
              {/* Rows carry no border or card: the draft separates them with
                  space alone, and the icon column does the aligning. */}
              <ul className="space-y-7 mb-8">
                {visibleHoldings.map((h) => {
                  const share = totalValue > 0 && h.value !== null ? (h.value / totalValue) * 100 : null;
                  const periodChange = assetChanges[h.symbol];
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
                          href={`/portfolio/${encodeURIComponent(h.symbol)}`}
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
                <p className="text-sm text-neutral-500 py-2 mb-6">No holdings yet — add a transaction below.</p>
              )}
            </>
          )}
          {valuationLoading && !valuation && (
            <p className="text-sm text-neutral-500 mb-8">Loading valuation…</p>
          )}

          <p className="text-xs text-neutral-500">
            {transactions.length} transactions · open a holding to see its own
          </p>
        </>
      )}
      {!selectedId && portfolios.length === 0 && (
        <p className="text-sm text-neutral-500">Create a portfolio to start tracking.</p>
      )}
    </main>
  );
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

