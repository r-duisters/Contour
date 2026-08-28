import { cached } from "@/core/cache";
import { assetOf } from "@/core/symbols";
import type { Net } from "../ports/net";
import { fetchUsdtSymbols } from "./binance";

/**
 * Finding an asset by name or ticker, across the two worlds this app prices.
 *
 * Two sources, because the app has two pricing paths and a result is only
 * worth showing if one of them can answer for it. Yahoo's search knows every
 * listed security by name; Binance's symbol list is the authority on which
 * coins this app can price at all.
 *
 * **Crypto does not come from Yahoo**, even though it is in the results.
 * Yahoo spells bitcoin `BTC-USD` and this app prices `BTCUSDT`; a hit whose
 * symbol nothing here can look up is worse than no hit, because it produces a
 * page with a name and no numbers. The Binance list is already fetched and
 * cached for an hour by the importer, so filtering it costs nothing.
 */
export type AssetHit = {
  /** As this app spells it: `BTC`, `ASML.AS`. */
  symbol: string;
  name: string;
  assetType: "crypto" | "equity";
  /** Where it trades, for telling four listings of one company apart. */
  exchange: string | null;
};

/** Yahoo types this app can price. A fund or a future would draw an empty chart. */
const PRICEABLE = new Set(["EQUITY", "ETF"]);

type YahooQuote = {
  symbol?: string;
  shortname?: string;
  longname?: string;
  quoteType?: string;
  exchDisp?: string;
};

export function searchAssets(net: Net, query: string, limit = 12): Promise<AssetHit[]> {
  const q = query.trim();
  if (q.length < 2) return Promise.resolve([]);

  return cached(`search:${q.toLowerCase()}:${limit}`, 600_000, async () => {
    const [coins, listed] = await Promise.all([
      searchCoins(net, q),
      searchListed(net, q),
    ]);
    // Coins first: this app began as a crypto tool and its price path for them
    // is the more complete one. Both lists are already ranked by their source.
    return [...coins, ...listed].slice(0, limit);
  });
}

/**
 * Coins, from the pairs Binance actually trades.
 *
 * Ranked by how the match sits in the ticker: a query that *is* the ticker
 * comes first, then one it starts with, then a substring. Without that, "ETH"
 * finds a dozen coins with ETH somewhere in them before Ethereum.
 */
async function searchCoins(net: Net, query: string): Promise<AssetHit[]> {
  let pairs: string[];
  try {
    pairs = await fetchUsdtSymbols(net);
  } catch {
    return [];
  }
  const q = query.toUpperCase();
  const scored: { hit: AssetHit; rank: number }[] = [];
  for (const pair of pairs) {
    const base = assetOf(pair);
    const rank = base === q ? 0 : base.startsWith(q) ? 1 : base.includes(q) ? 2 : -1;
    if (rank < 0) continue;
    scored.push({ rank, hit: { symbol: base, name: base, assetType: "crypto", exchange: "Binance" } });
  }
  return scored
    .sort((a, b) => a.rank - b.rank || a.hit.symbol.length - b.hit.symbol.length)
    .slice(0, 6)
    .map((s) => s.hit);
}

/** Shares and ETFs, from Yahoo's search, filtered to what the app can price. */
async function searchListed(net: Net, query: string): Promise<AssetHit[]> {
  try {
    const raw = await net.json<{ quotes?: YahooQuote[] }>(
      "https://query1.finance.yahoo.com/v1/finance/search" +
        `?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`,
    );
    return (raw.quotes ?? [])
      .filter((q) => q.symbol && q.quoteType && PRICEABLE.has(q.quoteType))
      .map((q): AssetHit => ({
        symbol: q.symbol!,
        name: q.shortname ?? q.longname ?? q.symbol!,
        assetType: "equity",
        exchange: q.exchDisp ?? null,
      }));
  } catch {
    // Yahoo refusing costs the listed half of the results, not the search.
    return [];
  }
}
