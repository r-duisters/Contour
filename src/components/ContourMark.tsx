/**
 * The app's mark: a rising price line drawn as two contour levels.
 *
 * A contour line joins points of equal value, and a field of them is how a
 * gradient is drawn on a flat page — so the mark is one path and a parallel
 * offset of itself, which is what contours are.
 *
 * The path is price action rather than a diagonal: a rise, a pullback, a
 * stronger rise. A straight line up would be a claim the app does not make.
 *
 * Two levels rather than three. Three says "contour" more plainly but goes
 * muddy at 24px, and the mark is seen small far more often than large.
 */
const PATH: [number, number][] = [
  [116, 300], [186, 228], [248, 268], [318, 178], [396, 130],
];
const GAP = 80;
const LEVELS = 2;

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
      {Array.from({ length: LEVELS }, (_, i) => (
        <polyline
          key={i}
          points={PATH.map(([x, y]) => `${x},${y + i * GAP}`).join(" ")}
          fill="none"
          stroke="#3b82f6"
          strokeWidth="36"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
