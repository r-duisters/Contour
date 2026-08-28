"use client";

import { useEffect, useId, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MORE_GROUPS, type MoreItem } from "./more-menu";
import PrivacyToggle from "./PrivacyToggle";
import SubHeading from "./SubHeading";
import Sheet from "./Sheet";

/**
 * What sits behind "More", as a sheet on a phone and a dropdown on a desktop.
 *
 * One component, two presentations, because the *contents* must not diverge —
 * they already had, when the tab bar and the top bar each linked to a page
 * that listed them. The difference between the two is where it is anchored and
 * how it arrives, and that is all `variant` decides.
 *
 * It used to be a page. A menu is better for the same reason a tab bar is: the
 * destinations are a handful of links, and making someone load a screen to
 * read a list of links — then go back if none of them was what they wanted —
 * spends a navigation on a decision. The page survives for what a menu cannot
 * hold, and is the last entry in the list.
 */
export default function MoreMenu({
  open, onClose, variant, groups = MORE_GROUPS,
}: {
  open: boolean;
  onClose: () => void;
  variant: "sheet" | "dropdown";
  /**
   * Where this app can go. Defaults to the full list, so the web app — which
   * has every destination — passes nothing; the device build passes its own,
   * because half of these are server-only and have no route there.
   */
  groups?: { title: string | null; items: MoreItem[] }[];
}) {
  const pathname = usePathname();
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Escape closes, from anywhere — including from inside the panel, where a
  // keyboard user will be after tabbing into it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // A pointer outside the panel closes it. `pointerdown` rather than `click`
  // so a drag that starts outside and ends inside does not count as a hit.
  useEffect(() => {
    if (!open || variant !== "dropdown") return;
    const onDown = (e: PointerEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, onClose, variant]);

  // Move focus into the panel when it opens, so the first Tab lands inside it
  // rather than back at the top of the page. Only for the dropdown — `Sheet`
  // does its own, and running both would fight over where focus lands.
  useEffect(() => {
    if (open && variant === "dropdown") panel.current?.querySelector<HTMLElement>("a, button")?.focus();
  }, [open, variant]);

  if (!open) return null;

  const isHere = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const list = (
    <div className="p-3 space-y-4">
      <PrivacyToggle />
      {groups.map((group, gi) => (
        <div key={gi}>
          {group.title && (
            <SubHeading className="mb-1.5 px-1">{group.title}</SubHeading>
          )}
          <ul className="space-y-0.5">
            {group.items.map(({ href, label, Icon, hint }) => (
              <li key={href}>
                <Link
                  href={href}
                  onClick={onClose}
                  aria-current={isHere(href) ? "page" : undefined}
                  className={`flex items-center gap-3 rounded px-2 py-2 ${
                    isHere(href) ? "bg-neutral-900 text-neutral-100" : "text-neutral-300"
                  }`}
                >
                  <Icon size={16} aria-hidden className="text-neutral-500 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-sm truncate">{label}</span>
                    {hint && <span className="block text-[11px] text-neutral-500 truncate">{hint}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );

  if (variant === "dropdown") {
    return (
      <div
        ref={panel}
        role="menu"
        aria-labelledby={titleId}
        className="absolute right-0 top-full mt-1 w-72 z-40 rounded-lg border border-neutral-800
                   bg-neutral-950 shadow-xl shadow-black/40"
      >
        <span id={titleId} className="sr-only">More</span>
        {list}
      </div>
    );
  }

  return (
    <div className="md:hidden">
      <Sheet open={open} onClose={onClose} title="More">{list}</Sheet>
    </div>
  );
}
