import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DISCLESS_LOGOS } from "../packages/core/src/logo-discs";
// The rule itself, so the test cannot drift from what generated the list.
import { bundledTickers, discless, measure } from "./logo-disc.mjs";

/**
 * The disc behind each logo is chosen from the artwork, and stays chosen.
 *
 * `CoinIcon` drew every logo on white. That is invisible for 239 of the 274
 * bundled logos — their artwork fills the circle — and wrong for 23 of the 35
 * where it shows: GAS covers 83% of its disc and meets white at 1.6:1.
 *
 * The list is generated, so the failure worth catching is a refreshed bundle
 * with a stale manifest: new artwork, old decision, and a logo drawn on the
 * ground it was measured not to suit. Nothing else would notice, because the
 * two files are edited by different commands.
 */
describe("logo disc choices", () => {
  it("matches what the current artwork measures", async () => {
    const expected = await discless();
    expect([...DISCLESS_LOGOS].sort()).toEqual(expected.sort());
  }, 60_000);

  it("names only tickers that are actually bundled", () => {
    const bundled = new Set(bundledTickers());
    for (const ticker of DISCLESS_LOGOS) {
      expect(bundled.has(ticker), `${ticker} is in the manifest but not in the bundle`).toBe(true);
    }
  });

  /**
   * The whole point is that neither ground is right for everything. If every
   * logo lands on the same answer, the measurement has stopped discriminating
   * — a resize, a colour-space change or a threshold edit could do that
   * silently.
   */
  it("still splits the logos rather than collapsing to one answer", () => {
    expect(DISCLESS_LOGOS.size).toBeGreaterThan(5);
    expect(DISCLESS_LOGOS.size).toBeLessThan(bundledTickers().length / 2);
  });

  it("leaves a mark that would vanish on the ground on its white disc", async () => {
    // Immutable X is the case the white disc was introduced for: pure black on
    // transparent, invisible on #0a0a0a.
    const imx = await measure("apps/mobile/public/icons/assets/IMX.png");
    expect(imx.disc).toBe("white");
    expect(DISCLESS_LOGOS.has("IMX")).toBe(false);
  }, 20_000);
});
