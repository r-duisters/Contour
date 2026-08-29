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
 * The equity half used to be excluded entirely: Yahoo's company profile sits
 * behind a cookie-and-crumb handshake, and the note here said `Net` was
 * body-only with no way to read the `Set-Cookie` off the first response. That
 * stopped being true when `NetResponse.header()` was added for
 * `Content-Disposition` — and a native HTTP stack, which is what the device
 * has, is not subject to the browser rule that makes `Set-Cookie` unreadable.
 *
 * So it is attempted here now, and falls back to what the chart endpoint alone
 * can say. `apps/web/src/lib/equity-info.ts` still exists and the web route
 * still uses it: it fetches more modules and has a working implementation, and
 * replacing a working server path to prove a point is not a reason.
 *
 * The cache key (`info:crypto:${symbol}`) is the one core used, so nothing was
 * lost when core's copy went.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * What every Yahoo call here sends, and what only the JSON ones do.
 *
 * `Accept: application/json` is not shared, because `getcrumb` answers plain
 * text and refuses that header with a 406 — which is a session that silently
 * never forms, and therefore a company description that silently never
 * arrives. Found by sending the two-header block to all three endpoints.
 */
const YAHOO_UA = { "User-Agent": UA } as const;
const YAHOO_JSON = { ...YAHOO_UA, Accept: "application/json" } as const;

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
  /** Share of CoinGecko voters who are bullish on *this* coin, 0–100. */
  sentiment_votes_up_percentage?: number | null;
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
    sentiment: coinSentiment(d, ticker),
    sources: ["CoinGecko"],
  };
}

/**
 * How this coin's own holders feel about it, from the response already in hand.
 *
 * The Fear & Greed index below is a reading of the whole crypto market, and it
 * said so — "Whole-market mood, not this coin" — which is an honest caption on
 * a figure that should not have been there. Three reviewers independently
 * called it filler, and they were right about the generic version: a number
 * identical on every coin page tells you nothing about the coin you opened.
 *
 * CoinGecko carries a per-coin one and this module was already fetching it.
 * The comment on `fearGreed` claimed no free per-coin equivalent existed; the
 * field was in the same JSON the line above it parses.
 */
function coinSentiment(d: CoinGeckoCoin, ticker: string): Sentiment | null {
  const up = d.sentiment_votes_up_percentage;
  if (typeof up !== "number" || !Number.isFinite(up)) return null;
  return {
    label: "Community sentiment",
    value: `${Math.round(up)}% bullish`,
    detail: `CoinGecko voters, on ${ticker.toUpperCase()} itself`,
    score: (up - 50) / 50,
  };
}

/**
 * Market-wide crypto sentiment, and now only the fallback.
 *
 * This carried the note "There is no per-coin equivalent that is free", which
 * was wrong: CoinGecko ships one in the same JSON `cryptoInfo` was already
 * parsing. It is used when a coin has no votes of its own, and it keeps saying
 * plainly that it is the market's mood rather than this coin's.
 */
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
/**
 * A Yahoo session, for the endpoints that will not answer without one.
 *
 * Two requests: something on the yahoo.com domain that sets a cookie, then the
 * crumb endpoint with that cookie. Both are cheap and the pair is cached for
 * an hour, because every asset page would otherwise repeat them.
 *
 * Returns null on anything unexpected, and every caller treats that as "no
 * profile" rather than as an error. On a browser `Set-Cookie` is unreadable by
 * rule, so this simply never succeeds there — which is correct, since the web
 * build has a server-side implementation that does not need it.
 */
async function yahooSession(net: Net): Promise<{ cookie: string; crumb: string } | null> {
  return cached("yahoo:session", 3_600_000, async () => {
    try {
      const seed = await net.request("https://fc.yahoo.com/", { headers: YAHOO_UA });
      const raw = seed.header("set-cookie");
      if (!raw) return null;
      // Only the name=value part: the attributes are the browser's business
      // and Yahoo rejects a Cookie header that carries them back.
      const cookie = raw.split(",").map((c) => c.split(";")[0]!.trim()).filter(Boolean).join("; ");
      if (!cookie) return null;

      const res = await net.request("https://query2.finance.yahoo.com/v1/test/getcrumb", {
        headers: { ...YAHOO_UA, Cookie: cookie },
      });
      if (!res.ok) return null;
      const crumb = (await res.text()).trim();
      // A crumb is a short token. An HTML error page is not, and answering one
      // as though it were is how a bad session becomes a confusing 401 later.
      return crumb && crumb.length < 32 ? { cookie, crumb } : null;
    } catch {
      return null;
    }
  });
}

/**
 * The company's own description, which the chart endpoint does not carry.
 *
 * Without this a share's About is one sentence — "Advanced Micro Devices,
 * Inc., listed on NasdaqGS." — beside a coin's several paragraphs, which is
 * the difference a person notices.
 */
async function equityProfile(net: Net, symbol: string): Promise<string | null> {
  const session = await yahooSession(net);
  if (!session) return null;
  try {
    const res = await net.request(
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
        `?modules=assetProfile&crumb=${encodeURIComponent(session.crumb)}`,
      { headers: { ...YAHOO_JSON, Cookie: session.cookie } },
    );
    if (!res.ok) return null;
    const r = (await res.json<{
      quoteSummary?: { result?: { assetProfile?: { longBusinessSummary?: string } }[] };
    }>())?.quoteSummary?.result?.[0]?.assetProfile?.longBusinessSummary;
    return r ? plainText(r) : null;
  } catch {
    return null;
  }
}

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
  // The company's own words where the handshake worked, and the one-line
  // fallback where it did not — which is what this answered for every share
  // until now.
  const summary = await equityProfile(net, symbol);
  return {
    about: summary
      ?? (name ? `${name}${m.fullExchangeName ? `, listed on ${m.fullExchangeName}` : ""}.` : null),
    tags: m.instrumentType ? [m.instrumentType.toLowerCase()] : [],
    stats,
    sentiment: rangePosition(m),
    sources: ["Yahoo Finance"],
  };
}

/**
 * Where a share sits between its own 52-week low and high.
 *
 * Not a mood, and it is not labelled as one. A share has no free per-company
 * sentiment feed this app can reach — Yahoo's analyst figures live behind
 * `quoteSummary`, which answers "Invalid Crumb" without the cookie-and-crumb
 * handshake the portable `Net` cannot perform (spec §4.2). Inventing a mood
 * from a price would be worse than having none.
 *
 * What it can say is true and specific to the company: 90% of the way up its
 * own year is a different situation from 10%, and it needs no source the page
 * is not already reading — the two bounds are in the same `meta` the stat
 * above uses. A bar is a better fit for a position in a range than it ever was
 * for a mood.
 */
function rangePosition(m: EquityMeta): Sentiment | null {
  const { fiftyTwoWeekLow: lo, fiftyTwoWeekHigh: hi, regularMarketPrice: px } = m;
  if (typeof lo !== "number" || typeof hi !== "number" || typeof px !== "number") return null;
  if (!(hi > lo)) return null;
  const at = Math.min(1, Math.max(0, (px - lo) / (hi - lo)));
  return {
    label: "52-week position",
    value: `${Math.round(at * 100)}% of the way up`,
    detail: "Between this share's own year low and year high",
    // Centred like the others: the middle of the range is neutral, and the
    // ends are the only readings worth colouring.
    score: at * 2 - 1,
  };
}

type EquityMeta = {
  longName?: string; shortName?: string; instrumentType?: string;
  fullExchangeName?: string; exchangeName?: string; currency?: string;
  regularMarketDayHigh?: number; regularMarketDayLow?: number; regularMarketVolume?: number;
  fiftyTwoWeekHigh?: number; fiftyTwoWeekLow?: number;
  regularMarketPrice?: number;
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
