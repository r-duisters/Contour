/**
 * The app's mark: a summit drawn as its own level curves.
 *
 * Two nested contour lines close around a peak — the outer a quiet hairline,
 * the inner the brand blue. It is the name made literal: a field of level
 * curves, here reduced to the two that matter, and the blue sits on the summit
 * (the subject) rather than the frame. The whole mark points up — a rise,
 * never a fall.
 *
 * The outer curve must stay *quiet*. The app frames the mark in a circle
 * twice: the unlock disc in `BiometricLock`, and Android's adaptive mask,
 * which most launchers render round. A curve at that frame's weight and
 * brightness competes with it and reads as a misalignment; a dim hairline is
 * clearly subordinate, so the nesting reads as deliberate. Weight and contrast
 * are what matter here, not whether the shape is closed.
 *
 * White at 35% rather than a flat grey so the outer curve blends with whatever
 * sits behind it — the login card is translucent over an animated backdrop.
 */
const OUTER = "M256,118 L394,356 L118,356 Z";
const INNER = "M256,196 L344,356 L168,356 Z";

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
      <path d={OUTER} fill="none" stroke="#fafafa" strokeWidth="14" opacity={0.35} strokeLinejoin="round" />
      <path d={INNER} fill="none" stroke="#3b82f6" strokeWidth="14" strokeLinejoin="round" />
    </svg>
  );
}
