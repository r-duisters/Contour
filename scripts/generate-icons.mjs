import { mkdir } from "node:fs/promises";
import sharp from "sharp";

/**
 * A summit drawn as its own level curves: two nested contour lines around a
 * peak, the outer a quiet hairline and the inner the brand blue. The blue sits
 * on the summit (the subject) rather than the frame.
 *
 * The outer curve stays dim on purpose: the app frames the mark in a circle
 * twice (the unlock disc, and Android's adaptive mask), and a curve at that
 * frame's weight competes with it. Weight and contrast decide this, not whether
 * the shape is closed.
 */
const OUTER = [[256, 118], [394, 356], [118, 356]];
const INNER = [[256, 196], [344, 356], [168, 356]];

/** The mark, optionally scaled about the centre to sit inside a safe area. */
const mark = (k = 1) => {
  const t = (v) => 256 + (v - 256) * k;
  const poly = (pts) => "M" + pts.map(([x, y]) => `${t(x)},${t(y)}`).join(" L") + " Z";
  return `
  <path d="${poly(OUTER)}" fill="none" stroke="#fafafa"
        stroke-width="${14 * k}" opacity="0.35" stroke-linejoin="round"/>
  <path d="${poly(INNER)}" fill="none" stroke="#3b82f6"
        stroke-width="${14 * k}" stroke-linejoin="round"/>`;
};

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
 * This exists because `src/app/favicon.ico` was hand-made once and then sat
 * unchanged through two redesigns of the mark, which nothing caught.
 */
const favicon = () => {
  const poly = (pts) => "M" + pts.map(([x, y]) => `${x},${y}`).join(" L") + " Z";
  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#0a0a0a"/>
  <path d="${poly(OUTER)}" fill="none" stroke="#fafafa"
        stroke-width="34" opacity="0.45" stroke-linejoin="round"/>
  <path d="${poly(INNER)}" fill="none" stroke="#3b82f6"
        stroke-width="34" stroke-linejoin="round"/>
</svg>`;
};

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

await mkdir("public/icons", { recursive: true });
const targets = [
  ["public/icons/icon-192.png", 192, false],
  ["public/icons/icon-512.png", 512, false],
  ["public/icons/maskable-512.png", 512, true],
  ["public/icons/apple-touch-icon.png", 180, true],
];
for (const [file, size, pad] of targets) {
  await sharp(Buffer.from(icon(pad))).resize(size, size).png().toFile(file);
  console.log("wrote", file);
}

// The tab icon is written to public/ and named explicitly in layout.tsx's
// metadata rather than relying on Next's `app/icon.png` convention: setting
// `metadata.icons` at all suppresses the convention, which silently left the
// app with no tab icon whatsoever.
await sharp(Buffer.from(favicon())).resize(64, 64).png().toFile("public/icons/favicon-64.png");
console.log("wrote public/icons/favicon-64.png");

await androidIcons();
