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
/**
 * The launcher icon for API 24 and 25, which have no adaptive icon to mask.
 *
 * Blue to the edge, matching the adaptive icon. `round` is `ic_launcher_round`,
 * which was once a squircle byte-identical to `ic_launcher` — the one surface
 * whose entire purpose is to be round.
 */
const legacyIcon = (round) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${round ? 256 : 96}" fill="#2563eb"/>
  ${mark(0.86)}
</svg>`;

const DENSITIES = [
  ["mdpi", 48], ["hdpi", 72], ["xhdpi", 96], ["xxhdpi", 144], ["xxxhdpi", 192],
];

/**
 * A full circle as vector path data, since `<vector>` has no circle element.
 */
const disc = (cx, cy, r) =>
  `M${cx - r},${cy} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0`;

/** The mark's own paths, in the 512-unit space the rest of this file draws in. */
const MARK_PATHS = `
        <path
            android:strokeColor="#FFFFFF"
            android:strokeWidth="12"
            android:pathData="${disc(256, 256, 160)}" />
        <path
            android:strokeColor="#FFFFFF"
            android:strokeWidth="30"
            android:strokeLineCap="round"
            android:strokeLineJoin="round"
            android:pathData="M172,302 L228,244 L280,276 L348,190" />`;

/**
 * The mark, scaled to `size` and centred in a `canvas`-unit viewport.
 *
 * A group rather than re-typed coordinates, so the strokes scale with the
 * geometry. Android applies a group as translate(t) · translate(pivot) · scale
 * · translate(-pivot), so pivoting on the mark's own centre and then
 * translating to the canvas centre puts it where it belongs at any scale.
 */
const markGroup = (canvas, size) => `
    <group
        android:pivotX="256"
        android:pivotY="256"
        android:scaleX="${(size / 474).toFixed(6)}"
        android:scaleY="${(size / 474).toFixed(6)}"
        android:translateX="${(canvas / 2 - 256).toFixed(3)}"
        android:translateY="${(canvas / 2 - 256).toFixed(3)}">${MARK_PATHS}
    </group>`;

const vectorFile = (canvas, body) => `<?xml version="1.0" encoding="utf-8"?>
<!--
  Generated by scripts/generate-icons.mjs. Do not edit by hand — edit the
  generator and run it, or the two disagree silently.
-->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="${canvas}dp"
    android:height="${canvas}dp"
    android:viewportWidth="${canvas}"
    android:viewportHeight="${canvas}">${body}
</vector>
`;

/**
 * The adaptive icon's foreground: the mark alone, on the blue behind it.
 *
 * The disc used to live here, on the app's ground, so that a launcher's mask
 * would crop ground rather than blue and the icon stayed a circle whatever
 * shape the launcher preferred. That is no longer wanted: on One UI it left
 * dark corners around the blue, and the tile reads better filled. So the blue
 * is the background layer again and the shape is the launcher's to choose.
 *
 * 62 of 108 is 86% of the 72dp a mask crops to — `MarkTile`'s rule, measured
 * against what is actually visible rather than against the full layer.
 */
const launcherForeground = () => vectorFile(108, markGroup(108, 62));

/**
 * The splash icon, drawn to come out the size of the lock screen's disc.
 *
 * Two things a diagnostic build established. One UI honours
 * `windowSplashScreenAnimatedIcon` — coloured green, the splash came up green
 * — so this file is what gets drawn. And Android scales the drawable's
 * *visible content* to fill its icon canvas: a disc at 89% of the viewport
 * rendered at exactly the same 188dp as one at 100%, so a fraction declared
 * inside the drawable is discarded.
 *
 * Hence the ground circle. It is the app's own background colour, on a splash
 * whose background is that same colour, so it is invisible — but it is opaque,
 * and it makes the visible content the whole viewport. The blue disc is then
 * the fraction of that viewport it claims to be, and 112 of 188 comes out at
 * the 112dp the lock screen draws. One disc, one size, from the launch window
 * to the fingerprint prompt.
 */
const splashIcon = () => {
  // 188 is the canvas Android renders this at, measured on a Galaxy S24.
  const canvas = 192;
  const size = Math.round((canvas * 112) / 188);
  return vectorFile(
    canvas,
    `
    <path
        android:fillColor="#0A0A0A"
        android:pathData="${disc(canvas / 2, canvas / 2, canvas / 2)}" />
    <path
        android:fillColor="#2563EB"
        android:pathData="${disc(canvas / 2, canvas / 2, size / 2)}" />${markGroup(canvas, size * 0.86)}`,
  );
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
  await writeFile(`${drawables}/ic_launcher_mark.xml`, launcherForeground());
  await writeFile(`${drawables}/contour_splash_icon.xml`, splashIcon());
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
