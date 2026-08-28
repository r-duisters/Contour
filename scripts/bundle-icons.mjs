import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sharp from "sharp";

/**
 * Build the logo bundle the device app ships.
 *
 * `apps/web` proxies logos through `/api/icon`, which fetches each one once and
 * caches it — the phone never talks to an icon CDN, so nothing outside learns
 * what is held. That property is written into `CoinIcon`'s history and it is
 * the reason the device build cannot simply call the CDN itself: it would
 * quietly break a promise, in an app whose pitch is that the portfolio does not
 * leave the phone.
 *
 * So the logos ship with the app. This script is run by hand when the list
 * changes, not during a build: a build that fetched would need a network, would
 * not be reproducible, and would fail exactly where the app is supposed to work.
 *
 * Run: node scripts/bundle-icons.mjs
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = join(ROOT, "apps/mobile/public/icons/assets");

// The same two upstreams `apps/web/src/app/api/icon/route.ts` uses. Change one,
// change the other, or the two builds show different logos for the same coin.
const COIN_CDN = "https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color";
const STOCK_LOGOS = "https://assets.parqet.com/logos/symbol";

const SIZE = 64;

async function fetchIcon(ticker, kind) {
  const url = kind === "crypto"
    ? `${COIN_CDN}/${ticker.toLowerCase()}.svg`
    : `${STOCK_LOGOS}/${encodeURIComponent(ticker)}?format=png&size=${SIZE}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  return bytes.byteLength > 0 ? bytes : null;
}

const list = JSON.parse(await readFile(join(HERE, "icon-tickers.json"), "utf8"));

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const have = [];
const missing = [];

for (const [kind, tickers] of [["crypto", list.crypto], ["equity", list.equity]]) {
  for (const ticker of tickers) {
    try {
      const bytes = await fetchIcon(ticker, kind);
      if (!bytes) { missing.push(ticker); continue; }
      // One size, one format. The largest a row ever draws is 28px at 2x;
      // 64 covers it and keeps the bundle small.
      await sharp(bytes, { density: 300 })
        .resize(SIZE, SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toFile(join(OUT, `${ticker.toUpperCase()}.png`));
      have.push(ticker.toUpperCase());
    } catch {
      missing.push(ticker);
    }
  }
}

// What shipped, so `bundledIconSource` can answer without a request per miss.
await writeFile(join(OUT, "..", "index.json"), JSON.stringify(have.sort(), null, 0) + "\n");

console.log(`bundled ${have.length} logos, ${missing.length} unavailable`);
if (missing.length) console.log("  no logo upstream:", missing.join(" "));
