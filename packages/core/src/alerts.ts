import { z } from "zod";

/**
 * `portfolio_move` is the odd one and the reason `expandPortfolioRules` exists.
 *
 * The other kinds are questions about a symbol, so a portfolio-scoped rule
 * becomes one check per holding. This one is a question about the *total*, and
 * expanding it per holding is exactly the bug it was added to fix: a day when
 * everything falls 3% together crosses no single asset's threshold while the
 * figure on the front page has its worst day of the month.
 */
export const AlertKind = z.enum([
  "indicator", "price_target", "pct_move", "portfolio_move", "position_pnl",
]);
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

/**
 * A threshold on what a position has done since it was bought.
 *
 * The only kind that reads the ledger rather than the market. A price target
 * asks "is it worth £X"; this asks "am I up 50%", which is a question about
 * the holder and cannot be answered by a price alone — two people watching the
 * same ticker want different numbers, and only one of them is in this app.
 *
 * `up` fires when the unrealised return reaches +pct, `down` when it reaches
 * −pct. Two directions rather than a signed threshold, because "tell me when I
 * am down 20%" is a sentence and "tell me when my return is −20" is not.
 */
export const PositionPnlParams = z.object({
  direction: z.enum(["up", "down"]),
  /** Magnitude, always positive; `direction` carries the sign. */
  pct: z.number().positive(),
});
export type PositionPnlParams = z.infer<typeof PositionPnlParams>;

/**
 * The unrealised return on a position, against the threshold.
 *
 * Average cost, not the first price paid: somebody who bought three times has
 * one position, and the ledger already averages it — `computeHoldings` folds
 * fees in, so a rule fires on what the position actually cost rather than on
 * the sticker price of one buy.
 *
 * Null when the position has no cost to measure against. A grant recorded at
 * zero, or a fully-sold position still carrying a row, would otherwise divide
 * by zero and report an infinite gain — which is exactly the shape of the
 * share-grant bug this ledger has already had once.
 */
export function evaluatePositionPnl(
  params: PositionPnlParams, avgCost: number, price: number,
): { pct: number } | null {
  if (!Number.isFinite(avgCost) || avgCost <= 0) return null;
  if (!Number.isFinite(price)) return null;
  const pct = ((price - avgCost) / avgCost) * 100;
  if (params.direction === "up" ? pct >= params.pct : pct <= -params.pct) return { pct };
  return null;
}

/**
 * Same shape as `PctMoveParams`, and deliberately its own type.
 *
 * They mean different things — one is a threshold on an asset, the other on a
 * portfolio — and sharing the schema would make it easy to hand one kind's
 * params to the other's evaluator without anything complaining.
 */
export const PortfolioMoveParams = z.object({
  /** Absolute move of the portfolio's total value, in percent. */
  threshold: z.number().positive(),
});
export type PortfolioMoveParams = z.infer<typeof PortfolioMoveParams>;

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
