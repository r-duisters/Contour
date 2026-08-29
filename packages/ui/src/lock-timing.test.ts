import { describe, expect, it } from "vitest";
import {
  LOCK_DISC_PX,
  MIN_SPLASH_MS,
  SETTLE_SCALE,
  SPLASH_DISC_PX,
  REST_MS,
  SETTLE_DELAY_MS,
  SETTLE_MS,
  TITLE_DELAY_MS,
  TITLE_MS,
  remainingSplash,
} from "./lock-timing";

describe("remainingSplash", () => {
  it("owes the whole second when the check returned instantly", () => {
    expect(remainingSplash(1_000, 1_000)).toBe(MIN_SPLASH_MS);
  });

  it("owes only the balance when the check already took time", () => {
    // 400ms spent deciding is 400ms off the splash, not another full one.
    expect(remainingSplash(1_000, 1_400)).toBe(MIN_SPLASH_MS - 400);
  });

  it("owes nothing once the splash has already been served", () => {
    expect(remainingSplash(1_000, 1_000 + MIN_SPLASH_MS + 1)).toBe(0);
  });

  it("owes nothing rather than a negative wait", () => {
    expect(remainingSplash(1_000, 99_999)).toBe(0);
  });

  it("owes the full delay when the clock moves backwards", () => {
    // An NTP correction mid-launch must not be read as "the splash is done".
    expect(remainingSplash(5_000, 1_000)).toBe(MIN_SPLASH_MS);
  });
});

/**
 * The entrance has to finish inside the splash it plays over.
 *
 * The two used to be unrelated numbers — a 380ms travel and a 320ms fade under
 * a flat 1,000ms wait — so the mark reached its place at 700ms and the screen
 * then sat still. Raising either half without the other would just as easily
 * have put the system's fingerprint sheet over a mark still in flight, and
 * nothing would have failed. Now the wait is the sum, and these check that it
 * stays one.
 */
describe("the entrance fits the splash", () => {
  it("ends with a beat to spare, not on the frame the prompt arrives", () => {
    expect(TITLE_DELAY_MS + TITLE_MS).toBe(MIN_SPLASH_MS - REST_MS);
    expect(REST_MS).toBeGreaterThan(0);
  });

  it("starts the name only once the mark has stopped moving", () => {
    expect(TITLE_DELAY_MS).toBe(SETTLE_DELAY_MS + SETTLE_MS);
  });

  it("holds the mark still before moving it", () => {
    expect(SETTLE_DELAY_MS).toBeGreaterThan(0);
  });
});

/**
 * The entrance's two disc sizes, and the one that is not ours to choose.
 *
 * `SPLASH_DISC_PX` is whatever Android's splash icon canvas renders at; the
 * app matches it so the handover shows the same picture. If someone "tidies"
 * the app's splash back to 112 to match the lock, the jump of two fifths comes
 * back and nothing else would notice.
 */
describe("the entrance's geometry", () => {
  it("shrinks the mark by exactly the difference between the two sizes", () => {
    expect(SETTLE_SCALE).toBeCloseTo(SPLASH_DISC_PX / LOCK_DISC_PX, 10);
  });

  it("starts larger than it ends, which is the direction the system forces", () => {
    expect(SPLASH_DISC_PX).toBeGreaterThan(LOCK_DISC_PX);
  });
});
