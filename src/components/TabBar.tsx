"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, CandlestickChart, Menu, Wallet } from "lucide-react";

const TABS = [
  { href: "/portfolio", label: "Portfolio", Icon: Wallet },
  { href: "/chart", label: "Chart", Icon: CandlestickChart },
  { href: "/alerts", label: "Alerts", Icon: Bell },
  { href: "/more", label: "More", Icon: Menu },
];

export default function TabBar() {
  const pathname = usePathname();
  if (pathname === "/login" || pathname === "/setup") return null;
  return (
    <nav className="fixed bottom-0 inset-x-0 md:hidden bg-neutral-950/95 border-t border-neutral-800 backdrop-blur pb-[env(safe-area-inset-bottom)]">
      <ul className="grid grid-cols-4">
        {TABS.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <li key={href}>
              <Link
                href={href}
                className={`flex flex-col items-center gap-0.5 text-center text-xs py-2 ${active ? "text-blue-500" : "text-neutral-400"}`}
              >
                <Icon size={20} aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
