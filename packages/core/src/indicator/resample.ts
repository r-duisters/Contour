import type { Bar } from "../types";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Group daily bars into weekly bars (Monday 00:00 UTC anchor, matching Binance's weekly klines).
 * Returns one weekly Bar per ISO week present in the input, in order.
 */
export function dailyToWeekly(daily: Bar[]): Bar[] {
  if (daily.length === 0) return [];
  const out: Bar[] = [];
  // Epoch (1970-01-01) was a Thursday; shift by 4 days so weeks start Monday.
  const anchor = (t: number) => Math.floor((t - 4 * 24 * 60 * 60 * 1000) / WEEK_MS);
  let cur: Bar | null = null;
  let curKey = -Infinity;
  for (const b of daily) {
    const key = anchor(b.t);
    if (key !== curKey) {
      if (cur) out.push(cur);
      cur = { t: (key * WEEK_MS) + 4 * 24 * 60 * 60 * 1000, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
      curKey = key;
    } else if (cur) {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Project a weekly-indexed series back onto a daily-indexed series.
 * Each daily bar gets the value of the *most recently completed* weekly bar at or before its time,
 * mirroring Pine's `request.security(..., "W", ...)` lookahead-safe behaviour.
 */
export function projectWeeklyOntoDaily(
  daily: Bar[],
  weekly: Bar[],
  weeklySeries: readonly number[],
): number[] {
  const out = new Array<number>(daily.length).fill(NaN);
  if (weekly.length === 0) return out;
  let wi = 0;
  for (let i = 0; i < daily.length; i++) {
    // Advance wi while next weekly bar has already closed by this daily bar's time.
    // A weekly bar that opens at w.t closes at w.t + 7d; only project after it has closed.
    while (wi + 1 < weekly.length && weekly[wi + 1]!.t + WEEK_MS <= daily[i]!.t + 1) wi++;
    // Until the first weekly bar has fully closed, leave NaN.
    if (weekly[wi]!.t + WEEK_MS > daily[i]!.t) {
      if (wi === 0) continue;
      out[i] = weeklySeries[wi - 1] ?? NaN;
    } else {
      out[i] = weeklySeries[wi] ?? NaN;
    }
  }
  return out;
}
