/**
 * How much of a gain was the asset, and how much was the currency.
 *
 * A holding bought in dollars and read in euros has two things moving under
 * it. The asset does what the asset does; the euro does what the euro does;
 * and the single percentage on the screen is their product, which credits the
 * asset for a currency move and blames it for one. Over the span of a real
 * ledger that is not a rounding difference — EUR/USD has taken a 24% range
 * since 2017 — and it is invisible in every figure the app draws.
 *
 * The split needs one number the app did not used to have: the rate the
 * position was actually acquired at. It comes from running the same rows
 * through `computeHoldings` twice, once in dollars and once in the display
 * currency struck at each trade's own date (`toUsdTxs` / `toDisplayTxs`), and
 * dividing one cost basis by the other. That is only meaningful because the
 * display cost is now struck at trade-date rates; before that it was struck at
 * today's, which made the ratio today's rate and the currency effect zero by
 * construction.
 *
 * Nothing here is a currency forecast, and nothing here says what to do about
 * it. It says what already happened.
 */

/** Everything one position contributes to the split. `costUsd` is its own. */
export type EffectInput = {
  /** Current value in the display currency, or null when unpriced. */
  value: number | null;
  /** Cost basis in the display currency, at the rates of the trade dates. */
  costDisplay: number;
  /** The same cost basis in USD, the currency the rows are stored in. */
  costUsd: number;
};

export type CurrencyEffect = {
  /**
   * What the position gained on its own merits: its return measured as though
   * the exchange rate had stayed where it was when the position was bought.
   */
  asset: number;
  /** What the exchange rate moving since has added to that, or taken off it. */
  currency: number;
  /** `asset + currency`, which is the unrealised gain the app already shows. */
  total: number;
  /** Display currency per USD, averaged over what the position cost. */
  acquiredRate: number;
  /** Display currency per USD today. */
  currentRate: number;
};

/**
 * The split for one position, or null when it cannot be stated.
 *
 * Null is the honest answer in more cases than it looks. A position with no
 * price has no gain to attribute; one with no USD cost — a gift, a fully
 * closed holding — has no acquisition rate to compare against; and a rate of
 * zero is what `displayContext` reports when the feed was unreachable, which
 * must not become a division.
 */
export function currencyEffect(
  { value, costDisplay, costUsd }: EffectInput,
  currentRate: number,
): CurrencyEffect | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (!(costUsd > 0) || !(costDisplay > 0)) return null;
  if (!(currentRate > 0) || !Number.isFinite(currentRate)) return null;

  const acquiredRate = costDisplay / costUsd;
  // What the position is worth in the currency it is stored in, valued back up
  // at the rate it was bought at: the same asset, the same quantity, an
  // exchange rate frozen on the days it was acquired.
  const heldRateValue = (value / currentRate) * acquiredRate;
  const asset = heldRateValue - costDisplay;
  const currency = value - heldRateValue;
  return { asset, currency, total: asset + currency, acquiredRate, currentRate };
}

export type PortfolioEffect = CurrencyEffect & {
  /** How many positions the split covers. The rest are `null` above. */
  covered: number;
  /** What those positions cost, in the display currency and in USD. */
  costDisplay: number;
  costUsd: number;
};

/**
 * The same split across a portfolio, or null when no position qualifies.
 *
 * The parts are summed rather than re-derived, so the total is exactly the sum
 * of the rows a screen can draw beside it.
 *
 * `acquiredRate` is weighted by what the positions are worth **now**, not by
 * what they cost. That is not a detail: the currency effect applies to today's
 * value, so a cost-weighted average does not reproduce it and the screen ends
 * up printing a rate that does not explain the figure beside it. On the live
 * ledger the two differed by €1,437, which a reader doing the arithmetic would
 * have found. Weighted this way, `value x (1 - acquired/current)` gives back
 * `currency` exactly, and "you bought your dollars at 0.89 and they are 0.86
 * today" is a sentence that survives being checked.
 *
 * `costDisplay` and `costUsd` stay cost-weighted, because they are costs.
 */
export function portfolioCurrencyEffect(
  inputs: EffectInput[],
  currentRate: number,
): PortfolioEffect | null {
  let asset = 0, currency = 0, costDisplay = 0, costUsd = 0, covered = 0;
  let valueUsd = 0, valueUsdAtAcquired = 0;
  for (const input of inputs) {
    const part = currencyEffect(input, currentRate);
    if (!part) continue;
    asset += part.asset;
    currency += part.currency;
    costDisplay += input.costDisplay;
    costUsd += input.costUsd;
    const positionUsd = input.value! / currentRate;
    valueUsd += positionUsd;
    valueUsdAtAcquired += positionUsd * part.acquiredRate;
    covered++;
  }
  if (covered === 0 || !(valueUsd > 0)) return null;
  return {
    asset,
    currency,
    total: asset + currency,
    acquiredRate: valueUsdAtAcquired / valueUsd,
    currentRate,
    covered,
    costDisplay,
    costUsd,
  };
}

/**
 * The currency's share of the gain, as a percentage, or null when the gain is
 * too near zero for a share of it to mean anything.
 *
 * The guard is not cosmetic. A position whose asset effect and currency effect
 * very nearly cancel has a total near zero and a ratio near infinity, and
 * "the currency accounted for 4,200% of your return" is arithmetically true
 * and useless. Below a thousandth of the cost basis the app says nothing.
 */
export function currencyShare(effect: CurrencyEffect, costDisplay: number): number | null {
  if (!(costDisplay > 0)) return null;
  if (Math.abs(effect.total) < costDisplay / 1000) return null;
  return (effect.currency / effect.total) * 100;
}
