import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { writeManifest } from "./logo-disc.mjs";

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

// The same upstreams `apps/web/src/app/api/icon/route.ts` uses. Change one,
// change the other, or the two builds show different logos for the same coin.
const COIN_CDN = "https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color";
const STOCK_LOGOS = "https://assets.parqet.com/logos/symbol";
const GECKO = "https://api.coingecko.com/api/v3/coins/markets";

const SIZE = 64;

/**
 * Coin logos by market cap, from the source the app already reads.
 *
 * `spothq/cryptocurrency-icons` was the only crypto upstream and its last
 * commit is 2022-08-22. Everything listed since is simply absent: 29 of 100
 * coins had no logo, and they were not obscure ones — SHIB, PEPE, NEAR, ARB,
 * OP, SUI, TON, TIA. A stale CDN does not fail loudly; it 404s each coin
 * individually and the bundler moves on.
 *
 * CoinGecko is already the markets board's ranking source, so this adds no new
 * dependency. Two pages of 250 is one request each and covers everything a
 * portfolio is likely to hold; `spothq` stays as the fallback for older coins
 * outside the top 500, where it is still correct.
 */
async function geckoLogos() {
  const bySymbol = new Map();
  for (const page of [1, 2]) {
    try {
      const res = await fetch(
        `${GECKO}?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=false`,
        { headers: { "User-Agent": "Contour/1.0 (+self-hosted portfolio tracker)" } },
      );
      if (!res.ok) continue;
      for (const row of await res.json()) {
        // First page wins: the higher cap is the better-known coin when two
        // share a ticker.
        if (row.image && !bySymbol.has(row.symbol.toUpperCase())) {
          bySymbol.set(row.symbol.toUpperCase(), row.image);
        }
      }
    } catch {
      // A page that will not load costs its coins their logos, not the run.
    }
  }
  return bySymbol;
}

async function get(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Contour/1.0 (+self-hosted portfolio tracker)" },
  });
  if (!res.ok) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  return bytes.byteLength > 0 ? bytes : null;
}

/**
 * What an upstream calls a thing this app calls something else.
 *
 * Not a workaround — a rename. Toncoin became Gram and Fantom became Sonic, so
 * a lookup by the old ticker finds nothing while the asset is very much still
 * listed. parqet knows Mercedes by its Daimler-era `DAI.DE` and Stellantis by
 * its US line. The file saves under the ticker *this app stores*, because that
 * is what a holding is spelled as and what the icon will be looked up by.
 */
function upstreamName(ticker) {
  return list.aliases?.[ticker] ?? ticker;
}

async function fetchIcon(ticker, kind, gecko) {
  const name = upstreamName(ticker);
  if (kind === "equity") {
    return get(`${STOCK_LOGOS}/${encodeURIComponent(name)}?format=png&size=${SIZE}`);
  }
  // CoinGecko first because it is current, `spothq` second because it still
  // has coins that fall outside the top 500.
  const hosted = gecko.get(name.toUpperCase());
  return (hosted && await get(hosted)) ?? get(`${COIN_CDN}/${name.toLowerCase()}.svg`);
}

const list = JSON.parse(await readFile(join(HERE, "icon-tickers.json"), "utf8"));

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const gecko = await geckoLogos();
console.log(`CoinGecko listed ${gecko.size} coins by market cap`);

const have = [];
const missing = [];

for (const [kind, tickers] of [["crypto", list.crypto], ["equity", list.equity]]) {
  for (const ticker of tickers) {
    try {
      const bytes = await fetchIcon(ticker, kind, gecko);
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

// Which of them need a white disc behind them and which do not, decided from
// the artwork that was just written. Here rather than left to a separate step:
// a refreshed bundle with a stale manifest would draw the wrong ground behind
// whichever logos changed, and nothing would say so.
const discless = await writeManifest();

console.log(`bundled ${have.length} logos, ${missing.length} unavailable`);
console.log(`  ${discless.length} of them drawn with no disc behind them`);
if (missing.length) console.log("  no logo upstream:", missing.join(" "));
