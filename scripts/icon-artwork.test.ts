import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOCK_DISC_PX, SPLASH_DISC_PX, SPLASH_ICON_CANVAS_DP } from "../packages/ui/src/lock-timing";

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
    // Content fills the canvas, so the disc's share of the viewport is its
    // share of those 288dp.
    const rendered = (radii(xml)[1] * 2 * SPLASH_ICON_CANVAS_DP) / viewport;
    expect(rendered).toBeCloseTo(LOCK_DISC_PX, 0);
  });

  it("has the app's own splash agree with it", () => {
    expect(SPLASH_DISC_PX).toBe(LOCK_DISC_PX);
  });
});

describe("the mark outside the two apps", () => {
  /**
   * The README's logo is generated, not drawn.
   *
   * `apps/web/src/app/favicon.ico` was made by hand once and then sat through
   * two redesigns of the mark while nothing noticed. A README logo is the same
   * shape of mistake with a wider audience — it is the first thing anyone sees
   * of this project, and the one asset nobody opens again after adding it.
   *
   * So it is asserted against the generator's own geometry rather than eyeballed:
   * the brand blue, the ring at r=160, and the rising line's exact path.
   */
  it("is a disc, not the launcher's tile", () => {
    const svg = readFileSync(
      new URL("../docs/brand/contour-mark.svg", import.meta.url).pathname, "utf8",
    );
    // The tile exists so a launcher's mask can crop it. Nothing masks this one,
    // so it is the disc the app itself draws — BiometricLock, the splash,
    // MarkTile — rather than a square waiting to be cut.
    expect(svg, "the README mark should be a circle").toContain('<circle cx="256" cy="256" r="256"');
    expect(svg, "a rounded rect here means the launcher tile leaked out of Android").not.toContain("<rect");
    // 86% of the disc, MarkTile's rule. Full-bleed would put the ring's stroke
    // on the disc's edge, where the two curves fight.
    // 0.86 of the disc, grown by 512/474 because the mark's own viewBox windows
    // 474 of the 512 units it is drawn in. Asserting the product rather than a
    // range: a full-bleed mark scales to ~1.08 and would sail past a loose bound.
    const scale = Number(/scale\(([0-9.]+)\)/.exec(svg)?.[1]);
    expect(scale, "the mark should be inset to 86% of the disc, not full-bleed")
      .toBeCloseTo(0.86 * (512 / 474), 5);
  });

  it("carries the blue tile and the current geometry", () => {
    const svg = readFileSync(
      new URL("../docs/brand/contour-mark.svg", import.meta.url).pathname, "utf8",
    );
    expect(svg, "the tile is the brand blue — BRAND.md puts the colour on the container").toContain('fill="#2563eb"');
    expect(svg, "the ring is the level curve the name means").toContain('r="160"');
    expect(svg, "the line rises; a redrawn mark must regenerate this file")
      .toContain("M172,302 L228,244 L280,276 L348,190");
    // White on blue, and only white: BRAND.md forbids gain/loss colour in the mark.
    expect(svg).not.toMatch(/#(?!ffffff|2563eb)[0-9a-f]{6}/i);
  });
});

describe("the notification icon", () => {
  const drawable = () => readFileSync(
    new URL("../android/app/src/main/res/drawable/ic_stat_contour.xml", import.meta.url).pathname,
    "utf8",
  );

  /**
   * No filled shape, and this is the whole design constraint.
   *
   * Android keeps only a status-bar icon's alpha channel and tints what is
   * left. Anything filled arrives as a solid silhouette — point a notification
   * at the app icon and you get a white blob, because the blue tile has alpha
   * everywhere. The mark survives the treatment precisely because BRAND.md put
   * the colour on the container and left the ring and the rise as strokes.
   */
  it("is strokes only — a fill would post as a white blob", () => {
    const xml = drawable();
    expect(xml, "a fillColor here becomes a solid silhouette in the status bar")
      .not.toMatch(/android:fillColor="(?!#00000000)/);
    expect(xml).toContain('android:strokeColor="#FFFFFF"');
  });

  /**
   * The ring fills 20dp of the 24dp canvas, leaving Android's 2dp margin.
   *
   * Asserted as the rendered size rather than as the `size` argument, because
   * those are not the same number: `markGroup` measures against the mark's
   * 474-unit viewBox while the ring is 346 units across including its stroke,
   * and passing 20 the obvious way produced a 14.6dp ring adrift in the box.
   */
  it("draws the ring at 20dp of 24, with strokes that survive the size", () => {
    const xml = drawable();
    const scale = Number(/android:scaleX="([\d.]+)"/.exec(xml)?.[1]);
    expect(346 * scale, "the ring should span 20dp of the 24dp icon").toBeCloseTo(20, 1);
    const widths = [...xml.matchAll(/android:strokeWidth="(\d+)"/g)].map((m) => Number(m[1]) * scale);
    for (const w of widths) {
      expect(w, `a ${w.toFixed(2)}dp stroke disappears at notification size`).toBeGreaterThan(1);
    }
  });

  /**
   * Both plugins, because both post notifications and each reads `smallIcon`
   * from its own config. Setting one leaves half this app's alerts wearing
   * `android.R.drawable.ic_dialog_info`, which is where both started.
   */
  it("is named by both notification plugins", () => {
    const config = readFileSync(new URL("../capacitor.config.ts", import.meta.url).pathname, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect((config.match(/smallIcon:\s*"ic_stat_contour"/g) ?? []).length,
      "both LocalNotifications and BackgroundRunner must name it").toBe(2);
  });
});
