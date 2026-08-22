/**
 * The app's mark: a nabla — the delta symbol inverted — with a price line cut
 * clean through it.
 *
 * Solid rather than outline so it holds its weight at launcher sizes, and blue
 * rather than red so a downward triangle does not read as a loss. The line has
 * five vertices and a reversal on purpose: two segments meeting in a V reads as
 * a checkmark, which is a verification badge, not a portfolio. It stops short
 * of the edges so the triangle stays one shape rather than splitting into a cap
 * and a wedge. The cut is a real hole, so it takes the colour of whatever the
 * mark is placed on.
 */
export default function NablaMark({ size = 48, id = "nabla" }: { size?: number; id?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      role="img"
      aria-label="Nabla"
      className="shrink-0"
    >
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor="#60a5fa" />
          <stop offset="1" stopColor="#2563eb" />
        </linearGradient>
        <mask id={`${id}-cut`}>
          <rect width="512" height="512" fill="#fff" />
          <polyline
            points="168,254 214,286 258,232 304,264 356,208"
            fill="none"
            stroke="#000"
            strokeWidth="30"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </mask>
      </defs>
      <polygon
        points="112,146 400,146 256,392"
        fill={`url(#${id}-fill)`}
        stroke={`url(#${id}-fill)`}
        strokeWidth="30"
        strokeLinejoin="round"
        mask={`url(#${id}-cut)`}
      />
    </svg>
  );
}
