import { mkdir } from "node:fs/promises";
import sharp from "sharp";

/**
 * A rising line over a contour: a green trend line climbing left to right to
 * an arrowhead, drawn over the quiet outline of a summit. Kept in step with
 * `packages/ui/src/ContourMark.tsx`, which carries the full reasoning — change
 * one and run this to redraw the rest.
 *
 * The outline stays dim on purpose: the app frames the mark in a circle twice
 * (the unlock disc, and Android's adaptive mask), and an outline at that
 * frame's weight competes with it. Weight and contrast decide this, not
 * whether the shape is closed.
 */
const BACKDROP = "M256,118 L394,356 L118,356 Z";
const TREND = "M96,366 L173,299 Q190,284 210,294 L248,314 Q268,324 281,306 L408,140";
const HEAD = "M356,140 L408,140 L408,192";

/**
 * The mark, optionally scaled about the centre to sit inside a safe area, and
 * optionally thickened for sizes where a faithful stroke would vanish.
 *
 * The scale is a transform rather than arithmetic on each coordinate: the
 * trend line is a curve, so there are no longer polygon points to walk, and a
 * transform scales the stroke with the geometry for free.
 */
const mark = (k = 1, w = 1) => `
  <g transform="translate(${256 * (1 - k)},${256 * (1 - k)}) scale(${k})">
    <path d="${BACKDROP}" fill="none" stroke="#fafafa"
          stroke-width="${22 * w}" opacity="${0.32 * (w > 1 ? 1.3 : 1)}" stroke-linejoin="round"/>
    <path d="${TREND}" fill="none" stroke="#22c55e"
          stroke-width="${24 * w}" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="${HEAD}" fill="none" stroke="#22c55e"
          stroke-width="${24 * w}" stroke-linejoin="round" stroke-linecap="round"/>
  </g>`;

const icon = (pad) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${pad ? 0 : 96}" fill="#0a0a0a"/>
  ${mark(pad ? 0.74 : 1)}
</svg>`;

/**
 * The browser tab, which is drawn at 16–32px. The mark's own stroke is 14 units
 * of 512 — a quarter of a pixel at that size, which renders as a grey smudge —
 * so the favicon keeps the geometry and thickens the strokes until they survive
 * the resize. It is the same summit, drawn to be legible rather than to scale.
 *
 * This exists because `apps/web/src/app/favicon.ico` was hand-made once and then sat
 * unchanged through two redesigns of the mark, which nothing caught.
 */
const favicon = () => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#0a0a0a"/>
  ${mark(1, 1.5)}
</svg>`;

/**
 * Android launcher icons are separate from the web manifest's: the adaptive
 * icon draws `foreground` on a coloured background, and its art must sit
 * inside the middle ~66% or the launcher's mask crops it.
 */
const DENSITIES = [
  ["mdpi", 48], ["hdpi", 72], ["xhdpi", 96], ["xxhdpi", 144], ["xxxhdpi", 192],
];

async function androidIcons() {
  const root = "android/app/src/main/res";
  try {
    await mkdir(root, { recursive: true });
  } catch {
    return;
  }
  for (const [density, size] of DENSITIES) {
    const dir = `${root}/mipmap-${density}`;
    await mkdir(dir, { recursive: true });
    // Square and round launcher icons keep the rounded-rect artwork.
    await sharp(Buffer.from(icon(false))).resize(size, size).png()
      .toFile(`${dir}/ic_launcher.png`);
    await sharp(Buffer.from(icon(false))).resize(size, size).png()
      .toFile(`${dir}/ic_launcher_round.png`);
    // The adaptive foreground is drawn at 108dp with only the centre visible,
    // and must be transparent so the background colour shows through.
    await sharp(Buffer.from(foreground())).resize(Math.round(size * 2.25), Math.round(size * 2.25))
      .png().toFile(`${dir}/ic_launcher_foreground.png`);
    console.log("wrote", dir);
  }
}

/**
 * The adaptive foreground draws on the launcher's own background layer, and
 * only the middle ~66% survives the mask.
 */
const foreground = () => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${mark(0.52)}</svg>`;

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
