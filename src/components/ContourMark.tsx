/**
 * The app's mark: a rising price line inside a quiet ring.
 *
 * The ring is a contour — a closed level curve, which is what the name means —
 * and the line is the price inside it. The blue is on the line rather than the
 * ring so the brand colour lands on the subject, not the container.
 *
 * The ring must stay *quiet*. The app frames the mark in a circle twice: the
 * unlock disc in `BiometricLock`, and Android's adaptive mask, which most
 * launchers render round. A ring at that frame's weight and brightness
 * competes with it and reads as a misalignment; a dim hairline is clearly
 * subordinate, so the nesting reads as deliberate. Weight and contrast are
 * what matter here, not whether the shape is closed.
 *
 * White at 35% rather than a flat grey so the ring blends with whatever sits
 * behind it — the login card is translucent over an animated backdrop.
 */
const RING = { r: 160, width: 12, colour: "#fafafa", opacity: 0.35 };
const PRICE = "M172,302 L228,244 L280,276 L348,190";

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
      <circle
        cx="256"
        cy="256"
        r={RING.r}
        fill="none"
        stroke={RING.colour}
        strokeWidth={RING.width}
        opacity={RING.opacity}
      />
      <path
        d={PRICE}
        fill="none"
        stroke="#3b82f6"
        strokeWidth="30"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
