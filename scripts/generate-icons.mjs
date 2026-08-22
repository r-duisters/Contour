import { mkdir } from "node:fs/promises";
import sharp from "sharp";

/**
 * A rising price line inside a quiet ring. The ring is a closed level curve —
 * the name's meaning — and the blue sits on the line so the brand colour lands
 * on the subject rather than the container.
 *
 * The ring stays dim on purpose: the app frames the mark in a circle twice
 * (the unlock disc, and Android's adaptive mask), and a ring at that frame's
 * weight competes with it. Weight and contrast decide this, not whether the
 * shape is closed.
 */
const RING = { r: 160, width: 12, colour: "#fafafa", opacity: 0.35 };
const PRICE = [[172, 302], [228, 244], [280, 276], [348, 190]];

/** The mark, optionally scaled about the centre to sit inside a safe area. */
const mark = (k = 1) => {
  const t = (v) => 256 + (v - 256) * k;
  return `
  <circle cx="256" cy="256" r="${RING.r * k}" fill="none" stroke="${RING.colour}"
          stroke-width="${RING.width * k}" opacity="${RING.opacity}"/>
  <path d="M${PRICE.map(([x, y]) => `${t(x)},${t(y)}`).join(" L")}" fill="none" stroke="#3b82f6"
        stroke-width="${30 * k}" stroke-linecap="round" stroke-linejoin="round"/>`;
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
