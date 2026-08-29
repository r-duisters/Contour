"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { iconButton } from "./icon-button";

/**
 * A panel that rises from the bottom of the screen.
 *
 * Extracted from `MoreMenu`, which had these mechanics welded to its own
 * contents: the scrim, Escape, focus capture, the scroll lock and the
 * safe-area padding are the same for any sheet, and copying them into a
 * second one is how two sheets start behaving differently.
 *
 * One presentation at every width. `MoreMenu` also has a desktop dropdown
 * because it hangs off a button in the nav bar and can be anchored to it; a
 * form sheet has no anchor, and a second desktop treatment would be a design
 * decision nobody asked for.
 */
export default function Sheet({
  open, onClose, title, children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Escape closes from anywhere, including from inside the panel, which is
  // where a keyboard user is after tabbing into it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // The sheet covers the page; letting the page scroll behind it is the
  // classic phone bug where the list moves under your finger.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Move focus into the panel so the first Tab lands inside it rather than
  // back at the top of the page behind it.
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>("input, select, button, a")?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      {/* A button rather than a div so the dismiss gesture is reachable from a
          keyboard instead of being mouse-only. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-[1px]"
      />
      <div
        ref={panel}
        // 4rem clears the tab bar, which stays lit beneath the sheet; the
        // inset clears the home indicator under that.
        className="absolute inset-x-0 bottom-0 md:left-1/2 md:-translate-x-1/2 md:max-w-lg
                   rounded-t-2xl border-t border-neutral-800 bg-neutral-950
                   pb-[calc(env(safe-area-inset-bottom)+4rem)]
                   max-h-[80vh] overflow-y-auto
                   motion-safe:animate-[more-up_.16s_ease-out]"
      >
        <div className="flex items-center justify-between px-4 pt-3">
          <h2 id={titleId} className="text-sm font-semibold uppercase tracking-widest text-neutral-500">
            {title}
          </h2>
          {/* The row's own control, so it takes the row's shape. A bare
              glyph here sat at whatever height its padding put it, beside a
              heading that had a baseline. */}
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title}`}
            className={`${iconButton("sm")} -mr-1`}
          >
            <X size={16} aria-hidden />
          </button>
        </div>
        {/* No padding of its own: `MoreMenu` brings a padded list that its
            desktop dropdown also uses, and a second `p-3` here would double it
            on one of the two. The container owns the frame; the content owns
            its own spacing. */}
        {children}
      </div>
    </div>
  );
}
