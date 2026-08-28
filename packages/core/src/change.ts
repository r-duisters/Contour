/**
 * The money behind a percentage move.
 *
 * Every percentage this app shows beside a holding is the *asset's* price
 * return over the window — `series.ts` says so where it computes them: "the
 * asset's price return, not the position's — buying more mid-period does not
 * flatter it." Turning that into a currency figure keeps the same basis: it
 * answers "the asset moved this much; on what I hold, that is this many
 * euros", and the pair on screen always agrees with itself.
 *
 * What it deliberately does NOT claim is what the position actually made. A
 * holding bought halfway through the window is priced here as though it had
 * been held throughout, so the figure runs high. That caveat belongs to the
 * percentage already; this only states it in a currency, where it is easier to
 * mistake for realised profit.
 *
 * There is a point where that stops being a caveat and becomes a false
 * statement, and `positionChangeOverWindow` below is where the line is drawn.
 */

/**
 * Value gained or lost, given what the position is worth now and how far the
 * price moved to get there.
 *
 * Works backwards from the current value rather than forwards from an opening
 * one, because the opening value is not on screen and the current one is:
 * `before = value / (1 + pct/100)`, and the answer is the difference.
 *
 * `null` where the arithmetic cannot mean anything — a total wipeout (−100%)
 * divides by zero, and a missing price gives no value to work from. A caller
 * that gets `null` shows the percentage alone rather than a fabricated zero.
 */
export function changeFromPct(value: number | null, pct: number | null): number | null {
  if (value === null || pct === null) return null;
  if (!Number.isFinite(value) || !Number.isFinite(pct)) return null;
  const factor = 1 + pct / 100;
  if (factor <= 0) return null;
  const before = value / factor;
  const delta = value - before;
  return Number.isFinite(delta) ? delta : null;
}

/**
 * The same figure, withheld when the window began before the position did.
 *
 * "The asset moved this much; on what I hold, that is this many euros" is a
 * fair reading while the window is one the position lived through. Over a
 * window that predates it, the sentence describes money that was never at
 * stake: 250 shares of a stock bought in January 2026, shown against a
 * twenty-six-year price history, read as a €4,288 loss beside a €1,000 cost
 * basis. The percentage is still true — it is the asset's price return and
 * says nothing about who held it — so it stays, and only the currency figure
 * goes.
 *
 * `null` for either bound means "not known", and an unknown bound cannot
 * disprove the figure, so it is shown. The caller that has neither gets the
 * behaviour it always had.
 */
export function positionChangeOverWindow({
  value,
  pct,
  heldSince,
  windowStart,
}: {
  value: number | null;
  pct: number | null;
  /** When the position was opened — the earliest transaction in this asset. */
  heldSince: number | null;
  /** The first moment the window covers. */
  windowStart: number | null;
}): number | null {
  if (heldSince !== null && windowStart !== null && heldSince > windowStart) return null;
  return changeFromPct(value, pct);
}
