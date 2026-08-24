"use client";

import { useEffect, useId, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { MORE_GROUPS } from "./more-menu";
import PrivacyToggle from "./PrivacyToggle";

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
  open, onClose, variant,
}: {
  open: boolean;
  onClose: () => void;
  variant: "sheet" | "dropdown";
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

  // The sheet covers the page; letting the page scroll behind it is the
  // classic phone bug where the list moves under your finger.
  useEffect(() => {
    if (!open || variant !== "sheet") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open, variant]);

  // Move focus into the panel when it opens, so the first Tab lands inside it
  // rather than back at the top of the page.
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>("a, button")?.focus();
  }, [open]);

  if (!open) return null;

  const isHere = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const list = (
    <div className="p-3 space-y-4">
      <PrivacyToggle />
      {MORE_GROUPS.map((group, gi) => (
        <div key={gi}>
          {group.title && (
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1.5 px-1">
              {group.title}
            </h3>
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
    <div className="md:hidden fixed inset-0 z-40" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      {/* The scrim is a button so a tap anywhere off the sheet closes it, and
          so the gesture is reachable from a keyboard rather than mouse-only. */}
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-[1px]"
      />
      <div
        ref={panel}
        // The tab bar stays visible and lit beneath this, which is what tells
        // you the sheet belongs to it — so the sheet has to end above the bar
        // rather than behind it. 4rem clears the bar; the inset clears the
        // home indicator under that.
        className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-neutral-800
                   bg-neutral-950 pb-[calc(env(safe-area-inset-bottom)+4rem)]
                   max-h-[80vh] overflow-y-auto
                   motion-safe:animate-[more-up_.16s_ease-out]"
      >
        <div className="flex items-center justify-between px-4 pt-3">
          <h2 id={titleId} className="text-sm font-semibold uppercase tracking-widest text-neutral-500">
            More
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="p-1 -mr-1 text-neutral-500"
          >
            <X size={18} aria-hidden />
          </button>
        </div>
        {list}
      </div>
    </div>
  );
}
