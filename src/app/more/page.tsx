import Link from "next/link";

export default function MorePage() {
  return (
    <main className="min-h-screen p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">More</h1>
      <ul className="space-y-3 text-sm">
        <li><Link className="text-blue-600 underline" href="/settings">Settings</Link></li>
        <li><Link className="text-blue-600 underline" href="/backtest">Backtest</Link></li>
        <li><Link className="text-blue-600 underline" href="/analyze">PineScript review</Link></li>
        <li><Link className="text-blue-600 underline" href="/">Home</Link></li>
      </ul>
    </main>
  );
}
