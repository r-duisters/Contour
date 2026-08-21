"use client";

import { useCallback, useEffect, useState } from "react";
import SymbolPicker from "@/components/SymbolPicker";
import Link from "next/link";
import {
  ArrowUpDown, BarChart3, ChevronRight, Plus, TrendingDown, TrendingUp, Wallet,
} from "lucide-react";
import CoinIcon from "@/components/CoinIcon";
import { money, quantity, setDisplayCurrency } from "@/lib/display";
import { usePrivacy } from "@/components/usePrivacy";
import dynamic from "next/dynamic";

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

const RANGES = [
  { key: "1d", label: "1D" }, { key: "1w", label: "1W" }, { key: "1m", label: "1M" },
  { key: "ytd", label: "YTD" }, { key: "1y", label: "1Y" }, { key: "2y", label: "2Y" },
  { key: "5y", label: "5Y" }, { key: "all", label: "All" },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];


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
  // Opening the app asks "what happened today", not "how did nine years go".
  const [range, setRange] = useState<RangeKey>("1d");
  const [rangeChange, setRangeChange] = useState<{ abs: number; pct: number | null } | null>(null);
  const [assetChanges, setAssetChanges] = useState<Record<string, number>>({});
  const [mwr, setMwr] = useState<{ annualPct: number | null; investedNet: number; closing: number } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const hideAmounts = usePrivacy();
  const [showClosed, setShowClosed] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
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
    if (!selectedId) return;
    let cancelled = false;
    setSeries(null);
    fetch(`/api/portfolios/${selectedId}/series?range=${range}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: {
        series?: { t: number; value: number }[];
        change?: { abs: number; pct: number | null } | null;
        mwr?: { annualPct: number | null; investedNet: number; closing: number };
      } | null) => {
        if (cancelled) return;
        setSeries(d?.series ?? []);
        setRangeChange(d?.change ?? null);
        setMwr(d?.mwr ?? null);
      })
      .catch(() => { if (!cancelled) { setSeries([]); setRangeChange(null); } });
    return () => { cancelled = true; };
  }, [selectedId, range]);
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
    if (!selectedId) return;
    let cancelled = false;
    setAssetChanges({});
    fetch(`/api/portfolios/${selectedId}/changes?range=${range}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { changes?: Record<string, number> } | null) => {
        if (!cancelled) setAssetChanges(d?.changes ?? {});
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedId, range]);

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

  const rangeLabel = {
    "1d": "today", "1w": "this week", "1m": "1M", ytd: "YTD",
    "1y": "1Y", "2y": "2Y", "5y": "5Y", all: "all time",
  }[range];

  const crypto = sortedHoldings.filter((h) => (h.assetType ?? "crypto") === "crypto");
  const equities = sortedHoldings.filter((h) => h.assetType === "equity");
  const cash = sortedHoldings.filter((h) => h.assetType === "cash");
  const classValue = (items: ValuedHolding[]) => sum(items.map((h) => h.value ?? 0));
  const tabs = [
    { key: "all" as const, label: "All", items: sortedHoldings },
    { key: "crypto" as const, label: "Crypto", items: crypto },
    { key: "equity" as const, label: "Stocks & ETFs", items: equities },
    { key: "cash" as const, label: "Cash", items: cash },
  ].filter((t) => t.key === "all" || t.items.length > 0);
  const visibleHoldings = (tabs.find((t) => t.key === assetTab) ?? tabs[0]!).items;

  return (
    <main className="min-h-screen px-3 py-4 md:p-8 max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-4 md:mb-6">
        <h1 className="text-xl md:text-2xl font-semibold flex items-center gap-2">
          <Wallet size={20} aria-hidden className="text-neutral-400" />Portfolio
        </h1>
        <span className="flex-1" />
        {portfolios.length > 1 && (
          <select
            className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs"
            value={selectedId ?? ""}
            onChange={(e) => setSelectedId(e.target.value || null)}
          >
            {portfolios.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
        <button onClick={() => setAddOpen((v) => !v)}
                className="text-xs text-neutral-300 inline-flex items-center gap-1 border border-neutral-700 rounded px-2 py-1">
          <Plus size={12} aria-hidden />{addOpen ? "Close" : "Add"}
        </button>
        <a href="/insights" className="text-xs text-neutral-400 inline-flex items-center gap-1 border border-neutral-800 rounded px-2 py-1">
          <BarChart3 size={12} aria-hidden />Insights
        </a>
      </div>

      {selectedId && (
        <>
          {valuation && (
            <>
              <div className="grid grid-cols-2 gap-2 md:gap-3 mb-3">
                <Stat label="Value" value={fmtUsd(valuation.totals.value)} big
                      sub={valuation.totals.dayChange && (
                        <DayBadge change={valuation.totals.dayChange} label="today" />
                      )} />
                <Stat label="Unrealised P&L" value={fmtUsd(valuation.totals.unrealizedPnl)}
                      signed={valuation.totals.unrealizedPnl} big
                      sub={valuation.totals.costBasis > 0 ? (
                        <span className="text-xs text-neutral-500">
                          {((valuation.totals.unrealizedPnl / valuation.totals.costBasis) * 100).toFixed(1)}% on cost
                        </span>
                      ) : undefined} />
              </div>
              <div className={`${statsOpen ? "grid" : "hidden"} md:grid grid-cols-2 md:grid-cols-4 gap-3 mb-3`}>
                {typeof valuation.totals.cash === "number" && valuation.totals.cash !== 0 && (
                  <Stat label="Cash" value={fmtUsd(valuation.totals.cash)} />
                )}
                <Stat label="Cost basis" value={fmtUsd(valuation.totals.costBasis)} />
                <Stat label="Realized P&L" value={fmtUsd(valuation.totals.realizedPnl)} signed={valuation.totals.realizedPnl} />
                <Stat label="Fees paid" value={fmtUsd(valuation.totals.fees)} />
              </div>
              <button onClick={() => setStatsOpen((v) => !v)}
                      className="md:hidden text-xs text-neutral-500 underline mb-6">
                {statsOpen ? "Hide details" : "Show cost basis, realized P&L, fees"}
              </button>
              {stale !== null && (
                <p className="text-xs text-neutral-500 mb-3">
                  Showing values from {new Date(stale).toLocaleTimeString()} while refreshing…
                </p>
              )}
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <div className="flex gap-1 flex-wrap">
                  {RANGES.map((r) => (
                    <button
                      key={r.key}
                      onClick={() => setRange(r.key)}
                      className={`px-2 py-1 text-xs rounded ${
                        range === r.key
                          ? "bg-neutral-800 text-neutral-100"
                          : "text-neutral-500 hover:text-neutral-300"
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                <span className="flex-1" />
                {rangeChange && (
                  <span
                    title="Value movement over the period. Money added or withdrawn in that time counts towards it."
                    className={`text-sm inline-flex items-center gap-1 ${
                      rangeChange.abs >= 0 ? "text-green-500" : "text-red-500"
                    }`}
                  >
                    {rangeChange.abs >= 0 ? <TrendingUp size={14} aria-hidden /> : <TrendingDown size={14} aria-hidden />}
                    {rangeChange.pct !== null && (
                      <>{rangeChange.pct >= 0 ? "+" : ""}{rangeChange.pct.toFixed(2)}% </>
                    )}
                    ({fmtUsd(rangeChange.abs)})
                    <span className="text-neutral-500">
                      {RANGES.find((r) => r.key === range)?.label}
                    </span>
                  </span>
                )}
              </div>
              {mwr && mwr.annualPct !== null && (
                <p className="text-xs text-neutral-500 mb-2">
                  Money-weighted return{" "}
                  <span className={mwr.annualPct >= 0 ? "text-green-500" : "text-red-500"}>
                    {mwr.annualPct >= 0 ? "+" : ""}{mwr.annualPct.toFixed(2)}%/yr
                  </span>
                  {" "}on {fmtUsd(mwr.investedNet)} net invested, now worth {fmtUsd(mwr.closing)}
                </p>
              )}
              <div className="mb-6 md:mb-8">
                <ValueChart series={series} hideValues={hideAmounts} />
              </div>

              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <h2 className="text-lg font-medium">Holdings</h2>
                <span className="text-xs text-neutral-500">({sortedHoldings.length})</span>
                <span className="flex-1" />
                <label className="text-xs text-neutral-500 inline-flex items-center gap-1">
                  <ArrowUpDown size={12} aria-hidden />
                  sort
                  <select
                    className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs"
                    value={sortKey}
                    onChange={(e) => setSortKey(e.target.value as SortKey)}
                  >
                    <option value="value">value</option>
                    <option value="pnlPct">gain %</option>
                    <option value="pnl">unrealized P&L</option>
                    <option value="realized">realized P&L</option>
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
              {tabs.length > 2 && (
                <div className="flex gap-1 mb-3 border-b border-neutral-800 overflow-x-auto">
                  {tabs.map((t) => (
                    <button
                      key={t.key}
                      onClick={() => { setAssetTab(t.key); }}
                      className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${
                        assetTab === t.key
                          ? "border-blue-500 text-neutral-100"
                          : "border-transparent text-neutral-500"
                      }`}
                    >
                      {t.label}
                      <span className="text-xs text-neutral-500 ml-1.5">{t.items.length}</span>
                      {t.key !== "all" && (
                        <span className="text-xs text-neutral-500 ml-1.5">
                          · {fmtUsd(classValue(t.items))}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              <ul className="space-y-1 mb-6">
                {visibleHoldings.map((h) => {
                  const share = totalValue > 0 && h.value !== null ? (h.value / totalValue) * 100 : null;
                  const periodChange = assetChanges[h.symbol];
                  const pct = h.costBasis > 0 && h.unrealizedPnl !== null
                    ? (h.unrealizedPnl / h.costBasis) * 100 : null;
                  return (
                    <li key={h.symbol} className="bg-neutral-900 border border-neutral-800 rounded">
                      {h.assetType === "cash" ? (
                        <div className="w-full p-3 flex items-center gap-3">
                          <span className="w-[22px] h-[22px] rounded-full bg-neutral-700 text-[10px] flex items-center justify-center shrink-0">
                            {h.symbol.slice(0, 3)}
                          </span>
                          <span className="min-w-0">
                            <span className="font-mono font-medium block truncate">{h.symbol} cash</span>
                            <span className="text-xs text-neutral-500">
                              {fmtQty(h.quantity)}
                              {share !== null && <> · {share.toFixed(1)}%</>}
                            </span>
                          </span>
                          <span className="flex-1" />
                          <span className="text-right">
                            {h.unreliable ? (
                              <span className="text-amber-500 text-xs">
                                not counted · export missing deposits
                              </span>
                            ) : h.value !== null ? fmtUsd(h.value) : "—"}
                          </span>
                        </div>
                      ) : (
                      <Link
                        href={`/portfolio/${encodeURIComponent(h.symbol)}`}
                        className="w-full text-left p-3 flex items-center gap-3"
                      >
                        <CoinIcon symbol={h.symbol} size={28} assetType={h.assetType} />
                        <span className="min-w-0">
                          <span className="font-mono font-medium block truncate">{h.symbol}</span>
                          <span className="text-xs text-neutral-500">
                            {fmtQty(h.quantity)}
                            {share !== null && <> · {share.toFixed(1)}%</>}
                          </span>
                        </span>
                        <span className="flex-1" />
                        <span className="text-right">
                          <span className="block">{h.value !== null ? fmtUsd(h.value) : "—"}</span>
                          <span className="text-xs flex items-center justify-end gap-2">
                            {periodChange !== undefined ? (
                              <span className={periodChange >= 0 ? "text-green-500" : "text-red-500"}>
                                {periodChange >= 0 ? "+" : ""}{periodChange.toFixed(1)}% {rangeLabel}
                              </span>
                            ) : h.price === null ? (
                              <span className={h.quantity > 0 ? "text-amber-500" : "text-neutral-500"}>
                                no price
                              </span>
                            ) : null}
                            {pct !== null && (
                              <span className="text-neutral-500">
                                {pct >= 0 ? "+" : ""}{pct.toFixed(1)}% on cost
                              </span>
                            )}
                          </span>
                        </span>
                        <ChevronRight size={16} aria-hidden className="text-neutral-500" />
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

function DayBadge({ change, label }: { change: { abs: number; pct: number }; label: string }) {
  const up = change.pct >= 0;
  return (
    <span className={`text-xs inline-flex items-center gap-1 ${up ? "text-green-500" : "text-red-500"}`}>
      {up ? <TrendingUp size={12} aria-hidden /> : <TrendingDown size={12} aria-hidden />}
      {up ? "+" : ""}{change.pct.toFixed(2)}% ({fmtUsd(change.abs)}) {label}
    </span>
  );
}

function Stat({ label, value, signed, big, sub }: {
  label: string; value: string; signed?: number; big?: boolean; sub?: React.ReactNode;
}) {
  const color =
    signed === undefined ? "text-neutral-200"
    : signed > 0 ? "text-green-500"
    : signed < 0 ? "text-red-500"
    : "text-neutral-200";
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded p-3">
      <div className="text-xs text-neutral-500 mb-1">{label}</div>
      <div className={`${big ? "text-xl" : "text-base"} font-medium ${color} flex items-center gap-1.5`}>
        {signed !== undefined && signed > 0 && <TrendingUp size={16} aria-hidden />}
        {signed !== undefined && signed < 0 && <TrendingDown size={16} aria-hidden />}
        {value}
      </div>
      {sub && <div className="mt-0.5">{sub}</div>}
    </div>
  );
}

/** "now" in the shape a datetime-local input wants, in local time. */
function localNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function TxForm({
  onSubmit, error,
}: {
  onSubmit: (tx: { symbol: string; side: Tx["side"]; quantity: number; price: number; fee: number; time: number }) => void;
  error: string | null;
}) {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [side, setSide] = useState<Tx["side"]>("buy");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [fee, setFee] = useState("");
  const [when, setWhen] = useState("");

  // Filled after mount: a timestamp rendered on the server would not match the
  // client's, and it must be the phone's local time, not UTC.
  useEffect(() => {
    if (when === "") setWhen(localNow());
  }, [when]);

  function submit() {
    const q = Number(quantity);
    const p = Number(price);
    const f = fee === "" ? 0 : Number(fee);
    const t = new Date(when).getTime();
    if (!symbol || !Number.isFinite(q) || q <= 0 || !Number.isFinite(p) || p < 0 || !Number.isFinite(t)) return;
    onSubmit({ symbol: symbol.toUpperCase(), side, quantity: q, price: p, fee: f, time: t });
    setQuantity(""); setPrice(""); setFee(""); setWhen(localNow());
  }

  const input = "bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm";
  return (
    <div className="mb-4">
      <div className="flex gap-2 flex-wrap items-center">
        <SymbolPicker className={`${input} uppercase w-28`} value={symbol} onChange={setSymbol} />
        <select className={input} value={side} onChange={(e) => setSide(e.target.value as Tx["side"])}>
          <option value="buy">buy</option>
          <option value="sell">sell</option>
          <option value="transfer_in">transfer in</option>
          <option value="transfer_out">transfer out</option>
        </select>
        <input className={`${input} w-32`} value={quantity} onChange={(e) => setQuantity(e.target.value)}
               placeholder="Quantity" inputMode="decimal" />
        <input className={`${input} w-32`} value={price} onChange={(e) => setPrice(e.target.value)}
               placeholder="Price (USDT)" inputMode="decimal" />
        <input className={`${input} w-24`} value={fee} onChange={(e) => setFee(e.target.value)}
               placeholder="Fee" inputMode="decimal" />
        <input className={input} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        <button onClick={submit} className="bg-blue-600 text-white rounded px-3 py-1 text-sm inline-flex items-center gap-1"><Plus size={14} aria-hidden />Add</button>
      </div>
      {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
    </div>
  );
}
