"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3, Bell, BookText, Settings, TrendingUp, Wallet,
} from "lucide-react";
import ContourMark from "@/components/ContourMark";

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
  if (pathname === "/login" || pathname === "/setup") return null;
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav className="hidden md:block sticky top-0 z-30 bg-neutral-950/95 backdrop-blur border-b border-neutral-800">
      {/* Same column as every page's content, so the mark sits directly above
          the page label rather than two rems to its left. The bar itself still
          spans the window; only what is in it is constrained. */}
      <div className="max-w-5xl mx-auto px-8 h-14 flex items-center gap-6">
        <Link href="/portfolio" aria-label="Contour" className="shrink-0">
          <ContourMark size={22} />
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
        {/* Settings and the rest keep their own page; the icon is the shortcut,
            "More" is still where anything not listed above lives. */}
        <Link
          href="/more"
          aria-label="More"
          aria-current={active("/more") ? "page" : undefined}
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded text-sm ${
            active("/more") ? "bg-neutral-900 text-neutral-100" : "text-neutral-500 hover:text-neutral-300"
          }`}
        >
          <Settings size={16} aria-hidden />
          More
        </Link>
      </div>
    </nav>
  );
}
