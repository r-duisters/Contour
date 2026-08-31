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

/**
 * The mark's own paths, in the 512-unit space the rest of this file draws in.
 *
 * The stroke widths are arguments because a group scales its strokes with its
 * geometry, so the only way to draw the same shape with heavier lines is to
 * state heavier lines in this space. The favicon needs that, and so does the
 * notification icon, for the same reason at different sizes.
 */
const markPaths = (ring = 12, line = 30) => `
        <path
            android:strokeColor="#FFFFFF"
            android:strokeWidth="${ring}"
            android:pathData="${disc(256, 256, 160)}" />
        <path
            android:strokeColor="#FFFFFF"
            android:strokeWidth="${line}"
            android:strokeLineCap="round"
            android:strokeLineJoin="round"
            android:pathData="M172,302 L228,244 L280,276 L348,190" />`;

const MARK_PATHS = markPaths();

/**
 * The mark, scaled to `size` and centred in a `canvas`-unit viewport.
 *
 * A group rather than re-typed coordinates, so the strokes scale with the
 * geometry. Android applies a group as translate(t) · translate(pivot) · scale
 * · translate(-pivot), so pivoting on the mark's own centre and then
 * translating to the canvas centre puts it where it belongs at any scale.
 */
const markGroup = (canvas, size, paths = MARK_PATHS) => `
    <group
        android:pivotX="256"
        android:pivotY="256"
        android:scaleX="${(size / 474).toFixed(6)}"
        android:scaleY="${(size / 474).toFixed(6)}"
        android:translateX="${(canvas / 2 - 256).toFixed(3)}"
        android:translateY="${(canvas / 2 - 256).toFixed(3)}">${paths}
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
 * The canvas Android scales a splash icon's visible content to fill, in dp,
 * and the inner circle it then masks that canvas to.
 *
 * Derived from three measured builds rather than from documentation. A disc
 * filling its viewport rendered at 188dp; the same disc at 89% of its viewport
 * also rendered at 188dp; and a disc at 59% behind an opaque circle filling the
 * viewport rendered at 172dp. One rule fits all three: the *visible content* is
 * scaled to fill 288dp, and the result is masked to the inner 192dp. The first
 * two cases have the disc itself as the content, so it fills 288 and the mask
 * shows 192 of it — which is why declaring a smaller disc changed nothing.
 */
const SPLASH_CANVAS_DP = 288;

/** The disc's diameter everywhere: `MarkTile`'s size, and the lock screen's. */
const DISC_DP = 112;

/**
 * The splash icon: the lock screen's disc, at the lock screen's size.
 *
 * A diagnostic build established that One UI honours
 * `windowSplashScreenAnimatedIcon` — coloured green, the splash came up green
 * — so this file is what gets drawn, and the only question was ever its size.
 *
 * The ground circle is what makes the size ours. It is the app's own
 * background colour on a splash whose background is that same colour, so it is
 * invisible; but it is opaque, so it is what Android measures, and the blue
 * disc keeps the fraction of it that this file declares. The viewport is the
 * canvas itself, so the disc's units are dp and there is no arithmetic to get
 * wrong: 112 of 288 renders at 112dp.
 */
const splashIcon = () =>
  vectorFile(
    SPLASH_CANVAS_DP,
    `
    <path
        android:fillColor="#0A0A0A"
        android:pathData="${disc(SPLASH_CANVAS_DP / 2, SPLASH_CANVAS_DP / 2, SPLASH_CANVAS_DP / 2)}" />
    <path
        android:fillColor="#2563EB"
        android:pathData="${disc(SPLASH_CANVAS_DP / 2, SPLASH_CANVAS_DP / 2, DISC_DP / 2)}" />${markGroup(SPLASH_CANVAS_DP, DISC_DP * 0.86)}`,
  );

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
  await writeFile(`${drawables}/ic_stat_contour.xml`, notificationIcon());
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

/**
 * The mark for the README, and for anywhere else outside the two apps.
 *
 * SVG rather than a PNG: GitHub renders it from a relative path, it stays
 * sharp on a retina screen at any size the markup asks for, and it is 300
 * bytes instead of a bitmap somebody would have to remember to regenerate at
 * two densities.
 *
 * A **circle**, not the rounded tile the launcher gets. Nothing masks this one:
 * on Android the tile exists because the launcher crops it to whatever shape it
 * likes, and shipping a square lets the mask decide. Off a phone there is no
 * mask, so the shape is ours to choose, and the disc is the one the app itself
 * draws — the unlock disc in `BiometricLock`, the splash, `MarkTile`.
 *
 * The mark sits at **86%** of it, which is `MarkTile`'s rule and the number
 * `docs/android-launch.md` spent a week arriving at. Full-bleed inside a circle
 * would put the ring's stroke on the edge, where the two curves fight.
 *
 * Blue disc, white mark: BRAND.md is explicit that the blue belongs to the
 * container. A transparent version would vanish into GitHub's dark theme and
 * reverse the one rule the mark has.
 *
 * Written here rather than drawn by hand for the reason the rest of this file
 * exists: `apps/web/src/app/favicon.ico` was hand-made once and then sat
 * through two redesigns of the mark, and nothing caught it.
 */
const roundMark = () => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <circle cx="256" cy="256" r="256" fill="#2563eb"/>
  ${mark(0.86)}
</svg>`;

/**
 * The notification icon, and why it is the mark without its tile.
 *
 * Android throws away every colour in a status-bar icon and keeps only the
 * alpha, then tints what is left — white on the status bar, the accent colour
 * in the shade. So the blue disc cannot come along: a filled circle has alpha
 * everywhere and would arrive as a solid white blob, which is what the app icon
 * renders as if you point a notification at it.
 *
 * The mark alone is already the right shape for this, because BRAND.md put the
 * colour on the container and left the ring and the rise as one white line.
 * Stripping the tile is not a compromise here; it is the same mark with the
 * part that cannot survive removed.
 *
 * Drawn at 24dp with the ring spanning 20 of it, which leaves the 2dp margin
 * Android's guidance asks for.
 *
 * That 20 is stated against the ring rather than handed to `markGroup` as a
 * `size`, because `size` is measured against the mark's 474-unit viewBox while
 * the ring is only 346 units across including its stroke. Asking for 20 the
 * usual way produced a 14.6dp ring adrift in a 24dp box — correct by the
 * function's own definition and visibly wrong on a status bar, which is the
 * kind of error only a rendering catches.
 *
 * The strokes are thickened because a group scales strokes with geometry: the
 * ring's 12 units of 512 would land at half a pixel and disappear entirely,
 * which is the mistake `favicon()` already documents at a different size. At
 * this scale they come out at 1.5dp and 3.0dp.
 *
 * Both notification paths need it named. `@capacitor/local-notifications` and
 * `@capacitor/background-runner` each read `smallIcon` from their own plugin
 * config and each fall back to `android.R.drawable.ic_dialog_info` — so before
 * this, every alert this app has ever posted wore Android's generic "i".
 */
const NOTIFICATION_RING_DP = 20;
/** Ring diameter plus its stroke, in the 512-unit space: 2 × 160 + 26. */
const RING_EXTENT_UNITS = 346;
const notificationIcon = () =>
  vectorFile(24, markGroup(24, (NOTIFICATION_RING_DP * 474) / RING_EXTENT_UNITS, markPaths(26, 52)));

await mkdir("docs/brand", { recursive: true });
await writeFile("docs/brand/contour-mark.svg", roundMark().trim() + "\n");
console.log("wrote docs/brand/contour-mark.svg");

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
