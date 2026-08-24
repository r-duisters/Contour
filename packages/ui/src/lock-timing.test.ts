import { describe, expect, it } from "vitest";
import { MIN_SPLASH_MS, remainingSplash } from "./lock-timing";

describe("remainingSplash", () => {
  it("owes the whole second when the check returned instantly", () => {
    expect(remainingSplash(1_000, 1_000)).toBe(MIN_SPLASH_MS);
  });

  it("owes only the balance when the check already took time", () => {
    // 400ms spent deciding leaves 600ms of splash, not another full second.
    expect(remainingSplash(1_000, 1_400)).toBe(600);
  });

  it("owes nothing once the second has already passed", () => {
    expect(remainingSplash(1_000, 2_500)).toBe(0);
  });

  it("owes nothing rather than a negative wait", () => {
    expect(remainingSplash(1_000, 99_999)).toBe(0);
  });

  it("owes the full delay when the clock moves backwards", () => {
    // An NTP correction mid-launch must not be read as "the splash is done".
    expect(remainingSplash(5_000, 1_000)).toBe(MIN_SPLASH_MS);
  });
});
