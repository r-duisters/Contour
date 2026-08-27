import { mkdir } from "node:fs/promises";
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
