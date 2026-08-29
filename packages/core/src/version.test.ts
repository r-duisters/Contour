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
});
