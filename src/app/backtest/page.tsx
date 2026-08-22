"use client";

import { History } from "lucide-react";
import { useState } from "react";
import StatTile from "@/components/StatTile";
import { percent } from "@/lib/display";

/**
 * A backtest figure. It is neither the owner's money nor denominated in the
 * display currency — the simulation runs in the pair's quote asset — so it
 * gets grouping and nothing else: no symbol to mislabel it, and no privacy
 * mask, because a hypothetical says nothing about what is actually held.
 */
const num = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
        body: JSON.stringify({ symbol, interval: "1d", from, to }),
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
    <main className="min-h-screen md:min-h-[calc(100vh-3.5rem)] px-4 py-5 md:p-8 max-w-4xl mx-auto">
      <h1 className="text-xl md:text-2xl font-semibold mb-4 md:mb-6 flex items-center gap-2"><History size={20} aria-hidden className="text-neutral-400" />Backtest</h1>

      <div className="flex flex-wrap gap-2 mb-6">
        <input className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm uppercase"
               value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
        {/* The indicator's curves are anchored to daily and weekly closes, so
            the timeframe is fixed. A one-option picker is a dead control. */}
        <span className="text-xs text-neutral-500 self-center">daily bars ·</span>
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 text-sm">
            <StatTile label="Return" value={percent(stats.totalReturnPct * 100)} signed={stats.totalReturnPct} />
            <StatTile label="Final equity" value={num(stats.finalEquity)} />
            <StatTile label="Profitable sells" value={`${(stats.winRate * 100).toFixed(1)}%`} />
            <StatTile label="Max drawdown" value={`${(stats.maxDrawdownPct * 100).toFixed(2)}%`} />
          </div>
          {/* Not the owner's money and not in the display currency: the
              simulation runs in whatever the pair is quoted in, so these
              figures carry no currency symbol and are not masked. */}
          <p className="text-xs text-neutral-500">
            Simulated from a {num(stats.initialCapital)} start, in the units {symbol} is priced in.
          </p>
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400 mb-2">
              Trades ({stats.trades.length})
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs tabular-nums">
                <thead className="text-left text-neutral-500">
                  <tr>
                    <th className="font-normal pb-1">Side</th>
                    <th className="font-normal pb-1">Date</th>
                    <th className="font-normal pb-1 text-right">Price</th>
                    <th className="font-normal pb-1 text-right">Units</th>
                    <th className="font-normal pb-1 text-right">Cash Δ</th>
                    <th className="font-normal pb-1">Tag</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.trades.map((t, i) => (
                    <tr key={i} className="border-t border-neutral-800">
                      {/* A buy is not a gain: direction is not sign. */}
                      <td className="py-1 text-neutral-300">{t.kind === "buy" ? "Buy" : "Sell"}</td>
                      <td className="py-1 text-neutral-400">{new Date(t.time).toISOString().slice(0, 10)}</td>
                      <td className="py-1 text-right">{num(t.price)}</td>
                      <td className="py-1 text-right">{t.units.toFixed(6)}</td>
                      <td className={`py-1 text-right ${t.cashDelta > 0 ? "text-green-500" : t.cashDelta < 0 ? "text-red-500" : ""}`}>
                        {num(t.cashDelta)}
                      </td>
                      <td className="py-1 text-neutral-500">{t.tag ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

