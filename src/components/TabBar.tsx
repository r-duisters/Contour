"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/portfolio", label: "Portfolio" },
  { href: "/chart", label: "Chart" },
  { href: "/alerts", label: "Alerts" },
  { href: "/more", label: "More" },
];

export default function TabBar() {
  const pathname = usePathname();
  if (pathname === "/login" || pathname === "/setup") return null;
  return (
    <nav className="fixed bottom-0 inset-x-0 md:hidden bg-neutral-950/95 border-t border-neutral-800 backdrop-blur pb-[env(safe-area-inset-bottom)]">
      <ul className="grid grid-cols-4">
        {TABS.map((t) => {
          const active = pathname === t.href || pathname.startsWith(t.href + "/");
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                className={`block text-center text-xs py-3 ${active ? "text-blue-500" : "text-neutral-400"}`}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
