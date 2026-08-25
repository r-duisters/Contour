import { z } from "zod";

export const AlertKind = z.enum(["indicator", "price_target", "pct_move"]);
export type AlertKind = z.infer<typeof AlertKind>;

export const PriceTargetParams = z.object({
  direction: z.enum(["above", "below"]),
  price: z.number().positive(),
});
export type PriceTargetParams = z.infer<typeof PriceTargetParams>;

export const PctMoveParams = z.object({
  /** Absolute move threshold in percent, e.g. 5 = fire on a ±5% move vs. the previous daily close. */
  threshold: z.number().positive(),
});
export type PctMoveParams = z.infer<typeof PctMoveParams>;

export type PctMoveHit = { direction: "up" | "down"; pct: number };

/** True when the live price satisfies the target condition. One-shot: the caller disables the alert after firing. */
export function evaluatePriceTarget(params: PriceTargetParams, livePrice: number): boolean {
  return params.direction === "above" ? livePrice >= params.price : livePrice <= params.price;
}

/**
 * Compare the live price to what it was a rolling twenty-four hours ago.
 * Returns the move when its magnitude reaches the threshold, else null. Fires
 * at most once per direction per day via event dedupe.
 *
 * `dayAgo` used to be the previous *daily close*, which measured "since 00:00
 * UTC" — a window nine hours long at breakfast. The screens moved to a rolling
 * day on 2026-08-25 and the alerts followed, so an alert reasons about the same
 * window the app displays. Both now read the same 25 hourly bars; see
 * `fetchCrypto24hAgo`.
 */
export function evaluatePctMove(
  params: PctMoveParams,
  dayAgo: number,
  livePrice: number,
): PctMoveHit | null {
  if (!(dayAgo > 0)) return null;
  const pct = ((livePrice - dayAgo) / dayAgo) * 100;
  if (Math.abs(pct) < params.threshold) return null;
  return { direction: pct > 0 ? "up" : "down", pct };
}

const DAY_MS = 86_400_000;

/** Open time (ms) of the current UTC day — the dedupe bucket for live-price alert events. */
export function utcDayOpen(nowMs: number): number {
  return Math.floor(nowMs / DAY_MS) * DAY_MS;
}
