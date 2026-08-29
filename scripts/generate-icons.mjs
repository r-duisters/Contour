import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";

/**
 * A white level curve and a white rise on the brand-blue tile. Kept in step
 * with `packages/ui/src/ContourMark.tsx`, which carries the full reasoning —
 * change one and run this to redraw the rest.
 *
 * The ring is the level curve (what the name "Contour" means) and the line is
 * the price rising inside it. Both are white because the blue has moved from
 * the line to the tile; the colour now carries the identity.
 */

/**
 * The mark, optionally scaled about the centre to sit inside a safe area, and
 * optionally thickened for sizes where a faithful stroke would vanish.
 *
 * The scale is a transform rather than arithmetic on each coordinate, so the
 * stroke scales with the geometry for free.
 */
/**
 * Matches `ContourMark`'s viewBox, which windows 474 units of the 512 the
 * geometry is drawn in. Expressed here as a scale because this file grows the
 * mark with a transform rather than a viewBox; the two are the same thing.
 */
const GROW = 512 / 474;

const mark = (k = 1, w = 1) => `
  <g transform="translate(${256 * (1 - k * GROW)},${256 * (1 - k * GROW)}) scale(${k * GROW})">
    <circle cx="256" cy="256" r="160" fill="none" stroke="#ffffff"
            stroke-width="${12 * w}"/>
    <path d="M172,302 L228,244 L280,276 L348,190" fill="none" stroke="#ffffff"
          stroke-width="${30 * w}" stroke-linecap="round" stroke-linejoin="round"/>
  </g>`;

const icon = (pad) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${pad ? 0 : 96}" fill="#2563eb"/>
  ${mark(pad ? 0.74 : 1)}
</svg>`;

/**
 * The browser tab, which is drawn at 16–32px. The ring's own stroke is 12 units
 * of 512 — a fraction of a pixel at that size — so the favicon keeps the
 * geometry and thickens the strokes until they survive the resize. It is the
 * same mark, drawn to be legible rather than to scale.
 *
 * This exists because `apps/web/src/app/favicon.ico` was hand-made once and then sat
 * unchanged through two redesigns of the mark, which nothing caught.
 */
const favicon = () => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#2563eb"/>
  ${mark(1, 1.5)}
</svg>`;

/**
 * Android launcher icons are separate from the web manifest's.
 *
 * The adaptive icon is composed in XML rather than here — see
 * `android/app/src/main/res/drawable/ic_launcher_disc.xml`. What this file
 * still writes is the mark on transparency, which that drawable places on its
 * disc, and the legacy bitmaps for API 24 and 25, which have no adaptive icon
 * to compose.
 *
 * Those legacy bitmaps draw the disc themselves, for the same reason the
 * adaptive foreground does: the icon's shape has to belong to the artwork.
 * They also used to be identical files — `ic_launcher_round.png` was a
 * squircle, byte for byte the same as `ic_launcher.png`, on the one surface
 * whose whole purpose is to be round.
 */
/** The disc's share of the icon, matching `@dimen/adaptive_disc` (72 of 108dp). */
const DISC = 72 / 108;

/**
 * The launcher icon for API 24 and 25, which have no adaptive icon to mask.
 *
 * Each is what the adaptive icon *looks like* under the corresponding mask, so
 * the package contains one picture rather than two. Under a circular mask the
 * 72dp disc fills the visible 72dp exactly, which is a plain blue circle;
 * under a squircle it leaves the ground in the corners.
 *
 * They were drawn full-bleed blue for one build, on the reasoning that the
 * inset exists only to survive a mask and here there is none. That was true
 * and beside the point: it left the only blue square in the package, on a
 * launch that is still flashing one. Whatever surface is drawing it, it can no
 * longer be something we shipped.
 */
const legacyIcon = (round) => round
  ? `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <circle cx="256" cy="256" r="256" fill="#2563eb"/>
  ${mark(0.86)}
</svg>`
  : `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#0a0a0a"/>
  <circle cx="256" cy="256" r="${256 * DISC}" fill="#2563eb"/>
  ${mark(DISC * 0.86)}
</svg>`;

const DENSITIES = [
  ["mdpi", 48], ["hdpi", 72], ["xhdpi", 96], ["xxhdpi", 144], ["xxxhdpi", 192],
];

/**
 * A full circle as vector path data, since `<vector>` has no circle element.
 */
const disc = (cx, cy, r) =>
  `M${cx - r},${cy} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0`;

/**
 * The mark on its disc, as an Android vector drawable.
 *
 * Vector rather than a layer-list of a shape and a bitmap, and that is the
 * whole point of this function. Android sizes some drawables by scaling their
 * *intrinsic* size to fill the surface it is drawing into — that is measurably
 * what happens to the splash icon, where a disc declared at 112dp arrived at
 * 188dp because the disc was the largest thing in the drawable and so was the
 * drawable's intrinsic size. A layer-list's proportions are therefore not
 * safe. A vector's are: `viewportWidth` fixes the coordinate space, so the
 * disc stays the same fraction of the canvas at any size it is drawn.
 *
 * `canvas` is the drawable's own dp size, `discSize` the disc within it. The
 * mark is 86% of the disc, which is `MarkTile`'s rule, and is drawn from the
 * same 512-unit geometry as everything else here — placed by a group rather
 * than by re-typing the coordinates.
 */
const vectorIcon = (canvas, discSize) => {
  const c = canvas / 2;
  // 474 of the 512 units are the mark's own window; see GROW.
  const scale = (discSize * 0.86) / 474;
  return `<?xml version="1.0" encoding="utf-8"?>
<!--
  Generated by scripts/generate-icons.mjs. Do not edit by hand — edit the
  generator and run it, or the two disagree silently.
-->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="${canvas}dp"
    android:height="${canvas}dp"
    android:viewportWidth="${canvas}"
    android:viewportHeight="${canvas}">
    <path
        android:fillColor="#2563EB"
        android:pathData="${disc(c, c, discSize / 2)}" />
    <group
        android:pivotX="256"
        android:pivotY="256"
        android:scaleX="${scale.toFixed(6)}"
        android:scaleY="${scale.toFixed(6)}"
        android:translateX="${(c - 256).toFixed(3)}"
        android:translateY="${(c - 256).toFixed(3)}">
        <path
            android:strokeColor="#FFFFFF"
            android:strokeWidth="12"
            android:pathData="${disc(256, 256, 160)}" />
        <path
            android:strokeColor="#FFFFFF"
            android:strokeWidth="30"
            android:strokeLineCap="round"
            android:strokeLineJoin="round"
            android:pathData="M172,302 L228,244 L280,276 L348,190" />
    </group>
</vector>
`;
};

async function androidIcons() {
  const root = "android/app/src/main/res";
  try {
    await mkdir(root, { recursive: true });
  } catch {
    return;
  }
  const drawables = `${root}/drawable`;
  await mkdir(drawables, { recursive: true });
  // The adaptive icon's foreground: a 72dp disc in the 108dp layer, so a
  // launcher's mask crops the app's ground rather than the blue.
  await writeFile(`${drawables}/ic_launcher_disc.xml`, vectorIcon(108, 72));
  // The splash icon, whose disc fills its canvas because Android renders it at
  // the canvas size either way. `SPLASH_DISC_PX` in packages/ui carries the
  // measurement of what that comes out as.
  await writeFile(`${drawables}/contour_splash_icon.xml`, vectorIcon(192, 192));
  console.log("wrote", drawables);

  for (const [density, size] of DENSITIES) {
    const dir = `${root}/mipmap-${density}`;
    await mkdir(dir, { recursive: true });
    await sharp(Buffer.from(legacyIcon(false))).resize(size, size).png()
      .toFile(`${dir}/ic_launcher.png`);
    await sharp(Buffer.from(legacyIcon(true))).resize(size, size).png()
      .toFile(`${dir}/ic_launcher_round.png`);
    // The adaptive foreground is drawn at 108dp with only the centre visible,
    // and must be transparent so the background colour shows through.
    await sharp(Buffer.from(foreground())).resize(Math.round(size * 2.25), Math.round(size * 2.25))
      .png().toFile(`${dir}/ic_launcher_foreground.png`);
    console.log("wrote", dir);
  }
}

/**
 * The mark alone, on transparency, filling its canvas.
 *
 * Both `ic_launcher_disc.xml` and `contour_splash_icon.xml` place this on a
 * disc they draw themselves, so this file must not draw one — it would be
 * disc-on-disc. It must not carry an inset either, which it used to: at 0.52
 * of the canvas the mark came out at 52% of whatever disc it was dropped into,
 * while `MarkTile` — the same mark, on the same disc, one frame later on the
 * lock screen — draws it at 86%. The mark visibly grew during the handover.
 *
 * Full-bleed, every drawable names the size it wants, and 86% is stated once
 * per surface instead of hidden in this asset.
 */
const foreground = () => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${mark(1)}</svg>`;

await mkdir("apps/web/public/icons", { recursive: true });
const targets = [
  ["apps/web/public/icons/icon-192.png", 192, false],
  ["apps/web/public/icons/icon-512.png", 512, false],
  ["apps/web/public/icons/maskable-512.png", 512, true],
  ["apps/web/public/icons/apple-touch-icon.png", 180, true],
];
for (const [file, size, pad] of targets) {
  await sharp(Buffer.from(icon(pad))).resize(size, size).png().toFile(file);
  console.log("wrote", file);
}

// The tab icon is written to public/ and named explicitly in layout.tsx's
// metadata rather than relying on Next's `app/icon.png` convention: setting
// `metadata.icons` at all suppresses the convention, which silently left the
// app with no tab icon whatsoever.
await sharp(Buffer.from(favicon())).resize(64, 64).png().toFile("apps/web/public/icons/favicon-64.png");
console.log("wrote apps/web/public/icons/favicon-64.png");

await androidIcons();
