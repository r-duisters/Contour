import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOCK_DISC_PX, SPLASH_CANVAS_PX, SPLASH_DISC_PX } from "../packages/ui/src/lock-timing";

/**
 * The launcher icon is one filled tile, and the mark inside it is the mark.
 *
 * This file used to assert the opposite: that no launcher bitmap fills its
 * corners with the brand blue, because a full-bleed blue icon lets the
 * launcher decide the app's shape and One UI decides squircle. That was
 * reversed on the owner's call after seeing it — the disc-on-ground version
 * left black corners around the blue and the tile read worse for it. The
 * shape is the launcher's; the colour is ours.
 *
 * What stays worth guarding is what actually broke: the two bitmaps being the
 * same file, and the foreground carrying its own disc, which would put a disc
 * on a disc.
 */

const RES = new URL("../android/app/src/main/res/", import.meta.url).pathname;

function densities(): string[] {
  return readdirSync(RES).filter((d) => d.startsWith("mipmap-") && !d.includes("anydpi"));
}

describe("launcher artwork", () => {
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

  it("fills the adaptive icon's background with the blue, not the ground", () => {
    const xml = readFileSync(join(RES, "values", "ic_launcher_background.xml"), "utf8");
    expect(xml).toContain("@color/contour_blue");
  });

  /**
   * The background layer is already the blue, so a disc in the foreground
   * would be a disc drawn on a disc. The foreground is the mark alone.
   */
  it("keeps the foreground to the mark alone", () => {
    for (const name of ["ic_launcher.xml", "ic_launcher_round.xml"]) {
      const icon = readFileSync(join(RES, "mipmap-anydpi-v26", name), "utf8");
      expect(icon, name).toContain('android:drawable="@drawable/ic_launcher_mark"');
    }
    const mark = readFileSync(join(RES, "drawable", "ic_launcher_mark.xml"), "utf8");
    expect(mark).not.toContain("fillColor");
  });
});

/**
 * Every picture in the launch shows the mark at the same size.
 *
 * Android 12 cannot be told to skip its splash screen — an app chooses what is
 * on it, never whether it appears — so the launch is unavoidably three
 * pictures of the same mark in a row. They must agree, and for months they did
 * not: the splash drew it at 188dp and the app then drew it at 112, a shrink
 * of two fifths on the frame where the picture must not change.
 *
 * The splash icon defeats Android's content-normalisation with an invisible
 * ground circle, so its blue disc is genuinely 112 of the 188 canvas. These
 * check that the trick is still in the file and that the app still agrees with
 * what it produces.
 */
describe("the launch draws one disc at one size", () => {
  const splash = () => readFileSync(join(RES, "drawable", "contour_splash_icon.xml"), "utf8");

  /** Each <path>'s arc radius, in viewport units, in document order. */
  function radii(xml: string): number[] {
    return [...xml.matchAll(/android:pathData="M[\d.-]+,[\d.-]+ a([\d.]+),/g)].map((m) => Number(m[1]));
  }

  it("keeps the invisible ground circle that makes the disc sizeable at all", () => {
    const xml = splash();
    expect(xml).toContain('android:fillColor="#0A0A0A"');
    const viewport = Number(/android:viewportWidth="([\d.]+)"/.exec(xml)?.[1]);
    // The ground circle is first and fills the viewport; without it Android
    // scales the blue disc up to the whole canvas and the size is not ours.
    expect(radii(xml)[0] * 2).toBeCloseTo(viewport, 5);
  });

  it("draws its blue disc at the lock screen's size", () => {
    const xml = splash();
    const viewport = Number(/android:viewportWidth="([\d.]+)"/.exec(xml)?.[1]);
    const rendered = (radii(xml)[1] * 2 * SPLASH_CANVAS_PX) / viewport;
    expect(rendered).toBeCloseTo(LOCK_DISC_PX, 0);
  });

  it("has the app's own splash agree with it", () => {
    expect(SPLASH_DISC_PX).toBe(LOCK_DISC_PX);
  });
});
