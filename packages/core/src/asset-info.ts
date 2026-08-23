/**
 * The shapes an asset-info panel is made of, and the parsing that turns each
 * provider's payload into them.
 *
 * Pure by construction: the crypto/news/sentiment fetching lives in
 * `packages/data/src/sources/asset-info.ts` behind an injected `Net`, and the
 * equity path — blocked on Yahoo's cookie-and-crumb handshake, which `Net`
 * cannot yet express — in `apps/web/src/lib/equity-info.ts`. Both import from
 * here, so there is one definition of a `Stat` and one RSS reader.
 */

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
