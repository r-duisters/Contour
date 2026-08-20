import Link from "next/link";
import {
  BarChart3, Bell, CandlestickChart, FlaskConical, History, Settings, Wallet,
} from "lucide-react";

const LINKS = [
  { href: "/chart", label: "Live chart", Icon: CandlestickChart },
  { href: "/portfolio", label: "Portfolio", Icon: Wallet },
  { href: "/insights", label: "Insights", Icon: BarChart3 },
  { href: "/backtest", label: "Backtest", Icon: History },
  { href: "/alerts", label: "Alerts", Icon: Bell },
  { href: "/analyze", label: "PineScript review", Icon: FlaskConical },
  { href: "/settings", label: "Settings", Icon: Settings },
];

export default function Home() {
  return (
    <main className="min-h-screen px-4 py-5 md:p-8 max-w-3xl mx-auto">
      <h1 className="text-xl md:text-2xl font-semibold mb-2">Trader</h1>
      <p className="text-sm text-neutral-500 mb-8">
        TradingView-style charting and alerts for a specific PineScript, with notifications via Home Assistant.
      </p>
      <ul className="space-y-2 text-sm">
        {LINKS.map(({ href, label, Icon }) => (
          <li key={href}>
            <Link className="inline-flex items-center gap-2 text-blue-600 underline" href={href}>
              <Icon size={16} aria-hidden className="text-neutral-400" />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
