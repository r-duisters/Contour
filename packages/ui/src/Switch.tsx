"use client";

/**
 * An on/off control, for a setting that takes effect the moment it is touched.
 *
 * Not a checkbox: a checkbox is a thing you tick and then submit, and every
 * use of this one is a preference that applies immediately. Built on a real
 * `<button role="switch">` so that reads correctly to a screen reader and takes
 * a keyboard, rather than a styled `<div>` with an onClick.
 *
 * `BRAND.md` gives the accent to the on state and nothing to the off state:
 * a switch that is off is not an error and not a warning, it is simply off.
 */
export default function Switch({
  checked, onChange, label, id,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Read out in place of the visible text when the caller labels it itself. */
  label: string;
  id?: string;
}) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={
        "relative w-11 h-6 rounded-full shrink-0 transition-colors " +
        (checked ? "bg-blue-600" : "bg-neutral-700")
      }
    >
      <span
        aria-hidden
        className={
          "absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all " +
          (checked ? "left-[22px]" : "left-0.5")
        }
      />
    </button>
  );
}
