import { cached } from "@/core/cache";
import { compact, parseRss, pickCoin, plainText, type AssetInfo, type NewsItem, type Sentiment, type Stat } from "@/core/asset-info";
import { baseTicker } from "@/core/asset-names";
import type { Net } from "../ports/net";

/**
 * The crypto/news/sentiment half of `packages/core/src/asset-info.ts`, reached
 * through an injected `Net`.
 *
 * `equityInfo` — the other half — is deliberately **not** ported here. It
 * needs a Yahoo session cookie read back off the *first* response's
 * `Set-Cookie` header before the crumb-bearing second request can be made, and
 * `Net`/`NetResponse` (`ports/net.ts`) is body-only on both sides — no
 * response header reader exists on `json()`, `text()`, or `request()`. Adding
 * one is a real port change (`WebNet`, `FakeNet`, and eventually a device
 * `Net` all have to grow it) that is out of scope for a lookup conversion, so
 * `asset/[symbol]/route.ts` keeps calling the original fetch-based
 * `@/lib/asset-info` for `assetType: "equity"` — unconverted, the same
 * treatment `settings/route.ts`'s `POST` gets.
 *
 * The cache key (`info:${assetType}:${symbol}`) matches core's exactly, so a
 * crypto lookup answered here and one answered by the old code before this
 * task never fight over the same entry — though in practice nothing still
 * calls the old crypto path once the route is converted.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** The subset of CoinGecko's coin-detail payload `cryptoInfo` reads. */
type CoinGeckoCoin = {
  description?: { en?: string };
  categories?: (string | null)[];
  hashing_algorithm?: string | null;
  market_cap_rank?: number | null;
  market_data?: {
    market_cap?: Record<string, number>;
    total_volume?: Record<string, number>;
    ath?: Record<string, number>;
    ath_change_percentage?: Record<string, number>;
    circulating_supply?: number;
    max_supply?: number | null;
  };
};

async function cryptoInfo(net: Net, ticker: string): Promise<Partial<AssetInfo>> {
  const search = await net.request(
    `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(ticker)}`,
  );
  if (!search.ok) return {};
  const coin = pickCoin(
    (await search.json<{ coins?: { id: string; symbol: string; market_cap_rank?: number | null }[] }>())
      ?.coins ?? [],
    ticker,
  );
  if (!coin) return {};

  const res = await net.request(
    `https://api.coingecko.com/api/v3/coins/${coin.id}` +
      `?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`,
  );
  if (!res.ok) return {};
  const d = await res.json<CoinGeckoCoin>();
  const m = d.market_data ?? {};
  const usd = (o: Record<string, number> | undefined) => o?.usd;

  const stats: Stat[] = [];
  const push = (label: string, value: string | null) => {
    if (value) stats.push({ label, value });
  };
  push("Market cap", compact(usd(m.market_cap), "$"));
  push("Rank", d.market_cap_rank ? `#${d.market_cap_rank}` : null);
  push("24h volume", compact(usd(m.total_volume), "$"));
  push("All-time high", compact(usd(m.ath), "$"));
  push(
    "From ATH",
    m.ath_change_percentage?.usd !== undefined ? `${m.ath_change_percentage.usd.toFixed(1)}%` : null,
  );
  push("Circulating", compact(m.circulating_supply));
  push("Max supply", compact(m.max_supply));

  return {
    about: d.description?.en ? plainText(d.description.en) : null,
    tags: [d.categories?.[0], d.categories?.[1], d.hashing_algorithm].filter(Boolean) as string[],
    stats,
    sources: ["CoinGecko"],
  };
}

/** Market-wide crypto sentiment. There is no per-coin equivalent that is free. */
async function fearGreed(net: Net): Promise<Sentiment | null> {
  const res = await net.request("https://api.alternative.me/fng/?limit=1");
  if (!res.ok) return null;
  const d = (await res.json<{ data?: { value: string; value_classification: string }[] }>())?.data?.[0];
  if (!d) return null;
  const value = Number(d.value);
  if (!Number.isFinite(value)) return null;
  return {
    label: "Crypto Fear & Greed",
    value: `${value} · ${d.value_classification}`,
    detail: "Whole-market mood, not this coin",
    score: (value - 50) / 50,
  };
}

async function headlines(net: Net, symbol: string, assetType: "crypto" | "equity"): Promise<NewsItem[]> {
  const feedSymbol = assetType === "crypto" ? `${baseTicker(symbol)}-USD` : symbol;
  const res = await net.request(
    `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(feedSymbol)}&region=US&lang=en-US`,
    { headers: { "User-Agent": UA } },
  );
  if (!res.ok) return [];
  return parseRss(await res.text());
}

/**
 * Everything known about one crypto holding beyond its price. Sources are
 * queried in parallel and any of them may fail: a missing profile must never
 * cost the page its headlines, mirroring core's `Promise.allSettled` exactly.
 */
export async function assetInfo(net: Net, symbol: string): Promise<AssetInfo> {
  const assetType = "crypto" as const;
  return cached(`info:${assetType}:${symbol}`, 1_800_000, async () => {
    const ticker = baseTicker(symbol);
    const [core, news, mood] = await Promise.allSettled([
      cryptoInfo(net, ticker),
      headlines(net, symbol, assetType),
      fearGreed(net),
    ]);
    const base = core.status === "fulfilled" ? core.value : {};
    const items = news.status === "fulfilled" ? news.value : [];
    const sentiment = base.sentiment ?? (mood.status === "fulfilled" ? mood.value : null);
    return {
      symbol,
      about: base.about ?? null,
      tags: base.tags ?? [],
      stats: base.stats ?? [],
      sentiment,
      news: items,
      sources: [
        ...(base.sources ?? []),
        ...(items.length ? ["Yahoo Finance news"] : []),
        ...(sentiment?.label === "Crypto Fear & Greed" ? ["alternative.me"] : []),
      ],
    };
  });
}
