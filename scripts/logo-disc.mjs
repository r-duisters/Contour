import { readFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
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
 * **The artwork is no longer in the repository, so this downloads it.** The
 * device used to ship the logos and this read them off disk; we have no right
 * to redistribute most of them, so the app fetches at runtime and the only
 * thing committed is the measurement. The images land in a gitignored scratch
 * directory and are measured there.
 *
 *   node scripts/logo-disc.mjs          # reuses anything already downloaded
 *   node scripts/logo-disc.mjs --fresh  # re-downloads first
 *
 * That makes this the one step that needs a network, which is why
 * `logo-discs.test.ts` no longer re-measures: a unit test that depends on
 * three CDNs is a unit test that fails on a train. It checks the invariants
 * that hold without the artwork, and this script is what refreshes the list
 * when the logos change.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
/*
 * Gitignored: this is a working copy for measuring, not something to ship.
 * Committing it would put the artwork back in the repository, which is the
 * thing the runtime fetch was introduced to stop.
 */
const BUNDLE = join(ROOT, ".logo-measure");
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

/** Every ticker in the working copy, in the order the directory lists them. */
export function bundledTickers() {
  if (!existsSync(BUNDLE)) return [];
  return readdirSync(BUNDLE)
    .filter((f) => f.endsWith(".png"))
    .map((f) => f.replace(/\.png$/, ""))
    .sort();
}

/**
 * Fetch the artwork to the working copy, resolving each logo exactly as the
 * device does — `upstreams.ts` is the authority, and this reads its indexes so
 * the two cannot disagree about which CDN serves a ticker.
 *
 * Normalised to 64px PNG on the way in, because the measurement compares
 * pixels and an SVG and a 256px PNG are not comparable as they arrive.
 */
export async function download({ fresh = false } = {}) {
  const list = JSON.parse(readFileSync(join(HERE, "icon-tickers.json"), "utf8"));
  const dir = join(ROOT, "apps/mobile/src/lib/icons");
  const spothq = new Set(JSON.parse(readFileSync(join(dir, "spothq.json"), "utf8")));
  const gecko = JSON.parse(readFileSync(join(dir, "gecko.json"), "utf8"));
  const aliases = JSON.parse(readFileSync(join(dir, "aliases.json"), "utf8"));
  mkdirSync(BUNDLE, { recursive: true });

  const urlFor = (ticker, kind) => {
    const name = (aliases[ticker] ?? ticker).toUpperCase();
    if (kind === "equity") {
      return `https://assets.parqet.com/logos/symbol/${encodeURIComponent(name)}?format=png&size=64`;
    }
    if (spothq.has(name)) {
      return `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color/${name.toLowerCase()}.svg`;
    }
    return gecko[name] ?? null;
  };

  let got = 0;
  for (const [kind, tickers] of [["crypto", list.crypto], ["equity", list.equity]]) {
    for (const ticker of tickers) {
      const out = join(BUNDLE, `${ticker.toUpperCase()}.png`);
      if (!fresh && existsSync(out)) { got++; continue; }
      const url = urlFor(ticker.toUpperCase(), kind);
      if (!url) continue;
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "Contour/1.0 (+self-hosted portfolio tracker)" },
        });
        if (!res.ok) continue;
        const bytes = Buffer.from(await res.arrayBuffer());
        if (!bytes.byteLength) continue;
        await sharp(bytes, { density: 300 })
          .resize(N, N, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .png()
          .toFile(out);
        got++;
      } catch {
        // A logo that will not download is one this cannot measure. The app
        // draws initials for it either way.
      }
    }
  }
  return got;
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
 * Generated by \`scripts/logo-disc.mjs\`, which downloads the artwork to measure
 * it — the images are not in this repository. Run that rather than editing
 * this list.
 *
 * \`CoinIcon\` puts every logo on a white disc, which for most of them is
 * invisible: their artwork fills the circle. Where it is not invisible, white
 * is often the wrong choice — these marks are pale enough to wash out on it,
 * and read better on whatever surface is behind them. The opposite failure is
 * equally real, which is why the choice is per logo and measured rather than
 * picked: a black-on-transparent mark like Immutable X needs the white disc or
 * it is a hole in the row.
 *
 * ${tickers.length} of ${bundledTickers().length} logos measured.
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
  const got = await download({ fresh: process.argv.includes("--fresh") });
  console.log(`measuring ${got} logos in ${BUNDLE.replace(ROOT + "/", "")}`);
  const tickers = await writeManifest();
  console.log(`wrote ${MANIFEST.replace(ROOT + "/", "")} — ${tickers.length} logos drawn without a disc`);
  console.log(tickers.join(", "));
}
