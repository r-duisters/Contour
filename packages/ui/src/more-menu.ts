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
 *
 * Two lists now, and the second is not drift: the device build genuinely has
 * fewer places to go. The strategy tooling and the alerts screen are
 * server-only and are not in that app at all, so listing them would offer a
 * destination that 404s. Both lists live here so the difference is one diff
 * away rather than in two components.
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

/**
 * What the device build puts behind More.
 *
 * No alerts, no chart, no backtest, no analyzer: all four are server-only and
 * `apps/mobile` has no route for them. Settings and Portfolio data join this
 * list when their own tasks build the device versions — until then, offering
 * them would be a link to nowhere.
 */
export const DEVICE_MORE_GROUPS: typeof MORE_GROUPS = [
  {
    title: null,
    items: [
      { href: "/ledger", label: "Ledger", Icon: BookText,
        hint: "Cost basis, realised profit, fees" },
      { href: "/more", label: "Portfolio data", Icon: Database,
        hint: "Import, export, backups, portfolios" },
    ],
  },
];

/** Flat, for anything that needs to ask "is one of these the current page?". */
export const hrefsOf = (groups: typeof MORE_GROUPS): string[] =>
  groups.flatMap((g) => g.items.map((i) => i.href));

export const MORE_HREFS = hrefsOf(MORE_GROUPS);
