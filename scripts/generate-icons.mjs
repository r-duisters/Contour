import { mkdir } from "node:fs/promises";
import sharp from "sharp";

/**
 * Three contour lines descending to a point. A contour joins points of equal
 * value, and a field of them is how a gradient is drawn flat. Every level is a
 * true parallel offset of the outer one — same angle, differing only in depth.
 * Flat accent blue; a gradient fill was tried and dropped.
 */
const TOP = 150, OUTER_APEX = 392, OUTER_X = 108, APEXES = [392, 300, 208];

/** The mark, optionally scaled about the centre to sit inside a safe area. */
const mark = (k = 1) => {
  const t = (v) => 256 + (v - 256) * k;
  return APEXES.map((apex) => {
    const dx = ((256 - OUTER_X) / (OUTER_APEX - TOP)) * (apex - TOP);
    return `<polyline points="${t(256 - dx)},${t(TOP)} ${t(256)},${t(apex)} ${t(256 + dx)},${t(TOP)}"
      fill="none" stroke="#3b82f6" stroke-width="${28 * k}"
      stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join("");
};

const icon = (pad) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${pad ? 0 : 96}" fill="#0a0a0a"/>
  ${mark(pad ? 0.74 : 1)}
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

await androidIcons();
