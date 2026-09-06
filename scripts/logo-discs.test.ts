import { describe, expect, it } from "vitest";
import { DISCLESS_LOGOS } from "../packages/core/src/logo-discs";

/**
 * The disc behind each logo is chosen from the artwork, and stays chosen.
 *
 * `CoinIcon` drew every logo on white. That is invisible for most of them —
 * their artwork fills the circle — and wrong for the pale ones where it shows:
 * GAS covers 83% of its disc and meets white at 1.6:1.
 *
 * **This used to re-measure, and cannot any more.** The artwork was in the
 * repository then; it is not now, because we have no right to redistribute it
 * (`docs/asset-logos.md`). Re-measuring would mean downloading from three CDNs
 * inside a unit test — slow, flaky, and failing on a train. `logo-disc.mjs`
 * downloads and re-measures on demand instead, and what is left here are the
 * invariants that hold without the images.
 *
 * What that gives up is real: a stale list is no longer caught automatically.
 * What it would have cost is a test suite that needs a network.
 */
describe("logo disc choices", () => {
  /**
   * The whole point is that neither ground is right for everything. A list
   * that collapsed to nothing — or to everything — would mean the measurement
   * had stopped discriminating, which a threshold edit could do silently.
   */
  it("splits the logos rather than collapsing to one answer", () => {
    expect(DISCLESS_LOGOS.size).toBeGreaterThan(5);
    expect(DISCLESS_LOGOS.size).toBeLessThan(100);
  });

  /**
   * Immutable X is the case the white disc was introduced for: pure black on
   * transparent, invisible on the app's own ground. It must never be in the
   * discless list, whatever a re-measure decides about anything else.
   */
  it("leaves the mark that would vanish on its white disc", () => {
    expect(DISCLESS_LOGOS.has("IMX")).toBe(false);
  });

  /**
   * Tickers, not filenames or pairs — `CoinIcon` looks this up by base asset,
   * so a `BTCUSDT` in here would simply never match anything.
   *
   * Tether is the exception that makes the rule need writing carefully: `USDT`
   * is a bare asset that ends with the quote asset's own name, so "does not
   * end in USDT" is wrong and "is not longer than USDT while ending in it" is
   * what was meant.
   */
  it("names bare assets, which is what CoinIcon looks up", () => {
    for (const ticker of DISCLESS_LOGOS) {
      expect(ticker, `${ticker} should be a bare ticker`).toMatch(/^[A-Z0-9.]+$/);
      const isPair = ticker.endsWith("USDT") && ticker.length > 4;
      expect(isPair, `${ticker} is a pair, not an asset`).toBe(false);
    }
  });
});
