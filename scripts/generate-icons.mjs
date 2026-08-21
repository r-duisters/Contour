import { mkdir } from "node:fs/promises";
import sharp from "sharp";

/**
 * The mark is a nabla — the delta symbol inverted — as a single outline
 * triangle in the app's accent blue. Blue rather than red so a downward
 * triangle does not read as a loss, and outline rather than filled so it
 * stays legible at 48px.
 */
const icon = (pad) => {
  const r = pad ? 0 : 96;
  const s = pad ? 0.74 : 1; // maskable art stays inside the safe area
  const t = (v) => 256 + (v - 256) * s;
  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${r}" fill="#0a0a0a"/>
  <polygon points="${t(112)},${t(146)} ${t(400)},${t(146)} ${t(256)},${t(392)}"
           fill="none" stroke="#3b82f6" stroke-width="${34 * s}"
           stroke-linejoin="round"/>
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

/** Transparent mark for the adaptive foreground layer. */
const foreground = () => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <polygon points="176,196 336,196 256,332"
           fill="none" stroke="#3b82f6" stroke-width="19"
           stroke-linejoin="round"/>
</svg>`;

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
