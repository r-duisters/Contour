/**
 * An icon-only button is a bordered circle. That is the rule, and this file is
 * the only place it is spelled.
 *
 * Written once for the same reason `field()` was: the portfolio header spelled
 * it twice — the add-transaction button and an Insights link — and search
 * would have made three. `BRAND.md`: a new local copy is a bug, not a
 * variation. Three copies is how two of them end up with different hit areas.
 *
 * **Why a circle at all, rather than a bare glyph.** A glyph with padding has
 * no edge, so it sits wherever its own box happens to put it and reads as
 * floating beside the content rather than belonging to the row. Put one next
 * to a control that *does* have a shape — a switch, a select — and the two
 * stop looking like controls of the same kind. The border is also what makes
 * the target visible: a 16px icon in a 44px button looks like a 44px button,
 * and an icon alone looks like 16px of nothing much.
 *
 * Two sizes and no more. `md` is 44px, the smallest target a phone should
 * offer, and is why the icon inside is 16px rather than the button being sized
 * to the glyph. `sm` is 36px, for a control that sits inside a list row rather
 * than in a page header — still well above the glyph, and not competing with
 * the row's own text for weight.
 *
 * The exceptions are named in `icon-buttons.test.ts`, which fails on a
 * fourth spelling.
 */
type Size = "md" | "sm";

function circle(size: Size): string {
  return (size === "md" ? "w-11 h-11 " : "w-9 h-9 ") +
    "shrink-0 flex items-center justify-center rounded-full border transition-colors";
}

/** The neutral action: search, add, close, open. */
export function iconButton(size: Size = "md"): string {
  return `${circle(size)} border-neutral-800 ` +
    "text-neutral-400 hover:text-neutral-200 hover:border-neutral-600 active:bg-neutral-900";
}

/**
 * The same shape in the destructive tone.
 *
 * `BRAND.md` gives destructive actions red text and not a red block: serious,
 * not alarming. Held a little back at rest so a list of ten rows is not ten
 * red marks, full strength on hover and press.
 *
 * It was `text-neutral-700` with `hover:text-red-500`, so the only signal that
 * it destroys anything lived in a hover state — and a phone has no hover,
 * which is where most of these rows are read.
 */
export function deleteButton(size: Size = "sm"): string {
  return `${circle(size)} border-neutral-800 ` +
    "text-red-500/80 hover:text-red-400 hover:border-red-900 active:bg-red-950/40 " +
    "disabled:opacity-40";
}
