import { cached } from "./cache";
import { baseTicker } from "./asset-names";

/**
 * Background, sentiment and headlines for one holding.
 *
 * Every source here is free and keyless, and all of it is fetched server-side:
 * the browser asking Yahoo or CoinGecko directly would tell them which assets
 * are held, which is the thing this app exists to avoid.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const YAHOO_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://finance.yahoo.com/",
  Origin: "https://finance.yahoo.com",
  "sec-fetch-site": "same-site",
  "sec-fetch-mode": "cors",
};

export type Stat = { label: string; value: string };
export type NewsItem = { title: string; link: string; published: number | null; source: string | null };
export type Sentiment = {
  label: string;
  value: string;
  detail: string | null;
  /** -1 fearful/bearish … +1 greedy/bullish, for colouring. Null when unscored. */
  score: number | null;
};
export type AssetInfo = {
  symbol: string;
  about: string | null;
  tags: string[];
  stats: Stat[];
  sentiment: Sentiment | null;
  news: NewsItem[];
  sources: string[];
};

/* ------------------------------------------------------------------ parsing */

/** Items out of an RSS feed. Regex rather than a parser: four fields, one shape. */
export function parseRss(xml: string, limit = 8): NewsItem[] {
  const items: NewsItem[] = [];
  for (const block of xml.split(/<item[\s>]/).slice(1)) {
    const pick = (tag: string) => {
      const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      if (!m) return null;
      return decodeEntities(m[1]!.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim());
    };
    const title = pick("title");
    const link = pick("link");
    if (!title || !link) continue;
    const date = pick("pubDate");
    const parsed = date ? Date.parse(date) : NaN;
    items.push({
      title,
      link,
      published: Number.isFinite(parsed) ? parsed : null,
      source: pick("source"),
    });
    if (items.length >= limit) break;
  }
  return items;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

/** Strip the HTML CoinGecko puts in its descriptions, and cut to a readable length. */
export function plainText(html: string, maxChars = 600): string {
  const text = decodeEntities(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  // A clean sentence end beats an ellipsis, so long as it leaves a real snippet.
  return stop > maxChars * 0.3 ? cut.slice(0, stop + 1) : `${cut.trimEnd()}…`;
}

/**
 * The coin a ticker most likely means.
 *
 * Tickers collide — SUB is both Substratum and SubVortex — so an exact symbol
 * match wins, and among those the highest market cap. A guess is still a
 * guess, which is why the UI names its source.
 */
export function pickCoin<T extends { id: string; symbol: string; market_cap_rank?: number | null }>(
  coins: T[], ticker: string,
): T | null {
  const wanted = ticker.toUpperCase();
  const exact = coins.filter((c) => c.symbol?.toUpperCase() === wanted);
  const pool = exact.length ? exact : [];
  if (!pool.length) return null;
  return pool.sort(
    (a, b) => (a.market_cap_rank ?? Infinity) - (b.market_cap_rank ?? Infinity),
  )[0]!;
}

/**
 * Large figures the way a market quotes them. Yahoo pre-formats its own as
 * "772.57B"; CoinGecko returns raw numbers, and 1545294328322 is not a figure
 * anyone reads.
 */
export function compact(n: number | undefined | null, prefix = ""): string | null {
  if (n === undefined || n === null || !Number.isFinite(n)) return null;
  const abs = Math.abs(n);
  const [div, suffix] =
    abs >= 1e12 ? [1e12, "T"] :
    abs >= 1e9 ? [1e9, "B"] :
    abs >= 1e6 ? [1e6, "M"] :
    abs >= 1e3 ? [1e3, "K"] : [1, ""];
  const scaled = n / div;
  // Two decimals on a suffixed figure, matching how Yahoo formats its own.
  const digits = suffix === "" && abs < 1 ? 6 : 2;
  return `${prefix}${scaled.toLocaleString("en-US", { maximumFractionDigits: digits })}${suffix}`;
}

/** Analyst consensus as a score in [-1, 1]. Yahoo's own keys, mapped once. */
export function recommendationScore(key: string | null | undefined): number | null {
  switch (key) {
    case "strong_buy": return 1;
    case "buy": return 0.5;
    case "hold": return 0;
    case "underperform": return -0.5;
    case "sell": return -1;
    default: return null;
  }
}

/* ------------------------------------------------------------- yahoo access */

/**
 * Yahoo's JSON endpoints want a cookie and a matching crumb. Node's fetch
 * keeps no cookie jar, so the pair is fetched together and reused for an hour.
 */
async function yahooCredentials(): Promise<{ cookie: string; crumb: string } | null> {
  return cached("yahoo:crumb", 3_600_000, async () => {
    const seed = await fetch("https://fc.yahoo.com/", { headers: { "User-Agent": UA } });
    const cookie = seed.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    if (!cookie) return null;
    const res = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
      headers: { ...YAHOO_HEADERS, Cookie: cookie },
    });
    const crumb = (await res.text()).trim();
    return crumb && crumb.length < 32 ? { cookie, crumb } : null;
  });
}

type YNum = { raw?: number; fmt?: string } | undefined;
const fmt = (n: YNum): string | null => n?.fmt ?? (n?.raw !== undefined ? String(n.raw) : null);

async function equityInfo(symbol: string): Promise<Partial<AssetInfo>> {
  const creds = await yahooCredentials();
  if (!creds) return {};
  const url =
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
    `?modules=assetProfile,summaryDetail,defaultKeyStatistics,financialData&crumb=${encodeURIComponent(creds.crumb)}`;
  const res = await fetch(url, { headers: { ...YAHOO_HEADERS, Cookie: creds.cookie } });
  if (!res.ok) return {};
  const r = (await res.json())?.quoteSummary?.result?.[0];
  if (!r) return {};

  const profile = r.assetProfile ?? {};
  const detail = r.summaryDetail ?? {};
  const key = r.defaultKeyStatistics ?? {};
  const fin = r.financialData ?? {};

  const stats: Stat[] = [];
  const push = (label: string, value: string | null) => { if (value) stats.push({ label, value }); };
  push("Market cap", fmt(detail.marketCap));
  push("P/E (trailing)", fmt(detail.trailingPE));
  push("Forward P/E", fmt(detail.forwardPE));
  push("52-week range", detail.fiftyTwoWeekLow?.fmt && detail.fiftyTwoWeekHigh?.fmt
    ? `${detail.fiftyTwoWeekLow.fmt} – ${detail.fiftyTwoWeekHigh.fmt}` : null);
  push("Dividend yield", fmt(detail.dividendYield));
  push("Beta", fmt(key.beta));
  push("Profit margin", fmt(fin.profitMargins));
  push("Revenue growth", fmt(fin.revenueGrowth));

  const score = recommendationScore(fin.recommendationKey);
  const target = fmt(fin.targetMeanPrice);
  const count = fin.numberOfAnalystOpinions?.raw;
  const sentiment: Sentiment | null = score === null ? null : {
    label: "Analyst consensus",
    value: String(fin.recommendationKey).replace(/_/g, " "),
    detail: [target ? `mean target ${target}` : null, count ? `${count} analysts` : null]
      .filter(Boolean).join(" · ") || null,
    score,
  };

  return {
    about: profile.longBusinessSummary ? plainText(profile.longBusinessSummary) : null,
    tags: [profile.sector, profile.industry, profile.country].filter(Boolean) as string[],
    stats,
    sentiment,
    sources: ["Yahoo Finance"],
  };
}

async function cryptoInfo(ticker: string): Promise<Partial<AssetInfo>> {
  const search = await fetch(
    `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(ticker)}`,
  );
  if (!search.ok) return {};
  const coin = pickCoin((await search.json())?.coins ?? [], ticker);
  if (!coin) return {};

  const res = await fetch(
    `https://api.coingecko.com/api/v3/coins/${coin.id}` +
    `?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`,
  );
  if (!res.ok) return {};
  const d = await res.json();
  const m = d.market_data ?? {};
  const usd = (o: Record<string, number> | undefined) => o?.usd;

  const stats: Stat[] = [];
  const push = (label: string, value: string | null) => { if (value) stats.push({ label, value }); };
  push("Market cap", compact(usd(m.market_cap), "$"));
  push("Rank", d.market_cap_rank ? `#${d.market_cap_rank}` : null);
  push("24h volume", compact(usd(m.total_volume), "$"));
  push("All-time high", compact(usd(m.ath), "$"));
  push("From ATH", m.ath_change_percentage?.usd !== undefined
    ? `${m.ath_change_percentage.usd.toFixed(1)}%` : null);
  push("Circulating", compact(m.circulating_supply));
  push("Max supply", compact(m.max_supply));

  return {
    about: d.description?.en ? plainText(d.description.en) : null,
    tags: [
      d.categories?.[0], d.categories?.[1],
      d.hashing_algorithm,
    ].filter(Boolean) as string[],
    stats,
    sources: ["CoinGecko"],
  };
}

/** Market-wide crypto sentiment. There is no per-coin equivalent that is free. */
async function fearGreed(): Promise<Sentiment | null> {
  const res = await fetch("https://api.alternative.me/fng/?limit=1");
  if (!res.ok) return null;
  const d = (await res.json())?.data?.[0];
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

async function headlines(symbol: string, assetType: "crypto" | "equity"): Promise<NewsItem[]> {
  const feedSymbol = assetType === "crypto" ? `${baseTicker(symbol)}-USD` : symbol;
  const res = await fetch(
    `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(feedSymbol)}&region=US&lang=en-US`,
    { headers: { "User-Agent": UA } },
  );
  if (!res.ok) return [];
  return parseRss(await res.text());
}

/**
 * Everything known about one holding beyond its price. Sources are queried in
 * parallel and any of them may fail: a missing profile should never cost the
 * page its headlines.
 */
export async function assetInfo(
  symbol: string, assetType: "crypto" | "equity",
): Promise<AssetInfo> {
  return cached(`info:${assetType}:${symbol}`, 1_800_000, async () => {
    const ticker = baseTicker(symbol);
    const [core, news, mood] = await Promise.allSettled([
      assetType === "equity" ? equityInfo(symbol) : cryptoInfo(ticker),
      headlines(symbol, assetType),
      assetType === "crypto" ? fearGreed() : Promise.resolve(null),
    ]);
    const base = core.status === "fulfilled" ? core.value : {};
    const items = news.status === "fulfilled" ? news.value : [];
    const sentiment = base.sentiment
      ?? (mood.status === "fulfilled" ? mood.value : null);
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
