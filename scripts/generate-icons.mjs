import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const icon = (pad) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${pad ? 0 : 96}" fill="#0a0a0a"/>
  <polyline points="${pad ? "112,320 208,224 272,272 400,160" : "80,336 192,224 268,284 432,128"}"
            fill="none" stroke="#22c55e" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="${pad ? 400 : 432}" cy="${pad ? 160 : 128}" r="28" fill="#22c55e"/>
</svg>`;

await mkdir("public/icons", { recursive: true });
const targets = [
  ["public/icons/icon-192.png", 192, false],
  ["public/icons/icon-512.png", 512, false],
  ["public/icons/maskable-512.png", 512, true], // full-bleed background for maskable
  ["public/icons/apple-touch-icon.png", 180, true],
];
for (const [file, size, pad] of targets) {
  await sharp(Buffer.from(icon(pad))).resize(size, size).png().toFile(file);
  console.log("wrote", file);
}
