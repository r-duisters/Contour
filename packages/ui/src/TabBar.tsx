"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Menu, TrendingUp, Wallet } from "lucide-react";
import MoreMenu from "./MoreMenu";
import { MORE_HREFS } from "./more-menu";

const TABS = [
  { href: "/portfolio", label: "Portfolio", Icon: Wallet },
  { href: "/markets", label: "Markets", Icon: TrendingUp },
  { href: "/insights", label: "Insights", Icon: BarChart3 },
];

export default function TabBar() {
  const pathname = usePathname();
  /**
   * Which route the menu was opened on — not a boolean.
   *
   * It is open only while the page underneath is still the page it was opened
   * over, so any navigation closes it: a link inside it, a back gesture, a
   * forward one. A boolean plus a popstate listener was the first attempt and
   * did not survive a real back — the event fires, but the listener is gone by
   * the time it does. Derivation cannot miss an event it never listens for.
   */
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  if (pathname === "/login" || pathname === "/setup") return null;
  const open = openedOn === pathname;
  const setOpen = (next: boolean) => setOpenedOn(next ? pathname : null);
  const active = (href: string) => pathname === href || pathname.startsWith(href + "/");
  // The fourth slot lights up for anything behind the menu, so a person on the
  // ledger can still see which quarter of the app they are in.
  const inMore = MORE_HREFS.some(active);

  return (
    <>
      <MoreMenu open={open} onClose={() => setOpen(false)} variant="sheet" />
      <nav className="fixed bottom-0 inset-x-0 md:hidden z-40 bg-neutral-950/95 border-t border-neutral-800 backdrop-blur pb-[env(safe-area-inset-bottom)]">
        <ul className="grid grid-cols-4">
          {TABS.map(({ href, label, Icon }) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={active(href) ? "page" : undefined}
                className={`flex flex-col items-center gap-0.5 text-center text-xs py-2 ${active(href) ? "text-blue-500" : "text-neutral-400"}`}
              >
                <Icon size={20} aria-hidden />
                {label}
              </Link>
            </li>
          ))}
          <li>
            {/* A button, not a link: it opens over the page rather than
                replacing it, so the page you were reading is still there when
                you decide none of these was what you wanted. */}
            <button
              type="button"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              aria-haspopup="dialog"
              className={`w-full flex flex-col items-center gap-0.5 text-center text-xs py-2 ${
                open || inMore ? "text-blue-500" : "text-neutral-400"
              }`}
            >
              <Menu size={20} aria-hidden />
              More
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
