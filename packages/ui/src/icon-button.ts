/**
 * The round icon button in a page header.
 *
 * Written once for the same reason `field()` was: the portfolio header spelled
 * it twice — the add-transaction button and an Insights link — and search
 * would have made three. `BRAND.md`: a new local copy is a bug, not a
 * variation. Three copies is how two of them end up with different hit areas.
 *
 * 44px, which is the smallest target a phone should offer, and why the icon
 * inside is 16px rather than the button being sized to the glyph.
 */
export function iconButton(): string {
  return "w-11 h-11 flex items-center justify-center rounded-full border border-neutral-800 " +
    "text-neutral-400 hover:text-neutral-200 hover:border-neutral-600 " +
    "active:bg-neutral-900 transition-colors";
}

/**
 * The bin at the end of a row.
 *
 * Red rather than grey, because grey said nothing. It was `text-neutral-700`
 * with `hover:text-red-500`, so the only signal that this destroys anything
 * lived in a hover state — and a phone has no hover, which is where most of
 * these rows are read. On a handset it was a nearly invisible grey glyph
 * beside a switch, and the difference between silencing an alert and deleting
 * it was two millimetres of thumb.
 *
 * `BRAND.md` gives destructive actions red text and not a red block: serious,
 * not alarming. Held a little back at rest so a list of ten rows is not ten
 * red marks, full strength on hover and press.
 *
 * The padding is the point as much as the colour. A 14px glyph is a 14px
 * target; the negative margin buys a 30px one without moving anything on the
 * row, which matters most next to a control that does something else entirely.
 */
export function deleteButton(): string {
  return "shrink-0 -m-2 p-2 rounded text-red-500/70 hover:text-red-400 " +
    "active:bg-red-950/40 disabled:opacity-40 transition-colors";
}
