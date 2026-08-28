import MarkTile from "./MarkTile";

/**
 * The mark, with a ring turning around it, for work a person is waiting on.
 *
 * The startup splash uses `ContourMark breathing` instead, and the difference
 * is meant: breathing says "starting", this says "working on the thing you
 * just asked for". An import of a few thousand rows is long enough that a
 * still screen reads as a crash.
 *
 * Indeterminate on purpose. The import parses, converts and writes in one
 * pass, and a bar that jumps 0 → 100 tells a person less than a ring that
 * simply says the app is busy. `BRAND.md` prefers an honest indefinite state
 * to a fabricated percentage.
 */
export default function BusyMark({ size = 112, label }: { size?: number; label?: string }) {
  const ring = size + 24;
  const r = (ring - 6) / 2;
  const circumference = 2 * Math.PI * r;

  return (
    <div className="flex flex-col items-center">
      <div className="relative flex items-center justify-center" style={{ width: ring, height: ring }}>
        <svg
          width={ring}
          height={ring}
          viewBox={`0 0 ${ring} ${ring}`}
          className="absolute inset-0 turning"
          aria-hidden
        >
          <circle
            cx={ring / 2}
            cy={ring / 2}
            r={r}
            fill="none"
            stroke="currentColor"
            className="text-blue-600"
            strokeWidth={3}
            strokeLinecap="round"
            /* A quarter drawn, three quarters gap: enough arc to read as
               motion, little enough to read as incomplete. */
            strokeDasharray={`${circumference / 4} ${circumference}`}
          />
        </svg>
        <MarkTile size={size} />
      </div>
      {label && (
        <p className="mt-5 text-sm text-neutral-400" role="status" aria-live="polite">
          {label}
        </p>
      )}
    </div>
  );
}
