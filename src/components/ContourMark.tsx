/**
 * The app's mark: three contour lines descending to a point.
 *
 * A contour line joins points of equal value, and a field of them is how a
 * gradient is drawn on a flat page — which is what the app does to a portfolio.
 * The outer level keeps the downward triangle of ∇, the gradient operator the
 * app was once named for, so the shape is inherited rather than discarded.
 *
 * Every level is a true parallel offset of the outer one: same angle, differing
 * only in depth. Three levels rather than four, because a fourth is too shallow
 * to read as a chevron and turns into a notch at launcher sizes. Flat accent
 * blue — a gradient fill was tried and dropped.
 */
const TOP = 150;
const OUTER_APEX = 392;
const OUTER_X = 108;
const APEXES = [392, 300, 208];

function level(apexY: number): string {
  const dx = ((256 - OUTER_X) / (OUTER_APEX - TOP)) * (apexY - TOP);
  return `${256 - dx},${TOP} 256,${apexY} ${256 + dx},${TOP}`;
}

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
      {APEXES.map((apex) => (
        <polyline
          key={apex}
          points={level(apex)}
          fill="none"
          stroke="#3b82f6"
          strokeWidth="28"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
