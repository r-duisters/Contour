import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-2">Trader</h1>
      <p className="text-sm text-neutral-500 mb-8">
        TradingView-style charting and alerts for a specific PineScript, with notifications via Home Assistant.
      </p>
      <ul className="space-y-2 text-sm">
        <li><Link className="text-blue-600 underline" href="/chart">Live chart</Link></li>
        <li><Link className="text-blue-600 underline" href="/portfolio">Portfolio</Link></li>
        <li><Link className="text-blue-600 underline" href="/backtest">Backtest</Link></li>
        <li><Link className="text-blue-600 underline" href="/alerts">Alerts</Link></li>
        <li><Link className="text-blue-600 underline" href="/analyze">PineScript review</Link></li>
        <li><Link className="text-blue-600 underline" href="/settings">Settings</Link></li>
      </ul>
    </main>
  );
}
