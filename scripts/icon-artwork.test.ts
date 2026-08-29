import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import sharp from "sharp";

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
