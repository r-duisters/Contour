import { readdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sharp from "sharp";

/**
 * Decide which bundled logos should keep their white disc and which should not.
 *
 * `CoinIcon` drew every logo on a white disc, and for most of them that is
 * invisible: of the 274 logos bundled, 239 fill the disc with their own
 * artwork, so its colour never shows. For the remaining 35 it shows a great
 * deal — 83% of the circle for GAS — and white is the wrong answer for two
 * thirds of those. GAS, THETA, HOT and NEO are pale marks that wash out on it,
 * at 1.6:1 and worse.
 *
 * The white disc was not a mistake. It was added because the opposite failure
 * is real: CoinGecko serves Immutable X as pure black on transparent, which on
 * this app's ground rendered as a hole where a logo should be. A single colour
 * cannot serve both, so the colour is chosen per logo, from the artwork.
 *
 * Run standalone to regenerate the manifest from the bundle that is already on
 * disk, which is the usual case — the choice depends only on the images:
 *
 *   node scripts/logo-disc.mjs
 *
 * `bundle-icons.mjs` calls it too, so a refreshed bundle cannot leave a stale
 * manifest behind.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BUNDLE = join(ROOT, "apps/mobile/public/icons/assets");
const MANIFEST = join(ROOT, "packages/core/src/logo-discs.ts");

/** The size everything is judged at; the bundle ships 64px logos. */
const N = 64;

/**
 * How much of the disc must be visible before its colour is worth choosing.
 *
 * Below this the artwork covers the disc and the setting is unobservable, so
 * those logos are left alone rather than churned. 8% is comfortably above the
 * few percent a circular mark leaves at the very rim.
 */
const VISIBLE_MIN = 0.08;

/** The app's ground, which is what shows when the disc is removed. */
const GROUND = [0x0a, 0x0a, 0x0a];

const channel = (c) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Measure one logo.
 *
 * Only pixels inside the inscribed circle count, because `rounded-full` crops
 * the rest — which is the whole reason most of these logos never show a disc
 * at all. IMX and APT look like black tiles on white; they are circular marks
 * whose transparent corners are cropped away before anyone sees them.
 *
 * The colour compared is the ink *near the rim*, not the average over the
 * whole mark. A logo's centre can be any colour it likes; what has to be told
 * apart from the disc is the edge that touches it.
 */
export async function measure(png) {
  const { data } = await sharp(png)
    .resize(N, N, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const r = N / 2;
  let inside = 0, clear = 0;
  let sr = 0, sg = 0, sb = 0, ink = 0;
  let er = 0, eg = 0, eb = 0, edge = 0;

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = x + 0.5 - r;
      const dy = y + 0.5 - r;
      const d2 = dx * dx + dy * dy;
      if (d2 > r * r) continue;
      inside++;
      const i = (y * N + x) * 4;
      if (data[i + 3] < 32) { clear++; continue; }
      ink++; sr += data[i]; sg += data[i + 1]; sb += data[i + 2];
      if (Math.sqrt(d2) > r * 0.62) { edge++; er += data[i]; eg += data[i + 1]; eb += data[i + 2]; }
    }
  }

  if (ink === 0) return { visible: 1, onWhite: 1, onGround: 1, disc: "white" };

  // Fall back to the whole mark when too little of it reaches the rim to
  // average meaningfully.
  const colour = edge > 40
    ? [er / edge, eg / edge, eb / edge]
    : [sr / ink, sg / ink, sb / ink];

  const visible = clear / inside;
  const onWhite = contrast(colour, [255, 255, 255]);
  const onGround = contrast(colour, GROUND);
  return {
    visible,
    onWhite,
    onGround,
    // Below the threshold the disc is covered, so white stays: it is what the
    // app already draws, and changing an invisible setting is churn.
    disc: visible < VISIBLE_MIN || onWhite >= onGround ? "white" : "none",
  };
}

/** Every bundled logo's ticker, in the order the directory lists them. */
export function bundledTickers() {
  return readdirSync(BUNDLE)
    .filter((f) => f.endsWith(".png"))
    .map((f) => f.replace(/\.png$/, ""))
    .sort();
}

/** The tickers whose logo is drawn with no disc behind it. */
export async function discless() {
  const out = [];
  for (const ticker of bundledTickers()) {
    const { disc } = await measure(join(BUNDLE, `${ticker}.png`));
    if (disc === "none") out.push(ticker);
  }
  return out;
}

export async function writeManifest() {
  const tickers = await discless();
  const body = tickers.map((t) => `  ${JSON.stringify(t)},`).join("\n");
  await writeFile(
    MANIFEST,
    `/**
 * Logos that are drawn without a disc behind them.
 *
 * Generated by \`scripts/logo-disc.mjs\` from the bundled artwork — run it
 * rather than editing this list, and \`scripts/logo-discs.test.ts\` fails if the
 * two drift apart.
 *
 * \`CoinIcon\` puts every logo on a white disc, which for most of them is
 * invisible: their artwork fills the circle. Where it is not invisible, white
 * is often the wrong choice — these marks are pale enough to wash out on it,
 * and read better on whatever surface is behind them. The opposite failure is
 * equally real, which is why the choice is per logo and measured rather than
 * picked: a black-on-transparent mark like Immutable X needs the white disc or
 * it is a hole in the row.
 *
 * ${tickers.length} of ${bundledTickers().length} logos.
 */
export const DISCLESS_LOGOS: ReadonlySet<string> = new Set([
${body}
]);
`,
    "utf8",
  );
  return tickers;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const tickers = await writeManifest();
  console.log(`wrote ${MANIFEST.replace(ROOT + "/", "")} — ${tickers.length} logos drawn without a disc`);
  console.log(tickers.join(", "));
}
