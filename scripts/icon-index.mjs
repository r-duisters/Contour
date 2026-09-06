/**
 * The data the device needs to find a logo, without shipping any logo.
 *
 * This replaced `bundle-icons.mjs`, which downloaded 274 images and committed
 * them into the APK. That was a redistribution we do not have permission for —
 * see `docs/asset-logos.md` — so the device fetches at runtime now and this
 * writes only the three things it cannot work out for itself:
 *
 *   spothq.json   which tickers the CC0 icon set has, so a miss costs no
 *                 request. Names, not artwork.
 *   gecko.json    ticker -> image URL, for the coins spothq lacks. CoinGecko's
 *                 paths are ids (`/coins/images/1/large/bitcoin.png`) and
 *                 cannot be derived from a ticker. A URL is not a copy.
 *   aliases.json  what an upstream calls a thing this app calls something
 *                 else, carried over from the bundler.
 *
 * Run it when `scripts/icon-tickers.json` changes, or every so often to pick
 * up new listings. Nothing breaks if it is stale: an unknown coin gets
 * initials, which the app already draws deliberately.
 *
 *   node scripts/icon-index.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = join(ROOT, "apps/mobile/src/lib/icons");

const UA = { "User-Agent": "Contour/1.0 (+self-hosted portfolio tracker)" };
const GECKO = "https://api.coingecko.com/api/v3/coins/markets";
const SPOTHQ_TREE =
  "https://api.github.com/repos/spothq/cryptocurrency-icons/contents/svg/color";

/** Every ticker the CC0 set draws. Names only — this fetches no artwork. */
async function spothqTickers() {
  const res = await fetch(SPOTHQ_TREE, { headers: UA });
  if (!res.ok) throw new Error(`spothq listing: ${res.status}`);
  return [...new Set(
    (await res.json())
      .filter((e) => e.name.endsWith(".svg"))
      .map((e) => e.name.slice(0, -4).toUpperCase()),
  )].sort();
}

/**
 * CoinGecko's image URL per ticker, over the top 500 by market cap.
 *
 * First page wins where two coins share a ticker: the higher cap is the one a
 * portfolio is likelier to hold, and the same rule the bundler used.
 */
async function geckoImages() {
  const bySymbol = new Map();
  for (const page of [1, 2]) {
    const res = await fetch(
      `${GECKO}?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=false`,
      { headers: UA },
    );
    if (!res.ok) continue;
    for (const row of await res.json()) {
      const s = row.symbol.toUpperCase();
      if (row.image && !bySymbol.has(s)) bySymbol.set(s, row.image);
    }
  }
  return bySymbol;
}

const list = JSON.parse(await readFile(join(HERE, "icon-tickers.json"), "utf8"));
const aliases = list.aliases ?? {};
const named = (t) => aliases[t] ?? t;

const spothq = await spothqTickers();
const have = new Set(spothq);
const gecko = await geckoImages();

/*
 * Only the coins spothq lacks. Every entry here is a request that will go to
 * CoinGecko rather than to jsDelivr, so the file is deliberately as short as
 * the ticker list allows rather than a mirror of the whole index.
 */
const fill = {};
const missing = [];
for (const ticker of list.crypto) {
  const name = named(ticker.toUpperCase());
  if (have.has(name)) continue;
  const url = gecko.get(name);
  if (url) fill[name] = url; else missing.push(ticker);
}

const json = (v) => JSON.stringify(v, null, 0) + "\n";
await writeFile(join(OUT, "spothq.json"), json(spothq));
await writeFile(join(OUT, "gecko.json"), json(fill));
await writeFile(join(OUT, "aliases.json"), json(aliases));

console.log(`spothq lists ${spothq.length} tickers (CC0)`);
console.log(`CoinGecko fills ${Object.keys(fill).length} of our ${list.crypto.length} coins`);
console.log(`${list.equity.length} equities resolve to parqet by ticker, no index needed`);
if (missing.length) console.log(`no upstream at all: ${missing.join(" ")}`);
