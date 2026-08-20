"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SymbolPicker from "@/components/SymbolPicker";
import {
  Activity, ArrowUpDown, ChevronDown, Plus, SlidersHorizontal, Trash2, TrendingDown, TrendingUp,
  Upload, Wallet,
} from "lucide-react";
import CoinIcon from "@/components/CoinIcon";
import {
  AreaSeries, createChart, createSeriesMarkers, LineSeries,
  type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type Time,
} from "lightweight-charts";

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
  assetType?: "crypto" | "equity";
  dayChange?: DayChange | null;
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
    dayChange: (DayChange & { covered: number }) | null;
  };
  currency?: "USD" | "EUR";
  rate?: number;
};

const SLICE_COLORS = ["#3b82f6", "#22c55e", "#eab308", "#a855f7", "#ef4444", "#14b8a6", "#f97316", "#64748b"];

// The server already returns figures in the display currency.
let displayCurrency: "USD" | "EUR" = "USD";
const fmtUsd = (n: number) =>
  n.toLocaleString(displayCurrency === "EUR" ? "de-DE" : "en-US", {
    style: "currency", currency: displayCurrency, maximumFractionDigits: 2,
  });
const fmtQty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 8 });

export default function PortfolioPage() {
  const [portfolios, setPortfolios] = useState<PortfolioRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [transactions, setTransactions] = useState<Tx[]>([]);
  const [valuation, setValuation] = useState<Valuation | null>(null);
  const [valuationLoading, setValuationLoading] = useState(false);
  const [series, setSeries] = useState<{ t: number; value: number }[] | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [selected, setSelected] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [assetTab, setAssetTab] = useState<"all" | "crypto" | "equity">("all");
  const [risk, setRisk] = useState<{ risk: number; zone: "buy" | "hold" | "sell" } | null>(null);

  useEffect(() => {
    fetch("/api/risk?symbol=BTCUSDT")
      .then((r) => r.json())
      .then((d) => { if (typeof d.risk === "number" && d.zone) setRisk({ risk: d.risk, zone: d.zone }); })
      .catch(() => {});
  }, []);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadPortfolios = useCallback(async () => {
    const d = await fetch("/api/portfolios").then((r) => r.json());
    setPortfolios(d.portfolios);
    setSelectedId((cur) => cur ?? d.portfolios[0]?.id ?? null);
  }, []);
  useEffect(() => { loadPortfolios(); }, [loadPortfolios]);

  const loadSelected = useCallback(async () => {
    if (!selectedId) { setTransactions([]); setValuation(null); setSeries(null); return; }
    setValuationLoading(true);
    const [detail, val] = await Promise.all([
      fetch(`/api/portfolios/${selectedId}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/portfolios/${selectedId}/valuation`).then((r) => (r.ok ? r.json() : null)),
    ]);
    setTransactions(detail?.portfolio.transactions ?? []);
    if (val) displayCurrency = val.currency ?? "USD";
    setValuation(val);
    setValuationLoading(false);

    // The value history is slow to build; let the numbers render first.
    fetch(`/api/portfolios/${selectedId}/series`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { series?: { t: number; value: number }[] } | null) => setSeries(d?.series ?? []))
      .catch(() => setSeries([]));
  }, [selectedId]);
  useEffect(() => { loadSelected(); }, [loadSelected]);

  async function createPortfolio() {
    if (!newName.trim()) return;
    const d = await fetch("/api/portfolios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    }).then((r) => r.json());
    setNewName("");
    await loadPortfolios();
    setSelectedId(d.portfolio.id);
  }

  async function deletePortfolio() {
    if (!selectedId) return;
    if (!window.confirm("Delete this portfolio and all its transactions?")) return;
    await fetch(`/api/portfolios/${selectedId}`, { method: "DELETE" });
    setSelectedId(null);
    await loadPortfolios();
  }

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

  async function deleteTransaction(id: string) {
    await fetch(`/api/transactions/${id}`, { method: "DELETE" });
    await loadSelected();
    await loadPortfolios();
  }

  async function clearImported() {
    if (!selectedId) return;
    if (!window.confirm("Remove ALL transactions added by Delta imports from this portfolio?")) return;
    const d = await fetch(`/api/portfolios/${selectedId}/import`, { method: "DELETE" }).then((r) => r.json());
    setImportMsg(`Removed ${d.deleted} imported transactions.`);
    await loadSelected();
    await loadPortfolios();
  }

  async function importCsv(file: File) {
    if (!selectedId) return;
    setImportMsg("Importing…");
    try {
      const csv = await file.text();
      const res = await fetch(`/api/portfolios/${selectedId}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const d = await res.json();
      if (!res.ok) { setImportMsg(`Import failed: ${JSON.stringify(d.error ?? res.status)}`); return; }
      const parts = [`Imported ${d.imported} transactions`];
      if (d.duplicates) parts.push(`${d.duplicates} already present (skipped)`);
      if (d.skipped.length) parts.push(`skipped ${d.skipped.length} (${d.skipped.slice(0, 3).map((x: { line: number; reason: string }) => `line ${x.line}: ${x.reason}`).join("; ")}${d.skipped.length > 3 ? "; …" : ""})`);
      if (d.warnings.length) parts.push(`${d.warnings.length} without USD price`);
      setImportMsg(parts.join(" · "));
      await loadSelected();
      await loadPortfolios();
    } catch (e) {
      setImportMsg(`Import failed: ${(e as Error).message}`);
    }
  }

  const holdings = valuation?.holdings ?? [];
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

  const crypto = sortedHoldings.filter((h) => (h.assetType ?? "crypto") === "crypto");
  const equities = sortedHoldings.filter((h) => h.assetType === "equity");
  const classValue = (items: ValuedHolding[]) => sum(items.map((h) => h.value ?? 0));
  const tabs = [
    { key: "all" as const, label: "All", items: sortedHoldings },
    { key: "crypto" as const, label: "Crypto", items: crypto },
    { key: "equity" as const, label: "Stocks & ETFs", items: equities },
  ].filter((t) => t.key === "all" || t.items.length > 0);
  const visibleHoldings = (tabs.find((t) => t.key === assetTab) ?? tabs[0]!).items;

  return (
    <main className="min-h-screen p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6 flex items-center gap-2"><Wallet size={20} aria-hidden className="text-neutral-400" />Portfolio</h1>

      {/* Data lives above the fold; portfolio administration hides behind Manage. */}
      <div className="flex gap-2 mb-4 items-center flex-wrap">
        {portfolios.length > 1 && (
          <select
            className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm"
            value={selectedId ?? ""}
            onChange={(e) => { setSelectedId(e.target.value || null); setSelected(null); }}
          >
            {portfolios.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.transactionCount})</option>
            ))}
          </select>
        )}
        <span className="flex-1" />
        <button onClick={() => setManageOpen((v) => !v)}
                className="text-xs text-neutral-400 inline-flex items-center gap-1 border border-neutral-800 rounded px-2 py-1">
          <SlidersHorizontal size={12} aria-hidden />Manage
        </button>
      </div>

      {manageOpen && (
        <div className="bg-neutral-900 border border-neutral-800 rounded p-3 mb-6 space-y-3">
          <div className="flex gap-2 items-center flex-wrap">
            <input
              className="bg-neutral-950 border border-neutral-700 rounded px-2 py-1 text-sm"
              placeholder="New portfolio name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createPortfolio()}
            />
            <button onClick={createPortfolio} className="bg-blue-600 text-white rounded px-3 py-1 text-sm inline-flex items-center gap-1">
              <Plus size={14} aria-hidden />Create portfolio
            </button>
          </div>
          {selectedId && (
            <div className="flex gap-2 items-center flex-wrap">
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
                     onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = ""; }} />
              <button onClick={() => fileRef.current?.click()}
                      className="bg-neutral-700 text-white rounded px-3 py-1 text-sm inline-flex items-center gap-1">
                <Upload size={14} aria-hidden />Import Delta CSV
              </button>
              <button onClick={clearImported} className="text-xs underline text-red-500 inline-flex items-center gap-1">
                <Trash2 size={12} aria-hidden />Remove CSV-imported transactions…
              </button>
              <span className="flex-1" />
              <button onClick={deletePortfolio} className="text-xs underline text-red-500 inline-flex items-center gap-1">
                <Trash2 size={12} aria-hidden />Delete portfolio…
              </button>
            </div>
          )}
        </div>
      )}
      {importMsg && <p className="text-xs text-neutral-400 mb-6">{importMsg}</p>}

      {selectedId && (
        <>
          {risk && (
            <a href="/chart" className={`inline-flex items-center gap-2 mb-4 rounded px-3 py-1.5 text-sm border ${
              risk.zone === "buy" ? "border-green-700 bg-green-950/50 text-green-400"
              : risk.zone === "sell" ? "border-red-700 bg-red-950/50 text-red-400"
              : "border-neutral-800 bg-neutral-900 text-neutral-400"
            }`}>
              <Activity size={14} aria-hidden />
              BTC risk {risk.risk.toFixed(2)}
              <span className="opacity-80">
                · {risk.zone === "buy" ? "buy zone" : risk.zone === "sell" ? "sell zone" : "hold"}
              </span>
            </a>
          )}
          {valuation && (
            <>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <Stat label="Value" value={fmtUsd(valuation.totals.value)} big
                      sub={valuation.totals.dayChange && (
                        <DayBadge change={valuation.totals.dayChange} label="today" />
                      )} />
                <Stat label="Unrealized P&L" value={fmtUsd(valuation.totals.unrealizedPnl)}
                      signed={valuation.totals.unrealizedPnl} big
                      sub={valuation.totals.costBasis > 0 ? (
                        <span className="text-xs text-neutral-500">
                          {((valuation.totals.unrealizedPnl / valuation.totals.costBasis) * 100).toFixed(1)}% on cost
                        </span>
                      ) : undefined} />
              </div>
              <div className={`${statsOpen ? "grid" : "hidden"} md:grid grid-cols-2 md:grid-cols-3 gap-3 mb-3`}>
                <Stat label="Cost basis" value={fmtUsd(valuation.totals.costBasis)} />
                <Stat label="Realized P&L" value={fmtUsd(valuation.totals.realizedPnl)} signed={valuation.totals.realizedPnl} />
                <Stat label="Fees paid" value={fmtUsd(valuation.totals.fees)} />
              </div>
              <button onClick={() => setStatsOpen((v) => !v)}
                      className="md:hidden text-xs text-neutral-500 underline mb-6">
                {statsOpen ? "Hide details" : "Show cost basis, realized P&L, fees"}
              </button>
              {valuation.holdings.some((h) => h.quantity > 0 && h.price === null) && (
                <p className="text-xs text-amber-500/80 mb-8">
                  {valuation.holdings.filter((h) => h.quantity > 0 && h.price === null).length} holding(s) have
                  no live price and aren&apos;t counted in Value.
                </p>
              )}

              <div className="grid md:grid-cols-[1fr_260px] gap-8 mb-8 items-start">
                <ValueChart series={series} />
                <AllocationDonut holdings={valuation.holdings} />
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

              {tabs.length > 2 && (
                <div className="flex gap-1 mb-3 border-b border-neutral-800 overflow-x-auto">
                  {tabs.map((t) => (
                    <button
                      key={t.key}
                      onClick={() => { setAssetTab(t.key); setSelected(null); }}
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
                  const pct = h.costBasis > 0 && h.unrealizedPnl !== null
                    ? (h.unrealizedPnl / h.costBasis) * 100 : null;
                  const open = selected === h.symbol;
                  return (
                    <li key={h.symbol} className="bg-neutral-900 border border-neutral-800 rounded">
                      <button
                        onClick={() => setSelected(open ? null : h.symbol)}
                        className="w-full text-left p-3 flex items-center gap-3"
                      >
                        <CoinIcon symbol={h.symbol} size={22} />
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
                            {h.dayChange && (
                              <span className={h.dayChange.pct >= 0 ? "text-green-500" : "text-red-500"}>
                                {h.dayChange.pct >= 0 ? "+" : ""}{h.dayChange.pct.toFixed(1)}% today
                              </span>
                            )}
                            {pct !== null ? (
                              <span className="text-neutral-500">
                                {pct >= 0 ? "+" : ""}{pct.toFixed(1)}% all
                              </span>
                            ) : (
                              <span className="text-neutral-500">no price</span>
                            )}
                          </span>
                        </span>
                        <ChevronDown
                          size={16} aria-hidden
                          className={`text-neutral-500 transition-transform ${open ? "rotate-180" : ""}`}
                        />
                      </button>
                      {open && (
                        <HoldingDetail
                          holding={h}
                          transactions={transactions.filter((t) => t.symbol === h.symbol)}
                          onDeleteTx={deleteTransaction}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
              {sortedHoldings.length === 0 && (
                <p className="text-sm text-neutral-500 py-2 mb-6">No holdings yet — add a transaction below.</p>
              )}
            </>
          )}
          {valuationLoading && !valuation && (
            <p className="text-sm text-neutral-500 mb-8">Loading valuation…</p>
          )}

          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-lg font-medium">Transactions</h2>
            <span className="flex-1" />
            <button onClick={() => setAddOpen((v) => !v)}
                    className="bg-blue-600 text-white rounded px-3 py-1 text-sm inline-flex items-center gap-1">
              <Plus size={14} aria-hidden />{addOpen ? "Close" : "Add transaction"}
            </button>
          </div>
          {addOpen && <TxForm onSubmit={addTransaction} error={formError} />}
          <ul className="divide-y divide-neutral-800">
            {transactions.map((tx) => (
              <li key={tx.id} className="py-2 flex items-center gap-3 text-sm">
                <span className={`text-xs px-2 py-0.5 rounded w-24 text-center ${
                  tx.side === "buy" || tx.side === "transfer_in" ? "bg-green-900 text-green-300" : "bg-red-900 text-red-300"
                }`}>{tx.side.replace("_", " ")}</span>
                <span className="font-mono inline-flex items-center gap-1.5"><CoinIcon symbol={tx.symbol} size={16} />{tx.symbol}</span>
                <span>{fmtQty(tx.quantity)} @ {fmtUsd(tx.price)}</span>
                {tx.fee > 0 && <span className="text-neutral-500 text-xs">fee {fmtUsd(tx.fee)}</span>}
                <span className="text-neutral-500 text-xs">{new Date(tx.time).toLocaleString()}</span>
                <span className="flex-1" />
                <button onClick={() => deleteTransaction(tx.id)} className="text-xs underline text-red-500 inline-flex items-center gap-1">
                  <Trash2 size={12} aria-hidden />delete
                </button>
              </li>
            ))}
            {transactions.length === 0 && (
              <li className="text-sm text-neutral-500 py-4">No transactions yet.</li>
            )}
          </ul>
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

function Pnl({ value }: { value: number | null }) {
  if (value === null) return <span className="text-neutral-500">?</span>;
  const color = value > 0 ? "text-green-500" : value < 0 ? "text-red-500" : "text-neutral-400";
  return <span className={color}>{fmtUsd(value)}</span>;
}

function ValueChart({ series }: { series: { t: number; value: number }[] | null }) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const area = useRef<ISeriesApi<"Area"> | null>(null);

  useEffect(() => {
    if (!container.current) return;
    const c = createChart(container.current, {
      layout: { background: { color: "#0a0a0a" }, textColor: "#d4d4d4" },
      grid: { vertLines: { color: "#1f1f1f" }, horzLines: { color: "#1f1f1f" } },
      autoSize: true,
      timeScale: { timeVisible: false },
    });
    chart.current = c;
    area.current = c.addSeries(AreaSeries, {
      lineColor: "#3b82f6",
      topColor: "rgba(59, 130, 246, 0.3)",
      bottomColor: "rgba(59, 130, 246, 0.0)",
      lineWidth: 2,
    });
    return () => { c.remove(); chart.current = null; area.current = null; };
  }, []);

  useEffect(() => {
    if (!area.current || !series) return;
    area.current.setData(series.map((p) => ({ time: Math.floor(p.t / 1000) as Time, value: p.value })));
    chart.current?.timeScale().fitContent();
  }, [series]);

  return (
    <div className="relative">
      <div ref={container} className="h-64 border border-neutral-800 rounded" />
      {series === null && (
        <span className="absolute inset-0 flex items-center justify-center text-xs text-neutral-500">
          building value history…
        </span>
      )}
    </div>
  );
}

function AllocationDonut({ holdings }: { holdings: ValuedHolding[] }) {
  const slices = holdings
    .filter((h) => (h.value ?? 0) > 0)
    .sort((a, b) => b.value! - a.value!);
  const total = slices.reduce((a, h) => a + h.value!, 0);
  if (total <= 0) return null;

  const R = 70;
  const C = 2 * Math.PI * R;
  let offset = 0;

  return (
    <div>
      <svg viewBox="0 0 200 200" className="w-full max-w-[260px]">
        {slices.map((h, i) => {
          const frac = h.value! / total;
          const dash = frac * C;
          const el = (
            <circle
              key={h.symbol}
              cx="100" cy="100" r={R}
              fill="none"
              stroke={SLICE_COLORS[i % SLICE_COLORS.length]}
              strokeWidth="28"
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 100 100)"
            />
          );
          offset += dash;
          return el;
        })}
      </svg>
      <ul className="mt-3 space-y-1 text-xs hidden md:block">
        {slices.map((h, i) => (
          <li key={h.symbol} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm inline-block"
                  style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }} />
            <CoinIcon symbol={h.symbol} size={14} />
            <span className="font-mono">{h.symbol}</span>
            <span className="text-neutral-500">{((h.value! / total) * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
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
  const [when, setWhen] = useState(() => new Date().toISOString().slice(0, 16));

  function submit() {
    const q = Number(quantity);
    const p = Number(price);
    const f = fee === "" ? 0 : Number(fee);
    const t = new Date(when).getTime();
    if (!symbol || !Number.isFinite(q) || q <= 0 || !Number.isFinite(p) || p < 0 || !Number.isFinite(t)) return;
    onSubmit({ symbol: symbol.toUpperCase(), side, quantity: q, price: p, fee: f, time: t });
    setQuantity(""); setPrice(""); setFee("");
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

function HoldingDetail({
  holding, transactions, onDeleteTx,
}: {
  holding: ValuedHolding;
  transactions: Tx[];
  onDeleteTx: (id: string) => void;
}) {
  const [bars, setBars] = useState<{ t: number; c: number }[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBars(null);
    fetch(`/api/history?symbol=${encodeURIComponent(holding.symbol)}&assetType=${holding.assetType ?? "crypto"}`)
      .then((r) => r.json())
      .then((d: { bars?: { t: number; c: number }[] }) => { if (!cancelled) setBars(d.bars ?? []); })
      .catch(() => { if (!cancelled) setBars([]); });
    return () => { cancelled = true; };
  }, [holding.symbol, holding.assetType]);

  const pct = holding.costBasis > 0 && holding.unrealizedPnl !== null
    ? (holding.unrealizedPnl / holding.costBasis) * 100 : null;

  return (
    <div className="border-t border-neutral-800 p-3 space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <Field label="Quantity" value={fmtQty(holding.quantity)} />
        <Field label="Avg cost" value={holding.quantity > 0 ? fmtUsd(holding.avgCost) : "—"} />
        <Field label="Last price" value={holding.price !== null ? fmtUsd(holding.price) : "no price"} />
        <Field
          label="Today"
          value={holding.dayChange
            ? `${holding.dayChange.pct >= 0 ? "+" : ""}${holding.dayChange.pct.toFixed(2)}% (${fmtUsd(holding.dayChange.abs)})`
            : "—"}
          signed={holding.dayChange?.abs}
        />
        <Field label="Cost basis" value={fmtUsd(holding.costBasis)} />
        <Field label="Value" value={holding.value !== null ? fmtUsd(holding.value) : "—"} />
        <Field
          label="Unrealized"
          value={holding.unrealizedPnl !== null
            ? `${fmtUsd(holding.unrealizedPnl)}${pct !== null ? ` (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)` : ""}`
            : "—"}
          signed={holding.unrealizedPnl ?? undefined}
        />
        <Field label="Realized" value={fmtUsd(holding.realizedPnl)} signed={holding.realizedPnl} />
        <Field label="Fees" value={fmtUsd(holding.fees)} />
      </div>

      <PriceChart bars={bars} transactions={transactions} />

      <div>
        <h3 className="text-xs uppercase tracking-wide text-neutral-500 mb-2">
          Transactions ({transactions.length})
        </h3>
        <ul className="divide-y divide-neutral-800 max-h-64 overflow-y-auto">
          {transactions.map((tx) => (
            <li key={tx.id} className="py-2 flex items-center gap-3 text-sm flex-wrap">
              <span className={`text-xs px-2 py-0.5 rounded w-24 text-center ${
                tx.side === "buy" || tx.side === "transfer_in"
                  ? "bg-green-900 text-green-300" : "bg-red-900 text-red-300"
              }`}>{tx.side.replace("_", " ")}</span>
              <span>{fmtQty(tx.quantity)} @ {fmtUsd(tx.price)}</span>
              {tx.fee > 0 && <span className="text-neutral-500 text-xs">fee {fmtUsd(tx.fee)}</span>}
              <span className="text-neutral-500 text-xs">{new Date(tx.time).toLocaleDateString()}</span>
              <span className="flex-1" />
              <button onClick={() => onDeleteTx(tx.id)}
                      className="text-xs underline text-red-500 inline-flex items-center gap-1">
                <Trash2 size={12} aria-hidden />delete
              </button>
            </li>
          ))}
          {transactions.length === 0 && (
            <li className="py-2 text-sm text-neutral-500">No transactions for this asset.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

function Field({ label, value, signed }: { label: string; value: string; signed?: number }) {
  const color =
    signed === undefined ? "text-neutral-200"
    : signed > 0 ? "text-green-500"
    : signed < 0 ? "text-red-500"
    : "text-neutral-200";
  return (
    <div>
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={color}>{value}</div>
    </div>
  );
}

/** Price history for one asset, with the portfolio's buys and sells marked. */
function PriceChart({ bars, transactions }: { bars: { t: number; c: number }[] | null; transactions: Tx[] }) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const line = useRef<ISeriesApi<"Line"> | null>(null);
  const markers = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  useEffect(() => {
    if (!container.current) return;
    const c = createChart(container.current, {
      layout: { background: { color: "#0a0a0a" }, textColor: "#d4d4d4" },
      grid: { vertLines: { color: "#171717" }, horzLines: { color: "#171717" } },
      autoSize: true,
      timeScale: { timeVisible: false },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    });
    chart.current = c;
    line.current = c.addSeries(LineSeries, { color: "#3b82f6", lineWidth: 2 });
    markers.current = createSeriesMarkers(line.current);
    return () => { c.remove(); chart.current = null; line.current = null; markers.current = null; };
  }, []);

  useEffect(() => {
    if (!line.current || !bars) return;
    line.current.setData(bars.map((b) => ({ time: Math.floor(b.t / 1000) as Time, value: b.c })));
    if (bars.length > 0) {
      const first = bars[0]!.t;
      markers.current?.setMarkers(
        transactions
          .filter((tx) => tx.time >= first && (tx.side === "buy" || tx.side === "sell"))
          .sort((a, b) => a.time - b.time)
          .map((tx) => ({
            time: Math.floor(tx.time / 1000) as Time,
            position: tx.side === "buy" ? "belowBar" as const : "aboveBar" as const,
            color: tx.side === "buy" ? "#22c55e" : "#ef4444",
            shape: tx.side === "buy" ? "arrowUp" as const : "arrowDown" as const,
            text: tx.side === "buy" ? "B" : "S",
          })),
      );
    }
    chart.current?.timeScale().fitContent();
  }, [bars, transactions]);

  if (bars !== null && bars.length === 0) {
    return <p className="text-xs text-neutral-500">No price history available for this asset.</p>;
  }
  return <div ref={container} className="h-48 border border-neutral-800 rounded" />;
}
