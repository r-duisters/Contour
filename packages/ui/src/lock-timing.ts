/**
 * How long the app's own screen stays up before the system's fingerprint
 * sheet covers it.
 *
 * Pure, and in its own module, because there is no component test stack in
 * this repository — no `@testing-library`, no jsdom — and the native path
 * cannot be exercised anywhere but a phone. Keeping the arithmetic here means
 * at least the timing rule is checked by something other than a person
 * watching a launch animation.
 */

/** Long enough to register as a deliberate entrance rather than a flicker. */
export const MIN_SPLASH_MS = 1_000;

/**
 * Milliseconds still owed to the splash, given when it started.
 *
 * The wait is measured from the moment the lock mounted, not from the moment
 * the biometry check returned — so a slow device that already spent a second
 * deciding does not then spend another one waiting. On a fast device the check
 * resolves almost immediately and nearly the whole second is still owed.
 *
 * A negative elapsed time means the clock moved backwards under us (a manual
 * change, an NTP correction). That is not a reason to skip the splash, so the
 * full delay is owed rather than none of it.
 */
export function remainingSplash(startedAt: number, now: number, min = MIN_SPLASH_MS): number {
  const elapsed = now - startedAt;
  if (!Number.isFinite(elapsed) || elapsed < 0) return min;
  return Math.max(0, min - elapsed);
}
