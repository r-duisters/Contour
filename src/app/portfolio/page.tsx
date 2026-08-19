"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SymbolPicker from "@/components/SymbolPicker";
import { Plus, Trash2, TrendingDown, TrendingUp, Upload, Wallet } from "lucide-react";
import CoinIcon from "@/components/CoinIcon";
import {
  AreaSeries, createChart, type IChartApi, type ISeriesApi, type Time,
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

type ValuedHolding = {
  symbol: string;
  quantity: number;
  avgCost: number;
  costBasis: number;
  realizedPnl: number;
  fees: number;
  price: number | null;
  value: number | null;
  unrealizedPnl: number | null;
};

type Valuation = {
  holdings: ValuedHolding[];
  totals: { value: number; costBasis: number; unrealizedPnl: number; realizedPnl: number; fees: number };
  series: { t: number; value: number }[];
};

const SLICE_COLORS = ["#3b82f6", "#22c55e", "#eab308", "#a855f7", "#ef4444", "#14b8a6", "#f97316", "#64748b"];

const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const fmtQty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 8 });

export default function PortfolioPage() {
  const [portfolios, setPortfolios] = useState<PortfolioRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [transactions, setTransactions] = useState<Tx[]>([]);
  const [valuation, setValuation] = useState<Valuation | null>(null);
  const [valuationLoading, setValuationLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadPortfolios = useCallback(async () => {
    const d = await fetch("/api/portfolios").then((r) => r.json());
    setPortfolios(d.portfolios);
    setSelectedId((cur) => cur ?? d.portfolios[0]?.id ?? null);
  }, []);
  useEffect(() => { loadPortfolios(); }, [loadPortfolios]);

  const loadSelected = useCallback(async () => {
    if (!selectedId) { setTransactions([]); setValuation(null); return; }
    setValuationLoading(true);
    const [detail, val] = await Promise.all([
      fetch(`/api/portfolios/${selectedId}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/portfolios/${selectedId}/valuation`).then((r) => (r.ok ? r.json() : null)),
    ]);
    setTransactions(detail?.portfolio.transactions ?? []);
    setValuation(val);
    setValuationLoading(false);
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

  return (
    <main className="min-h-screen p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6 flex items-center gap-2"><Wallet size={20} aria-hidden className="text-neutral-400" />Portfolio</h1>

      <div className="flex gap-2 mb-8 items-center flex-wrap">
        <select
          className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm"
          value={selectedId ?? ""}
          onChange={(e) => setSelectedId(e.target.value || null)}
        >
          {portfolios.length === 0 && <option value="">— no portfolios —</option>}
          {portfolios.map((p) => (
            <option key={p.id} value={p.id}>{p.name} ({p.transactionCount})</option>
          ))}
        </select>
        {selectedId && (
          <button onClick={deletePortfolio} className="text-xs underline text-red-500 inline-flex items-center gap-1"><Trash2 size={12} aria-hidden />delete</button>
        )}
        <span className="flex-1" />
        <input
          className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm"
          placeholder="New portfolio name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && createPortfolio()}
        />
        <button onClick={createPortfolio} className="bg-blue-600 text-white rounded px-3 py-1 text-sm inline-flex items-center gap-1">
          <Plus size={14} aria-hidden />Create
        </button>
        {selectedId && (
          <>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
                   onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = ""; }} />
            <button onClick={() => fileRef.current?.click()}
                    className="bg-neutral-700 text-white rounded px-3 py-1 text-sm inline-flex items-center gap-1">
              <Upload size={14} aria-hidden />Import Delta CSV
            </button>
            <button onClick={clearImported} className="text-xs underline text-red-500 inline-flex items-center gap-1">
              <Trash2 size={12} aria-hidden />clear imported
            </button>
          </>
        )}
      </div>
      {importMsg && <p className="text-xs text-neutral-400 -mt-6 mb-6">{importMsg}</p>}

      {selectedId && (
        <>
          {valuation && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
                <Stat label="Value" value={fmtUsd(valuation.totals.value)} />
                <Stat label="Cost basis" value={fmtUsd(valuation.totals.costBasis)} />
                <Stat label="Unrealized P&L" value={fmtUsd(valuation.totals.unrealizedPnl)} signed={valuation.totals.unrealizedPnl} />
                <Stat label="Realized P&L" value={fmtUsd(valuation.totals.realizedPnl)} signed={valuation.totals.realizedPnl} />
                <Stat label="Fees paid" value={fmtUsd(valuation.totals.fees)} />
              </div>
              {valuation.holdings.some((h) => h.quantity > 0 && h.price === null) && (
                <p className="text-xs text-amber-500/80 -mt-6 mb-8">
                  {valuation.holdings.filter((h) => h.quantity > 0 && h.price === null).length} holding(s) have
                  no Binance USDT market and are excluded from the total value.
                </p>
              )}

              <div className="grid md:grid-cols-[1fr_260px] gap-8 mb-8 items-start">
                <ValueChart series={valuation.series} />
                <AllocationDonut holdings={valuation.holdings} />
              </div>

              <h2 className="text-lg font-medium mb-3">Holdings</h2>
              <ul className="md:hidden space-y-2 mb-10">
                {valuation.holdings.map((h) => (
                  <li key={h.symbol} className="bg-neutral-900 border border-neutral-800 rounded p-3 text-sm">
                    <div className="flex justify-between items-baseline">
                      <span className="font-mono font-medium inline-flex items-center gap-2"><CoinIcon symbol={h.symbol} size={18} />{h.symbol}</span>
                      <span>{h.value !== null ? fmtUsd(h.value) : "?"}</span>
                    </div>
                    <div className="flex justify-between text-xs text-neutral-500 mt-1">
                      <span>{fmtQty(h.quantity)} @ {h.quantity > 0 ? fmtUsd(h.avgCost) : "—"}</span>
                      <Pnl value={h.unrealizedPnl} />
                    </div>
                  </li>
                ))}
                {valuation.holdings.length === 0 && (
                  <li className="text-sm text-neutral-500 py-2">No holdings yet — add a transaction below.</li>
                )}
              </ul>
              <div className="overflow-x-auto mb-10 hidden md:block">
                <table className="w-full text-sm">
                  <thead className="text-neutral-500 text-xs text-left">
                    <tr>
                      <th className="py-2 pr-4">Asset</th>
                      <th className="py-2 pr-4 text-right">Quantity</th>
                      <th className="py-2 pr-4 text-right">Avg cost</th>
                      <th className="py-2 pr-4 text-right">Price</th>
                      <th className="py-2 pr-4 text-right">Value</th>
                      <th className="py-2 pr-4 text-right">Unrealized</th>
                      <th className="py-2 text-right">Realized</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800">
                    {valuation.holdings.map((h) => (
                      <tr key={h.symbol}>
                        <td className="py-2 pr-4 font-mono"><span className="inline-flex items-center gap-2"><CoinIcon symbol={h.symbol} size={18} />{h.symbol}</span></td>
                        <td className="py-2 pr-4 text-right">{fmtQty(h.quantity)}</td>
                        <td className="py-2 pr-4 text-right">{h.quantity > 0 ? fmtUsd(h.avgCost) : "—"}</td>
                        <td className="py-2 pr-4 text-right">{h.price !== null ? fmtUsd(h.price) : "?"}</td>
                        <td className="py-2 pr-4 text-right">{h.value !== null ? fmtUsd(h.value) : "?"}</td>
                        <td className="py-2 pr-4 text-right"><Pnl value={h.unrealizedPnl} /></td>
                        <td className="py-2 text-right"><Pnl value={h.realizedPnl} /></td>
                      </tr>
                    ))}
                    {valuation.holdings.length === 0 && (
                      <tr><td colSpan={7} className="py-4 text-neutral-500">No holdings yet — add a transaction below.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {valuationLoading && !valuation && (
            <p className="text-sm text-neutral-500 mb-8">Loading valuation…</p>
          )}

          <h2 className="text-lg font-medium mb-3">Transactions</h2>
          <TxForm onSubmit={addTransaction} error={formError} />
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

function Stat({ label, value, signed }: { label: string; value: string; signed?: number }) {
  const color =
    signed === undefined ? "text-neutral-200"
    : signed > 0 ? "text-green-500"
    : signed < 0 ? "text-red-500"
    : "text-neutral-200";
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded p-3">
      <div className="text-xs text-neutral-500 mb-1">{label}</div>
      <div className={`text-base font-medium ${color} flex items-center gap-1.5`}>
        {signed !== undefined && signed > 0 && <TrendingUp size={16} aria-hidden />}
        {signed !== undefined && signed < 0 && <TrendingDown size={16} aria-hidden />}
        {value}
      </div>
    </div>
  );
}

function Pnl({ value }: { value: number | null }) {
  if (value === null) return <span className="text-neutral-500">?</span>;
  const color = value > 0 ? "text-green-500" : value < 0 ? "text-red-500" : "text-neutral-400";
  return <span className={color}>{fmtUsd(value)}</span>;
}

function ValueChart({ series }: { series: { t: number; value: number }[] }) {
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
    if (!area.current) return;
    area.current.setData(series.map((p) => ({ time: Math.floor(p.t / 1000) as Time, value: p.value })));
    chart.current?.timeScale().fitContent();
  }, [series]);

  return <div ref={container} className="h-64 border border-neutral-800 rounded" />;
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
      <ul className="mt-3 space-y-1 text-xs">
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
