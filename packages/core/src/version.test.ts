import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_VERSION } from "./version";

describe("the version the app shows", () => {
  it("is the version the repository claims", () => {
    // Two copies of a string are fine as long as they cannot drift unnoticed.
    const manifest = JSON.parse(
      readFileSync(join(__dirname, "..", "..", "..", "package.json"), "utf8"),
    ) as { version: string };
    expect(APP_VERSION).toBe(manifest.version);
  });

  /**
   * The third reader, and the one that was wrong for months.
   *
   * `versionName` was a literal `"1.0"` — the Android template's default, never
   * touched — while this file said 0.1.0 and the About screen showed it. A
   * person could open Android's app-info page and the app's own About screen
   * and be told two different versions, both sincerely.
   *
   * It reads `package.json` now, so the values cannot differ. This asserts the
   * *derivation* rather than the value: typing a literal back in is the
   * regression, and it would pass any test that only compared strings.
   */
  it("is derived in the APK rather than typed again", () => {
    const gradle = readFileSync(
      join(__dirname, "..", "..", "..", "android", "app", "build.gradle"), "utf8",
    );
    expect(gradle, "versionName should read package.json, not a literal")
      .toMatch(/versionName\s+contourVersionName\b/);
    expect(gradle, "the derivation should parse package.json")
      .toMatch(/JsonSlurper[\s\S]{0,120}package\.json/);
  });
});
