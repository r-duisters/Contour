"use client";

import { useEffect, useState } from "react";

type Alert = {
  id: string;
  symbol: string;
  timeframe: string;
  enabled: boolean;
  lastEvaluated: string | null;
};

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [timeframe, setTimeframe] = useState("1h");

  async function load() {
    const r = await fetch("/api/alerts");
    const d = await r.json();
    setAlerts(d.alerts);
  }
  useEffect(() => { load(); }, []);

  async function create() {
    await fetch("/api/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, timeframe }),
    });
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

  return (
    <main className="min-h-screen p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Alerts</h1>

      <div className="flex gap-2 mb-6">
        <input className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm uppercase"
               value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
        <select className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm"
                value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
          {["1m","5m","15m","1h","4h","1d"].map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button onClick={create} className="bg-blue-600 text-white rounded px-3 py-1 text-sm">Create</button>
        <button onClick={evaluateNow} className="bg-neutral-700 text-white rounded px-3 py-1 text-sm">
          Evaluate now
        </button>
      </div>

      <ul className="divide-y divide-neutral-800">
        {alerts.map((a) => (
          <li key={a.id} className="py-3 flex items-center gap-3 text-sm">
            <span className="font-mono">{a.symbol} {a.timeframe}</span>
            <span className={`text-xs px-2 py-0.5 rounded ${a.enabled ? "bg-green-700" : "bg-neutral-700"}`}>
              {a.enabled ? "enabled" : "paused"}
            </span>
            <span className="text-neutral-500 text-xs">
              {a.lastEvaluated ? `last: ${new Date(a.lastEvaluated).toLocaleString()}` : "never evaluated"}
            </span>
            <span className="flex-1" />
            <button onClick={() => toggle(a)} className="text-xs underline text-neutral-400">
              {a.enabled ? "pause" : "enable"}
            </button>
            <button onClick={() => remove(a)} className="text-xs underline text-red-500">delete</button>
          </li>
        ))}
        {alerts.length === 0 && <li className="text-sm text-neutral-500 py-4">No alerts yet.</li>}
      </ul>
    </main>
  );
}
