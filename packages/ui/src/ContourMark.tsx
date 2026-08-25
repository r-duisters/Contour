/**
 * The app's mark: a rising line over a contour.
 *
 * A green line climbs left to right and turns up at an arrowhead, drawn over
 * the quiet outline of a summit. The line is the subject and carries the
 * colour; the outline behind it is the name — a level curve, the thing the
 * word Contour means.
 *
 * Three details are load-bearing:
 *
 * - **The line is heavy on purpose.** The old mark's stroke was 14 units of a
 *   512 viewBox, which is two thirds of a pixel on a 24px tab-bar icon — it
 *   survived on colour alone. At 24 units it survives on shape.
 * - **Its corners are rounded, because it is heavy.** A thick polyline with
 *   sharp vertices forms wedges where the segments meet and reads as clumsy;
 *   the two interior corners are curved so the weight reads as confidence.
 * - **The backdrop stays quieter than the line, and that is measured in
 *   weight and contrast, not in whether the shape is closed.** The app frames
 *   the mark in a circle twice — the unlock disc in `BiometricLock`, and
 *   Android's adaptive mask, which most launchers render round and which
 *   cannot be overridden. An outline at the frame's own weight competes with
 *   it and reads as a misalignment rather than a nesting.
 *
 * White at 32% rather than a flat grey so the outline blends with whatever
 * sits behind it — the login card is translucent over an animated backdrop.
 *
 * The green is a deliberate departure from the rule that reserved it for
 * gain; `BRAND.md` records what that costs and why it was accepted anyway.
 */
const BACKDROP = "M256,118 L394,356 L118,356 Z";
const TREND = "M96,366 L173,299 Q190,284 210,294 L248,314 Q268,324 281,306 L408,140";
const HEAD = "M356,140 L408,140 L408,192";

export default function ContourMark({ size = 48 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      role="img"
      aria-label="Contour"
      className="shrink-0"
    >
      <path d={BACKDROP} fill="none" stroke="#fafafa" strokeWidth="22" opacity={0.32} strokeLinejoin="round" />
      <path d={TREND} fill="none" stroke="#22c55e" strokeWidth="24" strokeLinejoin="round" strokeLinecap="round" />
      <path d={HEAD} fill="none" stroke="#22c55e" strokeWidth="24" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
