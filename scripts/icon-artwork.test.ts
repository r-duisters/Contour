import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { ICON_DISC_FRACTION, SPLASH_CANVAS_PX, SPLASH_DISC_PX } from "../packages/ui/src/lock-timing";

/**
 * No launcher bitmap may be a full-bleed blue square.
 *
 * The app showed a blue square at launch for as long as it has existed, and
 * the reason was never the splash theme: the adaptive icon was a solid blue
 * background with the mark on top — artwork with no shape of its own — so
 * every launcher masked the blue to whatever it prefers. A circle on Pixel, a
 * squircle on One UI. No theme attribute reaches that, because the mask
 * belongs to the launcher.
 *
 * The fix was to move the disc into the artwork and let the mask crop the
 * app's ground instead. This test is what stops it drifting back: the corners
 * of every launcher bitmap must be ground or transparent, never the blue.
 *
 * It reads the shipped PNGs rather than the generator that writes them,
 * because `scripts/generate-icons.mjs` has to be *run* to matter and a commit
 * that edits it without running it is exactly the regression worth catching.
 */

const RES = new URL("../android/app/src/main/res/", import.meta.url).pathname;
const BLUE = { r: 0x25, g: 0x63, b: 0xeb };

/** How far off the brand blue a pixel may be and still count as it. */
const TOLERANCE = 24;

function densities(): string[] {
  return readdirSync(RES).filter((d) => d.startsWith("mipmap-") && !d.includes("anydpi"));
}

async function corner(file: string): Promise<{ r: number; g: number; b: number; a: number }> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // The top-left pixel: inside a squircle's corner, and inside a circle's, so
  // any artwork that fills its canvas edge to edge is caught by it.
  const [r, g, b, a] = data.subarray(0, info.channels);
  return { r, g, b, a };
}

const isBlue = (p: { r: number; g: number; b: number; a: number }) =>
  p.a > 8 &&
  Math.abs(p.r - BLUE.r) < TOLERANCE &&
  Math.abs(p.g - BLUE.g) < TOLERANCE &&
  Math.abs(p.b - BLUE.b) < TOLERANCE;

describe("launcher artwork", () => {
  for (const density of densities()) {
    it(`${density}: ic_launcher does not fill its corners with the brand blue`, async () => {
      const p = await corner(join(RES, density, "ic_launcher.png"));
      expect(isBlue(p), `${density}/ic_launcher.png corner is #${
        [p.r, p.g, p.b].map((n) => n.toString(16).padStart(2, "0")).join("")
      }`).toBe(false);
    });
  }

  /**
   * `ic_launcher_round.png` was byte-for-byte `ic_launcher.png` — a squircle,
   * on the one surface whose entire purpose is to be round. Nothing caught it
   * because nothing compared them.
   */
  it("the round icon is not simply a copy of the square one", () => {
    for (const density of densities()) {
      const square = readFileSync(join(RES, density, "ic_launcher.png"));
      const round = readFileSync(join(RES, density, "ic_launcher_round.png"));
      expect(square.equals(round), `${density}: round and square icons are identical`).toBe(false);
    }
  });

  /**
   * The adaptive icon's background layer is what a mask is cut from. The
   * moment it is the blue again, the launcher decides the app's shape again.
   */
  it("the adaptive icon's background layer is the app's ground, not the blue", () => {
    const xml = readFileSync(join(RES, "values", "ic_launcher_background.xml"), "utf8");
    expect(xml).toContain("@color/contour_ground");
    for (const name of ["ic_launcher.xml", "ic_launcher_round.xml"]) {
      const icon = readFileSync(join(RES, "mipmap-anydpi-v26", name), "utf8");
      expect(icon, name).toContain('android:drawable="@drawable/ic_launcher_disc"');
    }
  });
});

/**
 * Every picture in the launch draws its disc at the same share of its space.
 *
 * Android 12 cannot be told to skip its splash screen — an app chooses what is
 * on it, never whether it appears — and the launcher morphs its own icon into
 * that splash before the app draws anything. Three pictures, in a row, of the
 * same mark. Any two of them disagreeing on the disc's size is a switch a
 * person sees partway through the animation, and that is exactly what this app
 * did for months.
 *
 * The two Android icons are generated, so this reads the generated files
 * rather than the generator. The third is the app's own splash, which takes
 * its size from `SPLASH_DISC_PX`.
 */
describe("the launch draws one disc at one size", () => {
  /** The disc is the first <path> in each generated vector; its radius is in the arc. */
  function discFraction(file: string): number {
    const xml = readFileSync(join(RES, "drawable", file), "utf8");
    const viewport = Number(/android:viewportWidth="([\d.]+)"/.exec(xml)?.[1]);
    const radius = Number(/android:pathData="M[\d.-]+,[\d.-]+ a([\d.]+),/.exec(xml)?.[1]);
    expect(viewport, `${file}: no viewportWidth`).toBeGreaterThan(0);
    expect(radius, `${file}: no disc path`).toBeGreaterThan(0);
    return (radius * 2) / viewport;
  }

  /** What a launcher's mask crops an adaptive icon's 108dp layers to. */
  const MASK_DP = 72;
  const LAYER_DP = 108;

  it("the launcher icon's disc covers the agreed share of the masked icon", () => {
    // Declared against the 108dp layer, but only the masked 72 is ever seen.
    const ofLayer = discFraction("ic_launcher_disc.xml");
    expect(ofLayer * (LAYER_DP / MASK_DP)).toBeCloseTo(ICON_DISC_FRACTION, 2);
  });

  /**
   * The splash icon is the exception, and deliberately so.
   *
   * Android scales this drawable's visible content to fill its icon canvas, so
   * a disc drawn at 89% of the viewport came out at exactly the same 188dp as
   * one drawn at 100% — measured from a diagnostic build. The fraction here is
   * discarded, so the file states the truth: the disc fills it, and the app's
   * own splash matches the canvas rather than a share of it.
   */
  it("the splash icon's disc fills its viewport, which is what gets drawn", () => {
    expect(discFraction("contour_splash_icon.xml")).toBeCloseTo(1, 2);
  });

  it("the app's own splash matches the canvas the system renders", () => {
    expect(SPLASH_DISC_PX).toBe(SPLASH_CANVAS_PX);
  });
});
