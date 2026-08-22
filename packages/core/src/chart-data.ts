/** A point on any of the app's value or price lines. */
export type Pt = { t: number; v: number };

/**
 * Reduce a series to at most `target` points by averaging equal-sized buckets.
 *
 * Curving a line only rounds the joints between points, so it does nothing to
 * a series with more points than the chart has pixels: 2,500 daily closes over
 * 700px leaves no joint wide enough to see. Fewer, averaged points give both a
 * calmer shape and segments long enough for the curve to show.
 *
 * The first and last observations are kept exactly. The last one especially:
 * it is the figure printed beside the chart, and an averaged endpoint would
 * quietly disagree with it.
 */
export function thin(points: Pt[], target: number): Pt[] {
  if (target < 2 || points.length <= target) return points;

  const first = points[0]!;
  const last = points[points.length - 1]!;
  // The endpoints are supplied verbatim, so the buckets cover what is between.
  const inner = points.slice(1, -1);
  const buckets = target - 2;
  const out: Pt[] = [first];

  for (let i = 0; i < buckets; i++) {
    const start = Math.floor((i * inner.length) / buckets);
    const end = Math.floor(((i + 1) * inner.length) / buckets);
    if (end <= start) continue;
    let sum = 0;
    for (let j = start; j < end; j++) sum += inner[j]!.v;
    out.push({ t: inner[end - 1]!.t, v: sum / (end - start) });
  }

  out.push(last);
  return out;
}

/**
 * How many points to draw for a container of this width. Roughly one point
 * every three pixels: dense enough to keep the shape, sparse enough to curve.
 */
export function targetPoints(widthPx: number): number {
  return Math.max(40, Math.min(400, Math.round(widthPx / 3)));
}
