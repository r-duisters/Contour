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
