import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The mobile build calls Binance from the device with no server in between,
 * so this module ends up in a browser bundle. `ws` has no browser build and
 * would break that bundle at compile time.
 */
describe("binance.ts is safe to bundle for a browser", () => {
  it("does not import ws", () => {
    const src = readFileSync(join(process.cwd(), "packages/core/src/binance.ts"), "utf8");
    expect(src).not.toMatch(/from\s+"ws"/);
  });
});
