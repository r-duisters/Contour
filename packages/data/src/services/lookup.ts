import type { AssetInfo } from "@/core/asset-info";
import type { Net } from "../ports/net";
import { fetchUsdtSymbols } from "../sources/binance";
import { assetInfo as fetchCryptoAssetInfo } from "../sources/asset-info";
import { searchAssets as findAssets, type AssetHit } from "../sources/search";

/**
 * The full USDT symbol list, and one asset's background/sentiment/headlines
 * panel. No query argument on `symbols` — the old route took none either; the
 * importer and the symbol picker both want the whole list and filter it
 * client-side.
 */

/**
 * `sources/binance.ts`'s `fetchUsdtSymbols` already memoises the ~2MB
 * `exchangeInfo` fetch for an hour, under the key `"usdt-symbols"`. That TTL
 * cache buys freshness, not resilience: once the hour is up, a failed refetch
 * throws straight through it with no memory of the last good answer.
 *
 * `lastGood` is that memory, and it is genuinely new logic rather than a
 * second copy of the TTL cache — the old `symbols/route.ts` module-level
 * `cache` variable did exactly this (serve the previous list forever on
 * failure, no expiry of its own), so it moves here rather than staying in the
 * route. A module-level variable in a service is per-process on a device too,
 * the same guarantee it has today on the server.
 */
let lastGood: string[] | null = null;

/**
 * Test-only. `lastGood` has no expiry of its own — that is the point of it —
 * so once one test has ever succeeded, nothing in the same process can
 * observe the "never succeeded" branch of `symbols()` again. Without a way to
 * clear it, a suite could delete `throw err` below in favour of `return []`
 * and every test would still pass, silently turning a Binance outage on a
 * cold process into an empty symbol picker instead of the 502 the route
 * promises. Not exported from `index.ts` or reachable from a route — only
 * `lookup.test.ts` imports it.
 */
export function __resetSymbolsCacheForTests(): void {
  lastGood = null;
}

export async function symbols(net: Net): Promise<string[]> {
  try {
    const list = await fetchUsdtSymbols(net);
    lastGood = list;
    return list;
  } catch (err) {
    if (lastGood) return lastGood;
    throw err;
  }
}

/**
 * What is known about an asset beyond its price, read in the right world.
 *
 * `assetType` defaults to crypto because `asset/[symbol]/route.ts` calls this
 * only for coins — the web app has the server-only
 * `apps/web/src/lib/equity-info.ts` for shares, which reaches `quoteSummary`
 * for the profile text and the ratios.
 *
 * A device cannot: that endpoint wants a session cookie read off a response
 * header `Net` has no way to expose (spec §4.2). What it *can* read is the
 * chart's `meta` block — name, exchange, currency, day and 52-week ranges,
 * volume — which needs no crumb. So an equity here is a smaller answer than
 * the desktop's, and a correct one, which it was not while every asset was
 * read as a coin.
 */
export function assetInfo(
  net: Net, symbol: string, assetType: "crypto" | "equity" = "crypto",
): Promise<AssetInfo> {
  return fetchCryptoAssetInfo(net, symbol, assetType);
}

/**
 * Find an asset by name or ticker, across both worlds this app prices.
 *
 * A thin pass-through, like `symbols` above: the merging and the ranking are
 * the source's business, and the service exists so a route and a device client
 * call the same thing.
 */
export function searchAssets(net: Net, query: string): Promise<AssetHit[]> {
  return findAssets(net, query);
}
