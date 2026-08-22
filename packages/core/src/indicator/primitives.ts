/**
 * Minimal PineScript-equivalent primitives.
 * Each helper takes a series (oldest-first) and returns a series of the same length,
 * with `NaN` for warm-up bars where the value is undefined — matching Pine's na semantics.
 */

export const nz = (x: number, fallback = 0) => (Number.isFinite(x) ? x : fallback);

export function sma(src: readonly number[], length: number): number[] {
  const out = new Array<number>(src.length).fill(NaN);
  if (length <= 0) return out;
  let sum = 0;
  for (let i = 0; i < src.length; i++) {
    sum += src[i]!;
    if (i >= length) sum -= src[i - length]!;
    if (i >= length - 1) out[i] = sum / length;
  }
  return out;
}

export function ema(src: readonly number[], length: number): number[] {
  const out = new Array<number>(src.length).fill(NaN);
  if (length <= 0 || src.length === 0) return out;
  const k = 2 / (length + 1);
  // Seed with SMA of first `length` values, like Pine's ta.ema.
  let seedSum = 0;
  for (let i = 0; i < src.length; i++) {
    if (i < length - 1) {
      seedSum += src[i]!;
      continue;
    }
    if (i === length - 1) {
      seedSum += src[i]!;
      out[i] = seedSum / length;
      continue;
    }
    out[i] = src[i]! * k + out[i - 1]! * (1 - k);
  }
  return out;
}

/** Wilder's smoothing (Pine's ta.rma). */
export function rma(src: readonly number[], length: number): number[] {
  const out = new Array<number>(src.length).fill(NaN);
  if (length <= 0 || src.length === 0) return out;
  const alpha = 1 / length;
  let seedSum = 0;
  for (let i = 0; i < src.length; i++) {
    if (i < length - 1) { seedSum += src[i]!; continue; }
    if (i === length - 1) { seedSum += src[i]!; out[i] = seedSum / length; continue; }
    out[i] = alpha * src[i]! + (1 - alpha) * out[i - 1]!;
  }
  return out;
}

export function highest(src: readonly number[], length: number): number[] {
  const out = new Array<number>(src.length).fill(NaN);
  for (let i = length - 1; i < src.length; i++) {
    let h = -Infinity;
    for (let j = i - length + 1; j <= i; j++) if (src[j]! > h) h = src[j]!;
    out[i] = h;
  }
  return out;
}

export function lowest(src: readonly number[], length: number): number[] {
  const out = new Array<number>(src.length).fill(NaN);
  for (let i = length - 1; i < src.length; i++) {
    let l = Infinity;
    for (let j = i - length + 1; j <= i; j++) if (src[j]! < l) l = src[j]!;
    out[i] = l;
  }
  return out;
}

/** True at bar i if a crosses above b at i (a[i-1] <= b[i-1] && a[i] > b[i]). */
export function crossover(a: readonly number[], b: readonly number[]): boolean[] {
  const out = new Array<boolean>(a.length).fill(false);
  for (let i = 1; i < a.length; i++) {
    out[i] = a[i - 1]! <= b[i - 1]! && a[i]! > b[i]!;
  }
  return out;
}

export function crossunder(a: readonly number[], b: readonly number[]): boolean[] {
  const out = new Array<boolean>(a.length).fill(false);
  for (let i = 1; i < a.length; i++) {
    out[i] = a[i - 1]! >= b[i - 1]! && a[i]! < b[i]!;
  }
  return out;
}

/** Population stdev over a trailing window — matches Pine's ta.stdev (biased / divides by N). */
export function stdev(src: readonly number[], length: number): number[] {
  const out = new Array<number>(src.length).fill(NaN);
  if (length <= 0) return out;
  for (let i = length - 1; i < src.length; i++) {
    let sum = 0;
    for (let j = i - length + 1; j <= i; j++) sum += src[j]!;
    const mean = sum / length;
    let sq = 0;
    for (let j = i - length + 1; j <= i; j++) {
      const d = src[j]! - mean;
      sq += d * d;
    }
    out[i] = Math.sqrt(sq / length);
  }
  return out;
}

export function change(src: readonly number[], length = 1): number[] {
  const out = new Array<number>(src.length).fill(NaN);
  for (let i = length; i < src.length; i++) out[i] = src[i]! - src[i - length]!;
  return out;
}
