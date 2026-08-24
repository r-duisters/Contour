import {
  Bell, BookText, CandlestickChart, Database, FlaskConical, History, Settings,
  type LucideIcon,
} from "lucide-react";

/**
 * Everything "More" leads to, in one list, because two navigations render it.
 *
 * The phone's tab bar and the desktop bar used to keep their own copies of
 * this and diverge — the desktop listed Ledger and Alerts inline while the
 * phone buried them, which is a real difference and stays. What must not
 * differ is what is *behind* More, and that is this file.
 */
export type MoreItem = { href: string; label: string; Icon: LucideIcon; hint?: string };

export const MORE_GROUPS: { title: string | null; items: MoreItem[] }[] = [
  {
    title: null,
    items: [
      { href: "/ledger", label: "Ledger", Icon: BookText,
        hint: "Cost basis, realised profit, fees" },
      { href: "/alerts", label: "Alerts", Icon: Bell, hint: "Price targets and signals" },
      { href: "/settings", label: "Settings", Icon: Settings,
        hint: "Currency, notifications, passkeys" },
    ],
  },
  {
    // Tools for the trading strategy itself rather than the portfolio.
    title: "Strategy",
    items: [
      { href: "/chart", label: "Chart the indicator", Icon: CandlestickChart },
      { href: "/backtest", label: "Backtest the strategy", Icon: History },
      { href: "/analyze", label: "Review the script", Icon: FlaskConical },
    ],
  },
  {
    title: null,
    items: [
      // The page More used to be. It keeps what a menu cannot hold: the
      // portfolio manager, the Android build, the attribution credit.
      { href: "/more", label: "Portfolio data", Icon: Database,
        hint: "Import, export, backups, portfolios" },
    ],
  },
];

/** Flat, for anything that needs to ask "is one of these the current page?". */
export const MORE_HREFS = MORE_GROUPS.flatMap((g) => g.items.map((i) => i.href));
