"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3, Bell, BookText, ChevronDown, Settings, TrendingUp, Wallet,
} from "lucide-react";
import ContourMark from "@/components/ContourMark";
import MoreMenu from "./MoreMenu";
import { MORE_HREFS } from "./more-menu";

/**
 * Desktop navigation.
 *
 * "More" exists because a phone has four slots and the app has more than four
 * destinations. A wide screen does not have that constraint, so this shows the
 * destinations inline rather than mirroring the phone's compromise — reaching
 * Settings should not cost two clicks on a screen with room for it.
 *
 * Hidden below md, where TabBar takes over. The two are one structure rendered
 * two ways, not two navigation lists.
 */
const PRIMARY = [
  { href: "/portfolio", label: "Portfolio", Icon: Wallet },
  { href: "/markets", label: "Markets", Icon: TrendingUp },
  { href: "/insights", label: "Insights", Icon: BarChart3 },
  { href: "/ledger", label: "Ledger", Icon: BookText },
  { href: "/alerts", label: "Alerts", Icon: Bell },
];

export default function TopNav() {
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
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav className="hidden md:block sticky top-0 z-30 bg-neutral-950/95 backdrop-blur border-b border-neutral-800">
      {/* Same column as every page's content, so the mark sits directly above
          the page label rather than two rems to its left. The bar itself still
          spans the window; only what is in it is constrained. */}
      <div className="max-w-5xl mx-auto px-8 h-14 flex items-center gap-6">
        <Link href="/portfolio" aria-label="Contour" className="shrink-0 flex items-center gap-2.5">
          <span className="w-6 h-6 rounded-[5px] bg-blue-600 flex items-center justify-center">
            <ContourMark size={24} />
          </span>
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-neutral-100">Contour</span>
        </Link>
        <ul className="flex items-center gap-1 flex-1">
          {PRIMARY.map(({ href, label, Icon }) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={active(href) ? "page" : undefined}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded text-sm ${
                  active(href)
                    ? "bg-neutral-900 text-neutral-100"
                    : "text-neutral-500 hover:text-neutral-300"
                }`}
              >
                <Icon size={16} aria-hidden />
                {label}
              </Link>
            </li>
          ))}
        </ul>
        {/* A dropdown rather than a page, and the same list the phone's sheet
            shows — one component, so the two cannot drift. `relative` is on
            this wrapper because the panel anchors to the control, not to the
            bar, which spans the window. */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-haspopup="menu"
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded text-sm ${
              open || MORE_HREFS.some(active)
                ? "bg-neutral-900 text-neutral-100"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            <Settings size={16} aria-hidden />
            More
            <ChevronDown
              size={14}
              aria-hidden
              className={`transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
            />
          </button>
          <MoreMenu open={open} onClose={() => setOpen(false)} variant="dropdown" />
        </div>
      </div>
    </nav>
  );
}
