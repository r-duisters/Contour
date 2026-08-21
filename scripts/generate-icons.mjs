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
