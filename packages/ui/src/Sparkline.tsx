"use client";

import { useMemo } from "react";
import { shapePoints, thin, type Pt } from "@/lib/chart-data";

/**
 * A line with no axis, no grid and no interaction — the shape of a month.
 *
 * **Not `lightweight-charts`, and the one place in the app that isn't.**
 * `BRAND.md` asks for one charting convention, and this obeys its *rules*
 * while declining its library: the Markets strip draws up to eight of these at
 * 34px tall, and eight canvases, eight resize observers and a charting library
 * on a page that otherwise loads none is a great deal of machinery for a line
 * with fourteen segments. The rules it does keep are the ones that make the
 * app's lines look alike:
 *
 * - **Thinned to `shapePoints`**, the same budget the value chart and the
 *   benchmark comparison use — twenty to forty points, so every window lands
 *   in one register rather than a week reading as seven samples and a year as
 *   three hundred.
 * - **Averaged into buckets, never sampled**, because `thin` does that and a
 *   dropped point takes a peak with it.
 * - **First and last pass through exactly**, so the end of the line is the
 *   figure printed beneath it.
 * - **Curved**, matching `LineType.Curved` everywhere else. A Catmull-Rom
 *   spline through the points, which is what that setting draws.
 *
 * No axis, by the rule that an axis belongs only where the level is read. The
 * percentage beneath each card is the reading; `BRAND.md` also asks for high
 * and low labels wherever an axis is hidden, and this is the exception — at
 * this size two more numbers per card, times eight cards, is a wall of digits
 * where the point is the shape. The card carries a number already.
 */
export default function Sparkline({
  points, up, width = 132, height = 34,
}: {
  /** Closes, oldest first. Thinned here rather than by the caller. */
  points: number[];
  up: boolean;
  width?: number;
  height?: number;
}) {
  const { line, area } = useMemo(() => {
    const pts: Pt[] = points.map((v, i) => ({ t: i, v }));
    const shaped = thin(pts, shapePoints(width));
    return paths(shaped.map((p) => p.v), width, height);
  }, [points, width, height]);

  // The app's own green and red, the same pair every percentage uses.
  const stroke = up ? "#22c55e" : "#ef4444";
  const id = `sp-${up ? "u" : "d"}-${width}-${height}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="block w-full"
      style={{ height }}
      aria-hidden
      focusable="false"
    >
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="1" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
        // The viewBox is stretched to the card's width, which would stretch
        // the stroke with it and give each card a different line weight.
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * A Catmull-Rom spline as cubic béziers — the curve `LineType.Curved` draws.
 *
 * A flat series would divide by a zero range, so it is drawn down the middle:
 * a straight line is the honest picture of a month that did not move.
 */
function paths(values: number[], w: number, h: number): { line: string; area: string } {
  if (values.length < 2) return { line: "", area: "" };
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const range = hi - lo;
  const pad = 3;
  const x = (i: number) => (i * w) / (values.length - 1);
  const y = (v: number) =>
    range === 0 ? h / 2 : h - pad - ((v - lo) / range) * (h - pad * 2);

  const p = values.map((v, i) => [x(i), y(v)] as const);
  let d = `M ${p[0]![0].toFixed(2)} ${p[0]![1].toFixed(2)}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i]!;
    const p1 = p[i]!;
    const p2 = p[i + 1]!;
    const p3 = p[i + 2] ?? p2;
    // Catmull-Rom to bézier, tension 1/6 — the standard conversion.
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${c1[0]!.toFixed(2)} ${c1[1]!.toFixed(2)}`
      + `, ${c2[0]!.toFixed(2)} ${c2[1]!.toFixed(2)}`
      + `, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return { line: d, area: `${d} L ${w} ${h} L 0 ${h} Z` };
}
