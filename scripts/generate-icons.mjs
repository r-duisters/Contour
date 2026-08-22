import { mkdir } from "node:fs/promises";
import sharp from "sharp";

/**
 * The mark is a nabla — the delta symbol inverted — solid, in the accent blue,
 * with a price line cut clean through it. Blue rather than red so a downward
 * triangle does not read as a loss; five vertices and a reversal in the line so
 * it does not read as a checkmark; inset from the edges so the triangle stays
 * one shape. The cut is a true hole, taking the colour behind it.
 */
const TRI = "112,146 400,146 256,392";
const LINE = "168,254 214,286 258,232 304,264 356,208";

/** The mark itself, optionally scaled about the centre for a safe area. */
const mark = (s = 1, id = "m") => {
  const t = (v) => 256 + (v - 256) * s;
  const scale = (pts) => pts.split(" ")
    .map((p) => p.split(",").map(Number))
    .map(([x, y]) => `${t(x)},${t(y)}`).join(" ");
  return `
  <defs>
    <mask id="${id}c">
      <rect width="512" height="512" fill="#fff"/>
      <polyline points="${scale(LINE)}" fill="none" stroke="#000"
                stroke-width="${30 * s}" stroke-linecap="round" stroke-linejoin="round"/>
    </mask>
  </defs>
  <polygon points="${scale(TRI)}" fill="#3b82f6" stroke="#3b82f6"
           stroke-width="${30 * s}" stroke-linejoin="round" mask="url(#${id}c)"/>`;
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
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${mark(0.52, "f")}</svg>`;

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
