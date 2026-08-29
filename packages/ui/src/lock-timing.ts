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

/**
 * The entrance, as four numbers that add up.
 *
 * These were scattered: a 380ms travel in the component, a 320ms fade after
 * it, and a flat 1,000ms splash here that had no relationship to either. The
 * sequence finished at 700ms and then the screen sat still for 300ms before
 * the system sheet arrived — the mark hurried to its place and then waited.
 *
 * So the splash is no longer a number of its own. It *is* the length of the
 * animation plus a beat, which means the movement can never overrun the
 * prompt and can never finish early enough to leave a dead pause.
 */

/**
 * The disc's diameter while the system splash is up, in CSS pixels.
 *
 * Not a choice. Android draws its splash icon at the size of its own icon
 * canvas — the inner 192dp of `core-splashscreen`'s 288dp box — and there is
 * no way to ask for less: sizing the drawable smaller was tried and changed
 * nothing, because One UI draws the launcher icon there rather than the
 * drawable we supply. Measured off a screen recording on a Galaxy S24 at 564
 * of 1080 device pixels, which is 188 CSS pixels at that screen's 3x.
 *
 * So the app's own splash draws the mark at this size rather than at
 * `LOCK_DISC_PX`, and the difference is spent during the travel instead of
 * jumped at the handover. It used to jump: 188 to 112, a shrink of two fifths,
 * on the one frame where the picture must not change.
 */
export const SPLASH_DISC_PX = 188;

/** The disc's diameter at rest, which is `BRAND.md`'s size and `MarkTile`'s. */
export const LOCK_DISC_PX = 112;

/** What the mark has to shrink by on its way to its resting place. */
export const SETTLE_SCALE = SPLASH_DISC_PX / LOCK_DISC_PX;

/** A moment held still first, so the splash reads as a splash and not as a start gun. */
export const SETTLE_DELAY_MS = 220;

/**
 * How long the mark takes to travel from the centre to its resting place.
 *
 * Slow on purpose. At 380ms with an ease-out quint the disc covered 96% of the
 * distance in the first half and then crept — which is what "it moves up too
 * quickly" means: not the duration alone, but a curve that spent it all at
 * once. See ENTRANCE_EASE.
 */
export const SETTLE_MS = 900;

/** The name, arriving only once the mark has stopped. */
export const TITLE_MS = 560;

/** Everything at rest, briefly, before the system takes the screen. */
export const REST_MS = 260;

/**
 * The easing of the travel, as a CSS timing function.
 *
 * Eased in as well as out. The mark is already still when it starts — it has
 * been the splash for a second — so a curve that begins at full speed reads as
 * a jump. This one leaves slowly, covers the middle, and settles.
 */
export const ENTRANCE_EASE = "cubic-bezier(0.45, 0, 0.15, 1)";

/** When the name begins to fade in: the moment the mark has arrived. */
export const TITLE_DELAY_MS = SETTLE_DELAY_MS + SETTLE_MS;

/**
 * How long the app's own screen is owed before the prompt covers it.
 *
 * Derived, not chosen: the entrance above, plus its beat of rest. Raising any
 * one of those raises this, which is the only way the sheet cannot arrive over
 * a mark still in flight.
 */
export const MIN_SPLASH_MS = SETTLE_DELAY_MS + SETTLE_MS + TITLE_MS + REST_MS;

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
