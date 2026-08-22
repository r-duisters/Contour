import { mkdir } from "node:fs/promises";
import sharp from "sharp";

/**
 * A rising price line inside four crop marks. The corners frame the line and,
 * at an equal offset, form a level set — the name's meaning, kept. They are a
 * partial container on purpose: the app frames the mark in a circle twice
 * (the unlock disc, and Android's adaptive mask), and a closed round shape of
 * its own would put a ring inside a ring.
 *
 * Blue frame, white line: the container carries the brand and the data reads
 * as the subject, and white holds the strongest contrast at small sizes.
 */
const INSET = 118, ARM = 60, FAR = 512 - INSET;
const CORNERS = [
  `M${INSET},${INSET + ARM} V${INSET} H${INSET + ARM}`,
  `M${FAR - ARM},${INSET} H${FAR} V${INSET + ARM}`,
  `M${FAR},${FAR - ARM} V${FAR} H${FAR - ARM}`,
  `M${INSET + ARM},${FAR} H${INSET} V${FAR - ARM}`,
];
const PRICE = [[172, 302], [228, 244], [280, 276], [348, 190]];

/** The mark, optionally scaled about the centre to sit inside a safe area. */
const mark = (k = 1) => {
  const t = (v) => 256 + (v - 256) * k;
  // Scaling a path string means scaling its numbers, so the corners are
  // rebuilt from the same constants rather than string-substituted.
  const i = t(INSET), f = t(FAR), arm = ARM * k;
  const corners = [
    `M${i},${i + arm} V${i} H${i + arm}`,
    `M${f - arm},${i} H${f} V${i + arm}`,
    `M${f},${f - arm} V${f} H${f - arm}`,
    `M${i + arm},${f} H${i} V${f - arm}`,
  ];
  return `
  <g fill="none" stroke="#3b82f6" stroke-width="${24 * k}" stroke-linecap="round" stroke-linejoin="round">
    ${corners.map((d) => `<path d="${d}"/>`).join("")}
  </g>
  <path d="M${PRICE.map(([x, y]) => `${t(x)},${t(y)}`).join(" L")}" fill="none" stroke="#fafafa"
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
