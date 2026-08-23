import { cached } from "@/core/cache";
import {
  parseRss,
  plainText,
  recommendationScore,
  type AssetInfo,
  type NewsItem,
  type Sentiment,
  type Stat,
} from "@/core/asset-info";

/**
 * Background, sentiment and headlines for one **equity** holding.
 *
 * The crypto half of this lives in `packages/data/src/sources/asset-info.ts`,
 * reached through an injected `Net` and therefore portable to the device build.
 * This half cannot follow yet: Yahoo's quoteSummary endpoint wants a session
 * cookie read back off the *first* response's `Set-Cookie` header before the
 * crumb-bearing second request can be made, and `Net`/`NetResponse` is body-only
 * on both sides — no response-header reader exists. A browser `fetch` could not
 * read `Set-Cookie` even if one did. Giving `Net` cookie-jar semantics is a
 * task of its own.
 *
 * Until then it is server-only, so it sits here beside its one caller rather
 * than in `packages/core`, which is now wholly pure and guarded as such by
 * `packages/core/src/boundary.test.ts`.
 *
 * It still fetches through the same process-local cache as everything else, and
 * under the same keys core used (`yahoo:crumb`, `info:equity:<symbol>`), so the
 * move costs no cache hits.
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

async function equityProfile(symbol: string): Promise<Partial<AssetInfo>> {
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

async function headlines(symbol: string): Promise<NewsItem[]> {
  const res = await fetch(
    `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`,
    { headers: { "User-Agent": UA } },
  );
  if (!res.ok) return [];
  return parseRss(await res.text());
}

/**
 * Everything known about one equity holding beyond its price. The two sources
 * are queried in parallel and either may fail: a missing company profile must
 * never cost the page its headlines.
 */
export async function equityInfo(symbol: string): Promise<AssetInfo> {
  return cached(`info:equity:${symbol}`, 1_800_000, async () => {
    const [profile, news] = await Promise.allSettled([equityProfile(symbol), headlines(symbol)]);
    const base = profile.status === "fulfilled" ? profile.value : {};
    const items = news.status === "fulfilled" ? news.value : [];
    return {
      symbol,
      about: base.about ?? null,
      tags: base.tags ?? [],
      stats: base.stats ?? [],
      sentiment: base.sentiment ?? null,
      news: items,
      sources: [...(base.sources ?? []), ...(items.length ? ["Yahoo Finance news"] : [])],
    };
  });
}
