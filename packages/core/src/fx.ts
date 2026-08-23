const DAY_MS = 86_400_000;

/**
 * Nearest rate at or before `time`, tolerating weekend/holiday gaps.
 *
 * Fetching the rates is `packages/data/src/sources/fx.ts`'s job — this module
 * is pure so that importing it drags no transport into a device bundle.
 */
export function rateOn(rates: Map<number, number>, time: number, maxLookbackDays = 5): number | null {
  const day = Math.floor(time / DAY_MS) * DAY_MS;
  for (let d = 0; d <= maxLookbackDays; d++) {
    const r = rates.get(day - d * DAY_MS);
    if (r !== undefined) return r;
  }
  return null;
}
