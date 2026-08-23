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

/**
 * The budget for a chart that shows a *shape* rather than a record.
 *
 * The portfolio's value chart and the benchmark comparison both answer "which
 * way has this gone", and `targetPoints` draws them far too finely for that: a
 * two-year window arrived as some 320 samples of visible noise while a week
 * arrived as seven, so one control produced two different kinds of picture.
 *
 * Twenty to forty puts every period in one register. The asset page keeps
 * `targetPoints`, because it has a price axis and draws trade markers on
 * particular days — there you read values off the line, so detail is the point.
 */
export function shapePoints(widthPx: number): number {
  return Math.max(20, Math.min(40, Math.round(widthPx / 24)));
}

/**
 * Thin a series, but keep the highest and lowest samples it contained.
 *
 * `thin` averages its buckets, and at forty points a two-year window averages
 * about eighteen days into each — enough to flatten a peak away completely.
 * That matters wherever the extremes are claimed elsewhere: the value chart
 * prints them beside rules the line then failed to reach, and a comparison of
 * two lines is distorted if one is flattened more than the other.
 *
 * A bucket sharing the extreme's timestamp is replaced rather than joined, so
 * the real sample is drawn instead of an average that merely contains it.
 */
export function thinKeepingExtremes(points: Pt[], target: number): Pt[] {
  if (points.length === 0) return points;
  let hi = points[0]!, lo = points[0]!;
  for (const p of points) {
    if (p.v > hi.v) hi = p;
    if (p.v < lo.v) lo = p;
  }
  const out = thin(points, target);
  for (const p of hi === lo ? [hi] : [hi, lo]) {
    const same = out.findIndex((q) => q.t === p.t);
    if (same >= 0) { out[same] = p; continue; }
    const after = out.findIndex((q) => q.t > p.t);
    out.splice(after < 0 ? out.length : after, 0, p);
  }
  return out;
}
