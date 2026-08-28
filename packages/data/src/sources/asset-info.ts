import { cached } from "@/core/cache";
import { compact, parseRss, pickCoin, plainText, type AssetInfo, type NewsItem, type Sentiment, type Stat } from "@/core/asset-info";
import { baseTicker } from "@/core/asset-names";
import type { Net } from "../ports/net";

/**
 * The crypto/news/sentiment half of what used to be
 * `packages/core/src/asset-info.ts`, reached through an injected `Net`. That
 * module is now pure: only the types and the parsing helpers stayed, and both
 * halves import them from there.
 *
 * The equity half is **not** here. It needs a Yahoo session cookie read back
 * off the *first* response's `Set-Cookie` header before the crumb-bearing
 * second request can be made, and `Net`/`NetResponse` (`ports/net.ts`) is
 * body-only on both sides — no response header reader exists on `json()`,
 * `text()`, or `request()`, and a browser `fetch` could not read `Set-Cookie`
 * even if one did. Growing the port a cookie jar is a task of its own, so that
 * half lives server-only in `apps/web/src/lib/equity-info.ts`, beside its one
 * caller.
 *
 * The cache key (`info:crypto:${symbol}`) is the one core used, so nothing was
 * lost when core's copy went.
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
 * What a share is, from the one Yahoo endpoint that needs no crumb.
 *
 * The `meta` block of the chart response carries the company's full name, its
 * exchange, the currency it trades in, the day's range, the volume and the
 * 52-week range — real facts, and enough that an equity page is no longer
 * visibly poorer than a coin's. It is not everything the desktop shows: the
 * profile text and the ratios come from `quoteSummary`, which does need the
 * cookie-and-crumb handshake and a response header the portable `Net` cannot
 * read (spec §4.2). That gap stays, and is now the only one.
 *
 * **No sentiment.** The Fear & Greed index is a crypto measure, and it was
 * appearing on stock pages — the device client called this module's crypto
 * path for every asset, so Ubisoft was shown the mood of the coin market. That
 * is not a thinner answer, it is a wrong one.
 */
async function equityInfo(net: Net, symbol: string): Promise<Partial<AssetInfo>> {
  const raw = await net.json<{ chart?: { result?: { meta?: EquityMeta }[] | null } }>(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
      "?range=1d&interval=1d",
    { headers: { "User-Agent": UA, Accept: "application/json" } },
  );
  const m = raw.chart?.result?.[0]?.meta;
  if (!m) return {};

  const ccy = m.currency ?? "";
  const price = (n: number | undefined) =>
    typeof n === "number" ? `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${ccy}`.trim() : null;
  const stats: Stat[] = [];
  const add = (label: string, value: string | null) => { if (value) stats.push({ label, value }); };

  add("Exchange", m.fullExchangeName ?? m.exchangeName ?? null);
  add(
    "52-week range",
    typeof m.fiftyTwoWeekLow === "number" && typeof m.fiftyTwoWeekHigh === "number"
      ? `${price(m.fiftyTwoWeekLow)} – ${price(m.fiftyTwoWeekHigh)}`
      : null,
  );
  add(
    "Day range",
    typeof m.regularMarketDayLow === "number" && typeof m.regularMarketDayHigh === "number"
      ? `${price(m.regularMarketDayLow)} – ${price(m.regularMarketDayHigh)}`
      : null,
  );
  add(
    "Volume",
    typeof m.regularMarketVolume === "number"
      ? m.regularMarketVolume.toLocaleString("en-US")
      : null,
  );

  const name = m.longName ?? m.shortName ?? null;
  return {
    about: name ? `${name}${m.fullExchangeName ? `, listed on ${m.fullExchangeName}` : ""}.` : null,
    tags: m.instrumentType ? [m.instrumentType.toLowerCase()] : [],
    stats,
    sentiment: null,
    sources: ["Yahoo Finance"],
  };
}

type EquityMeta = {
  longName?: string; shortName?: string; instrumentType?: string;
  fullExchangeName?: string; exchangeName?: string; currency?: string;
  regularMarketDayHigh?: number; regularMarketDayLow?: number; regularMarketVolume?: number;
  fiftyTwoWeekHigh?: number; fiftyTwoWeekLow?: number;
};

/**
 * Everything known about one holding beyond its price. Sources are queried in
 * parallel and any of them may fail: a missing profile must never cost the
 * page its headlines, mirroring core's `Promise.allSettled` exactly.
 *
 * `assetType` decides which world this is read in, and defaults to crypto so
 * the server route that only ever calls it for coins is unchanged. Getting it
 * wrong is not a matter of detail: the two paths query different feeds, and
 * the crypto one carries a market-wide mood that means nothing for a share.
 */
export async function assetInfo(
  net: Net,
  symbol: string,
  assetType: "crypto" | "equity" = "crypto",
): Promise<AssetInfo> {
  return cached(`info:${assetType}:${symbol}`, 1_800_000, async () => {
    const ticker = baseTicker(symbol);
    const [core, news, mood] = await Promise.allSettled([
      assetType === "crypto" ? cryptoInfo(net, ticker) : equityInfo(net, symbol),
      headlines(net, symbol, assetType),
      // Crypto only, and the whole point of the branch: a share has no
      // business being described by the coin market's mood.
      assetType === "crypto" ? fearGreed(net) : Promise.resolve(null),
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
