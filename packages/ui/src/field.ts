/**
 * The dark form field: text inputs, dates, numbers and selects all wear it.
 *
 * A constant rather than a component because the callers are not one element.
 * Nine sites spell this today across `<input>` and `<select>`, two of them via
 * an identical local `const input`, and a component would have to grow a
 * variant for each element before it removed a single copy.
 *
 * `extra` is appended for the genuine per-site differences — a width, an
 * `uppercase` ticker — so those stay visible as differences instead of hiding
 * inside a re-typed base.
 */
export const FIELD = "bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm";

export function field(extra?: string): string {
  return extra ? `${FIELD} ${extra}` : FIELD;
}
