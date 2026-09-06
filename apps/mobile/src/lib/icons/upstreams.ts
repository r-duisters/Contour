import SPOTHQ from "./spothq.json";
import GECKO from "./gecko.json";
import ALIASES from "./aliases.json";

/**
 * Where a logo is fetched from, decided without asking anybody.
 *
 * The device used to ship 274 logos inside the APK. It stopped because we do
 * not have the right to redistribute most of them: CoinGecko's terms name
 * logos and prohibit copying them "without prior written consent", and
 * `assets.parqet.com` states no terms at all while Parqet — an aggregator —
 * owns none of the marks it serves. `spothq/cryptocurrency-icons` is CC0 and
 * was always fine. Fetching at runtime is not redistribution: the phone asks
 * the CDN directly, the way any browser does, and this app ships no copies.
 *
 * **What that costs, stated plainly.** A request for a logo names the asset in
 * its path, so the CDN learns that whoever is asking holds that ticker. The
 * bundle existed to prevent exactly this. Fetching the whole set rather than
 * the held subset would have avoided it — the same trick
 * `privateCoinPrices` uses against Binance — and was considered and not taken:
 * the decision (2026-08-31) is that only what a portfolio actually contains is
 * fetched. `docs/asset-logos.md` and the security review's egress list say so
 * rather than leaving it to be discovered.
 *
 * **spothq first, CoinGecko only for what it lacks.** Not a preference for its
 * artwork — it is a stylised set, three years stale, and CoinGecko carries the
 * marks the projects actually use. It is first because it is the one source
 * whose licence permits anything, so the fewer requests that go anywhere else,
 * the smaller the part of this that rests on nobody having objected yet.
 *
 * Which tickers spothq has is shipped as a list of names rather than
 * discovered by a failed request per coin: a 404 costs a round trip to learn
 * something known at build time. Names are not artwork, and the list is CC0
 * regardless.
 */

/** What an upstream calls a thing this app calls something else. */
const alias = (ticker: string): string =>
  (ALIASES as Record<string, string>)[ticker] ?? ticker;

const spothq = new Set(SPOTHQ as string[]);

export type Upstream = { url: string; source: "spothq" | "coingecko" | "parqet" };

/**
 * The one URL to try for a ticker, or null when no upstream has it.
 *
 * One and not a chain: a fallback per asset doubles the requests and the
 * parties told about a holding, to recover a logo for a coin that would
 * otherwise show initials — which the app already draws deliberately. Null
 * here means initials, and initials are the honest answer.
 */
export function upstreamFor(
  ticker: string,
  assetType: "crypto" | "equity" | "cash" | undefined,
): Upstream | null {
  if (assetType === "cash") return null;
  const name = alias(ticker.toUpperCase());

  if (assetType === "equity") {
    // Parqet sizes on request, so nothing has to be resized on the device.
    return {
      source: "parqet",
      url: `https://assets.parqet.com/logos/symbol/${encodeURIComponent(name)}?format=png&size=64`,
    };
  }

  if (spothq.has(name)) {
    return {
      source: "spothq",
      // SVG, so one file serves every size the app draws.
      url: `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color/${name.toLowerCase()}.svg`,
    };
  }

  const hosted = (GECKO as Record<string, string>)[name];
  return hosted ? { source: "coingecko", url: hosted } : null;
}
