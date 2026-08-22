"use client";

import { useEffect, useState } from "react";
import SymbolPicker from "@/components/SymbolPicker";
import { Bell, Pause, Play, Plus, Trash2 } from "lucide-react";

type Alert = {
  id: string;
  kind: "indicator" | "price_target" | "pct_move";
  symbol: string | null;
  portfolioId: string | null;
  portfolioName: string | null;
  timeframe: string;
  params: Record<string, unknown>;
  enabled: boolean;
  lastEvaluated: string | null;
};

type PortfolioRow = { id: string; name: string };

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [portfolios, setPortfolios] = useState<PortfolioRow[]>([]);
  const [kind, setKind] = useState<Alert["kind"]>("indicator");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [timeframe, setTimeframe] = useState("1h");
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [targetPrice, setTargetPrice] = useState("");
  const [threshold, setThreshold] = useState("5");
  const [scope, setScope] = useState<"symbol" | "portfolio">("symbol");
  const [portfolioId, setPortfolioId] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const d = await fetch("/api/alerts").then((r) => r.json());
    setAlerts(d.alerts);
  }
  useEffect(() => {
    load();
    fetch("/api/portfolios").then((r) => r.json()).then((d) => {
      setPortfolios(d.portfolios);
      setPortfolioId((cur) => cur || (d.portfolios[0]?.id ?? ""));
    });
  }, []);

  async function create() {
    setError(null);
    let body: Record<string, unknown>;
    if (kind === "indicator") {
      body = { kind, symbol, timeframe };
    } else if (kind === "price_target") {
      const price = Number(targetPrice);
      if (!Number.isFinite(price) || price <= 0) { setError("Enter a target price."); return; }
      body = { kind, symbol, params: { direction, price } };
    } else {
      const t = Number(threshold);
      if (!Number.isFinite(t) || t <= 0) { setError("Enter a % threshold."); return; }
      body = {
        kind,
        params: { threshold: t },
        ...(scope === "symbol" ? { symbol } : { portfolioId }),
      };
      if (scope === "portfolio" && !portfolioId) { setError("Pick a portfolio."); return; }
    }
    const res = await fetch("/api/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) { setError("Failed to create alert."); return; }
    await load();
  }

  async function toggle(a: Alert) {
    await fetch(`/api/alerts/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !a.enabled }),
    });
    await load();
  }

  async function remove(a: Alert) {
    await fetch(`/api/alerts/${a.id}`, { method: "DELETE" });
    await load();
  }

  async function evaluateNow() {
    await fetch("/api/cron/evaluate");
    await load();
  }

  const input = "bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm";

  return (
    <main className="min-h-screen md:min-h-[calc(100vh-3.5rem)] px-4 py-5 md:p-8 max-w-4xl mx-auto">
      <h1 className="text-xl md:text-2xl font-semibold mb-4 md:mb-6 flex items-center gap-2"><Bell size={20} aria-hidden className="text-neutral-400" />Alerts</h1>

      <div className="flex gap-2 mb-2 flex-wrap items-center">
        <select className={input} value={kind} onChange={(e) => setKind(e.target.value as Alert["kind"])}>
          <option value="indicator">indicator signal</option>
          <option value="price_target">price target</option>
          <option value="pct_move">% move (24h)</option>
        </select>

        {kind === "pct_move" && (
          <select className={input} value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
            <option value="symbol">one symbol</option>
            <option value="portfolio">whole portfolio</option>
          </select>
        )}

        {(kind !== "pct_move" || scope === "symbol") && (
          <SymbolPicker className={`${input} uppercase w-28`} value={symbol} onChange={setSymbol} />
        )}
        {kind === "pct_move" && scope === "portfolio" && (
          <select className={input} value={portfolioId} onChange={(e) => setPortfolioId(e.target.value)}>
            {portfolios.length === 0 && <option value="">— no portfolios —</option>}
            {portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}

        {kind === "indicator" && (
          <select className={input} value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
            {["1m","5m","15m","1h","4h","1d"].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        {kind === "price_target" && (
          <>
            <select className={input} value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}>
              <option value="above">crosses above</option>
              <option value="below">crosses below</option>
            </select>
            <input className={`${input} w-32`} value={targetPrice} onChange={(e) => setTargetPrice(e.target.value)}
                   placeholder="Price (USDT)" inputMode="decimal" />
          </>
        )}
        {kind === "pct_move" && (
          <label className="flex items-center gap-1 text-sm text-neutral-400">
            ±<input className={`${input} w-16`} value={threshold} onChange={(e) => setThreshold(e.target.value)}
                    inputMode="decimal" /> %
          </label>
        )}

        <button onClick={create} className="bg-blue-600 text-white rounded px-3 py-1 text-sm inline-flex items-center gap-1"><Plus size={14} aria-hidden />Create</button>
        <button onClick={evaluateNow} className="bg-neutral-700 text-white rounded px-3 py-1 text-sm inline-flex items-center gap-1">
          <Play size={14} aria-hidden />Evaluate now
        </button>
      </div>
      {error && <p className="text-xs text-red-500 mb-4">{error}</p>}
      {kind === "price_target" && (
        <p className="text-xs text-neutral-500 mb-4">Price targets are one-shot: the alert disables itself after firing.</p>
      )}
      <div className="mb-6" />

      <ul className="divide-y divide-neutral-800">
        {alerts.map((a) => (
          <li key={a.id} className="py-3 flex items-center gap-3 text-sm flex-wrap">
            <span className="font-mono break-all">{describe(a)}</span>
            <span className={`text-xs px-2 py-0.5 rounded ${a.enabled ? "bg-green-700" : "bg-neutral-700"}`}>
              {a.enabled ? "enabled" : a.kind === "price_target" ? "fired/paused" : "paused"}
            </span>
            <span className="text-neutral-500 text-xs">
              {a.lastEvaluated ? `last: ${new Date(a.lastEvaluated).toLocaleString()}` : "never evaluated"}
            </span>
            <span className="flex-1" />
            <button onClick={() => toggle(a)} className="text-xs underline text-neutral-400 inline-flex items-center gap-1">
              {a.enabled ? <Pause size={12} aria-hidden /> : <Play size={12} aria-hidden />}
              {a.enabled ? "pause" : "enable"}
            </button>
            <button onClick={() => remove(a)} className="text-xs underline text-red-500 inline-flex items-center gap-1"><Trash2 size={12} aria-hidden />delete</button>
          </li>
        ))}
        {alerts.length === 0 && <li className="text-sm text-neutral-500 py-4">No alerts yet.</li>}
      </ul>
    </main>
  );
}

function describe(a: Alert): string {
  if (a.kind === "price_target") {
    const p = a.params as { direction?: string; price?: number };
    return `${a.symbol} ${p.direction === "below" ? "≤" : "≥"} ${p.price}`;
  }
  if (a.kind === "pct_move") {
    const p = a.params as { threshold?: number };
    const scope = a.symbol ?? `portfolio “${a.portfolioName ?? "?"}”`;
    return `${scope} moves ±${p.threshold}% (24h)`;
  }
  return `${a.symbol} ${a.timeframe} indicator`;
}
