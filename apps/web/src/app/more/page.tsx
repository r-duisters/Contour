import Link from "next/link";
import PortfolioManager from "@/components/PortfolioManager";
import PrivacyToggle from "@/components/PrivacyToggle";
import { Bell, BookText, CandlestickChart, Download, FlaskConical, History, Settings } from "lucide-react";

const LINKS = [
  { href: "/ledger", label: "Ledger", Icon: BookText,
    hint: "Cost basis, realised profit, fees, and the January valuation" },
  { href: "/alerts", label: "Alerts", Icon: Bell, hint: "Price targets and indicator signals" },
  { href: "/settings", label: "Settings", Icon: Settings, hint: "Currency, notifications, passkeys" },
];

// Tools for the trading strategy itself rather than the portfolio.
const STRATEGY = [
  // The chart lost its tab to Markets. Without a home here it would be
  // reachable only from a crypto holding, so an owner holding none could not
  // reach it at all.
  { href: "/chart", label: "Chart the indicator", Icon: CandlestickChart },
  { href: "/backtest", label: "Backtest the strategy", Icon: History },
  { href: "/analyze", label: "Review the script", Icon: FlaskConical },
];

export default function MorePage() {
  return (
    <main className="min-h-screen md:min-h-[calc(100vh-3.5rem)] px-4 py-5 md:p-8 max-w-3xl mx-auto">
      <h1 className="text-xl md:text-2xl font-semibold mb-4 md:mb-6">More</h1>

      <div className="mb-6">
        <PrivacyToggle />
      </div>

      <ul className="space-y-3 text-sm mb-8">
        {LINKS.map(({ href, label, Icon, hint }) => (
          <li key={href}>
            <Link className="flex items-center gap-3" href={href}>
              <Icon size={16} aria-hidden className="text-neutral-400" />
              <span>
                <span className="text-blue-500">{label}</span>
                <span className="block text-xs text-neutral-500">{hint}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="mb-8">
        <PortfolioManager />
      </div>

      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400 mb-2">Android app</h2>
      <a href="/api/app/download"
         className="inline-flex items-center gap-2 text-sm text-blue-500 mb-2">
        <Download size={16} aria-hidden className="text-neutral-400" />
        Download the latest build
      </a>
      <p className="text-xs text-neutral-500 mb-8">
        Only needed when the app shell itself changes — icons, permissions, the
        lock screen. Everything else updates the moment the server does, so
        pull to refresh is usually enough. Inside the app this hands the file
        to your browser, which installs it.
      </p>

      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400 mb-2">Strategy tools</h2>
      <ul className="space-y-3 text-sm">
        {STRATEGY.map(({ href, label, Icon }) => (
          <li key={href}>
            <Link className="inline-flex items-center gap-2 text-neutral-300" href={href}>
              <Icon size={16} aria-hidden className="text-neutral-500" />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
