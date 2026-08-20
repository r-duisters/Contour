"use client";

import { History } from "lucide-react";
import { useState } from "react";

type Stats = {
  initialCapital: number;
  finalEquity: number;
  totalReturnPct: number;
  winRate: number;
  maxDrawdownPct: number;
  trades: { kind: "buy" | "sell"; time: number; price: number; units: number; cashDelta: number; tag?: string }[];
};

export default function BacktestPage() {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [interval, setInterval_] = useState("1d");
  const [days, setDays] = useState(2000);
  const [running, setRunning] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runBacktest() {
    setRunning(true); setError(null); setStats(null);
    const to = Date.now();
    const from = to - days * 24 * 60 * 60 * 1000;
    try {
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, interval, from, to }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setStats(data.stats);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="min-h-screen px-4 py-5 md:p-8 max-w-4xl mx-auto">
      <h1 className="text-xl md:text-2xl font-semibold mb-4 md:mb-6 flex items-center gap-2"><History size={20} aria-hidden className="text-neutral-400" />Backtest</h1>

      <div className="flex flex-wrap gap-2 mb-6">
        <input className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm uppercase"
               value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
        <select className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm"
                value={interval} onChange={(e) => setInterval_(e.target.value)}>
          {["1d"].map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input type="number" min={1} max={5000}
               className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm w-24"
               value={days} onChange={(e) => setDays(Number(e.target.value))} />
        <span className="text-xs text-neutral-500 self-center">days back</span>
        <button onClick={runBacktest} disabled={running}
                className="bg-blue-600 disabled:opacity-50 text-white rounded px-3 py-1 text-sm">
          {running ? "Running…" : "Run"}
        </button>
      </div>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      {stats && (
        <section className="space-y-4">
          <div className="grid grid-cols-4 gap-4 text-sm">
            <Stat label="Return" value={`${(stats.totalReturnPct * 100).toFixed(2)}%`} />
            <Stat label="Final equity" value={`$${stats.finalEquity.toFixed(2)}`} />
            <Stat label="Profitable sells" value={`${(stats.winRate * 100).toFixed(1)}%`} />
            <Stat label="Max drawdown" value={`${(stats.maxDrawdownPct * 100).toFixed(2)}%`} />
          </div>
          <div>
            <h2 className="text-sm font-semibold mb-2">Trades ({stats.trades.length})</h2>
            <table className="w-full text-xs">
              <thead className="text-left text-neutral-500">
                <tr><th>Kind</th><th>Time</th><th>Price</th><th>Units</th><th>Cash Δ</th><th>Tag</th></tr>
              </thead>
              <tbody>
                {stats.trades.map((t, i) => (
                  <tr key={i} className="border-t border-neutral-800">
                    <td className={t.kind === "buy" ? "text-green-500" : "text-red-500"}>{t.kind}</td>
                    <td>{new Date(t.time).toISOString().slice(0,10)}</td>
                    <td>{t.price.toFixed(2)}</td>
                    <td>{t.units.toFixed(6)}</td>
                    <td>{t.cashDelta.toFixed(2)}</td>
                    <td className="text-neutral-500">{t.tag ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded p-3">
      <div className="text-neutral-500 text-xs">{label}</div>
      <div className="text-lg font-medium">{value}</div>
    </div>
  );
}
