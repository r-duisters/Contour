import { cached } from "@/core/cache";
import type { Net } from "../ports/net";

/**
 * The market-board transport: CoinGecko for what the largest coins are, and
 * Yahoo's predefined screeners for equities. Binance's own 24-hour ticker
 * lives in `./binance.ts` beside the rest of that host's surface.
 *
 * Everything here memoises through `@/core/cache`, which is process-local and
 * shared. Read the header of `./binance.ts` before writing a test that touches
 * these — a cache hit answers before the injected `Net` is consulted, so a
 * suite without `invalidate()` in `beforeEach` can pass against nothing.
 */

/**
 * Whether the US equity market is open, to the nearest hour that matters.
 *
 * 09:30–16:00 New York, Monday to Friday. Deliberately ignores public
 * holidays: the only cost of missing one is a handful of refreshes on a day
 * the figures do not move, and a holiday calendar is a dependency and a
 * maintenance burden for that.
 *
 * DST is handled by taking the offset from the date itself rather than
 * assuming one: New York is UTC-4 from the second Sunday in March to the
 * first Sunday in November, and UTC-5 otherwise.
 */
export function usMarketOpen(now: number): boolean {
  const d = new Date(now);
  const offset = nyOffsetHours(d);
  const ny = new Date(now + offset * 3_600_000);
  const day = ny.getUTCDay();
  if (day === 0 || day === 6) return false;
  const mins = ny.getUTCHours() * 60 + ny.getUTCMinutes();
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

function nyOffsetHours(d: Date): number {
  const y = d.getUTCFullYear();
  const march = new Date(Date.UTC(y, 2, 1));
  const dstStart = Date.UTC(y, 2, 8 + ((7 - march.getUTCDay()) % 7), 7);
  const nov = new Date(Date.UTC(y, 10, 1));
  const dstEnd = Date.UTC(y, 10, 1 + ((7 - nov.getUTCDay()) % 7), 6);
  const t = d.getTime();
  return t >= dstStart && t < dstEnd ? -4 : -5;
}

/** One coin as CoinGecko ranks it: the cap is theirs, the price may be repriced later. */
export type CoinRow = {
  symbol: string;
  name: string;
  price: number;
  changePct: number;
  marketCap: number;
};

/** One equity as a Yahoo screener returns it. `marketCap` is absent for some funds. */
export type EquityRow = {
  symbol: string;
  name: string;
  price: number;
  changePct: number;
  marketCap: number | null;
};

/**
 * The largest coins by market cap, in CoinGecko's order.
 *
 * Fifteen minutes: a ranking that reorders on a fifteen-minute boundary is
 * still telling the truth about which coins are the largest, and CoinGecko's
 * free tier is rate-limited per minute.
 */
export function fetchTopByMarketCap(net: Net, limit: number): Promise<CoinRow[]> {
  const bucket = Math.floor(Date.now() / 900_000);
  return cached(`coingecko:top:${limit}:${bucket}`, 900_000, async () => {
    const raw = await net.json<{
      symbol: string;
      name: string;
      current_price: number;
      price_change_percentage_24h: number | null;
      market_cap: number;
    }[]>(
      "https://api.coingecko.com/api/v3/coins/markets" +
        `?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1`,
    );
    return raw.map((r) => ({
      symbol: r.symbol.toUpperCase(),
      name: r.name,
      price: r.current_price,
      changePct: r.price_change_percentage_24h ?? 0,
      marketCap: r.market_cap,
    }));
  });
}

export type ScreenerId = "day_gainers" | "day_losers" | "most_actives";

/**
 * One of Yahoo's predefined screeners.
 *
 * Refreshed every five minutes while New York is open and hourly when it is
 * not — the figures do not move outside the session, so a shorter window buys
 * nothing but requests.
 *
 * This is an undocumented endpoint that answers 401 when it feels like it, so
 * a response without `finance.result[0].quotes` yields an empty list rather
 * than throwing. A Markets page missing one column is better than one that
 * fails to render.
 */
export function fetchScreener(net: Net, id: ScreenerId, count: number): Promise<EquityRow[]> {
  const ttl = usMarketOpen(Date.now()) ? 300_000 : 3_600_000;
  const bucket = Math.floor(Date.now() / ttl);
  return cached(`yahoo:screener:${id}:${count}:${bucket}`, ttl, async () => {
    const url =
      "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved" +
      `?scrIds=${id}&count=${count}`;
    let raw: { finance?: { result?: { quotes?: RawQuote[] }[] | null } };
    try {
      raw = await net.json(url);
    } catch {
      return [];
    }
    const quotes = raw.finance?.result?.[0]?.quotes;
    if (!Array.isArray(quotes)) return [];
    return quotes.map((q) => ({
      symbol: q.symbol,
      name: q.shortName ?? q.longName ?? q.symbol,
      price: q.regularMarketPrice ?? 0,
      changePct: q.regularMarketChangePercent ?? 0,
      marketCap: typeof q.marketCap === "number" ? q.marketCap : null,
    }));
  });
}

type RawQuote = {
  symbol: string;
  shortName?: string;
  longName?: string;
  regularMarketPrice?: number;
  regularMarketChangePercent?: number;
  marketCap?: number;
};

/** One index or coin the Markets strip can draw. */
export type IndexSpec = { symbol: string; label: string; kind: "equity" | "crypto" };

/** A drawn index: its closes over the window, and what they add up to. */
export type IndexSeries = {
  label: string;
  /** URL-safe name for an equity index; the screen links to its page with it. */
  slug?: string;
  /** The tradable pair for a coin card, which links to the asset page instead. */
  pair?: string;
  /** Daily closes, oldest first. Sent raw — the caller thins to its own width. */
  points: number[];
  changePct: number;
  /** Only for coins: an index level is not a price anybody reads. */
  price?: number;
};

/**
 * A month of daily closes for one index or coin.
 *
 * `null` rather than a throw when a venue is unreachable or answers with
 * nothing usable. The strip draws eight of these and one bad symbol must not
 * take the board with it — the same reasoning as the screeners above.
 *
 * An hour, for both venues. These are month-long lines: a fresher figure would
 * move the last pixel and nothing else.
 */
export function fetchIndexSeries(net: Net, spec: IndexSpec): Promise<IndexSeries | null> {
  const bucket = Math.floor(Date.now() / 3_600_000);
  return cached(`index:${spec.symbol}:${bucket}`, 3_600_000, async () => {
    try {
      const closes = spec.kind === "crypto"
        ? await cryptoCloses(net, spec.symbol)
        : await equityCloses(net, spec.symbol);
      // Two points is the minimum that has a direction; one is a dot.
      if (closes.length < 2) return null;
      const first = closes[0]!;
      const last = closes[closes.length - 1]!;
      if (!(first > 0)) return null;
      return {
        label: spec.label,
        points: closes,
        changePct: ((last - first) / first) * 100,
        ...(spec.kind === "crypto" ? { price: last } : {}),
      };
    } catch {
      return null;
    }
  });
}

async function equityCloses(net: Net, symbol: string): Promise<number[]> {
  const raw = await net.json<{
    chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] | null };
  }>(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
      "?range=1mo&interval=1d",
    { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } },
  );
  const closes = raw.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
  // A closed session arrives as a null beside a real timestamp.
  return closes.filter((c): c is number => typeof c === "number");
}

async function cryptoCloses(net: Net, symbol: string): Promise<number[]> {
  const raw = await net.json<unknown[][]>(
    `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=1d&limit=31`,
  );
  return raw.map((k) => Number(k[4])).filter((c) => Number.isFinite(c));
}

/** What an index's own chart says about itself. Every field is Yahoo's, none invented. */
export type IndexMeta = {
  name: string;
  /** "Amsterdam", "NASDAQ" — the venue, as the venue names itself. */
  exchange: string;
  currency: string;
  timezone: string;
  level: number;
  previousClose: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  yearHigh: number | null;
  yearLow: number | null;
  /** First bar Yahoo holds, in ms. A rough founding date, and labelled as one. */
  since: number | null;
};

/**
 * The index's own figures, from the `meta` block of its chart.
 *
 * Deliberately separate from `fetchIndexSeries`: the strip needs closes and
 * nothing else, and this needs everything but the closes. Sharing one call
 * would make the strip pay for eight copies of a block it never reads.
 */
export function fetchIndexMeta(net: Net, symbol: string): Promise<IndexMeta | null> {
  const bucket = Math.floor(Date.now() / 3_600_000);
  return cached(`indexmeta:${symbol}:${bucket}`, 3_600_000, async () => {
    try {
      const raw = await net.json<{ chart?: { result?: { meta?: RawIndexMeta }[] | null } }>(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
          "?range=1d&interval=1d",
        { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } },
      );
      const m = raw.chart?.result?.[0]?.meta;
      if (!m || typeof m.regularMarketPrice !== "number") return null;
      return {
        name: m.longName ?? m.shortName ?? symbol,
        exchange: m.fullExchangeName ?? m.exchangeName ?? "",
        currency: m.currency ?? "",
        timezone: m.exchangeTimezoneName ?? "",
        level: m.regularMarketPrice,
        previousClose: num(m.chartPreviousClose ?? m.previousClose),
        dayHigh: num(m.regularMarketDayHigh),
        dayLow: num(m.regularMarketDayLow),
        yearHigh: num(m.fiftyTwoWeekHigh),
        yearLow: num(m.fiftyTwoWeekLow),
        since: typeof m.firstTradeDate === "number" ? m.firstTradeDate * 1000 : null,
      };
    } catch {
      return null;
    }
  });
}

type RawIndexMeta = {
  longName?: string; shortName?: string; fullExchangeName?: string; exchangeName?: string;
  currency?: string; exchangeTimezoneName?: string; regularMarketPrice?: number;
  chartPreviousClose?: number; previousClose?: number; regularMarketDayHigh?: number;
  regularMarketDayLow?: number; fiftyTwoWeekHigh?: number; fiftyTwoWeekLow?: number;
  firstTradeDate?: number;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** One listed company, priced off its own chart because batch quotes need a crumb. */
export type Constituent = {
  symbol: string;
  name: string;
  price: number;
  changePct: number;
  currency: string;
};

/**
 * Price a list of tickers, one chart request each, in parallel.
 *
 * The batch endpoint (`v7/finance/quote`) answers `Unauthorized` without the
 * crumb this app cannot obtain — see spec §4.2 — so this is the same
 * one-request-per-symbol path `YahooSource.quotes` already uses for holdings.
 * Ten symbols is ten requests, cached for an hour.
 *
 * A ticker that fails is dropped rather than throwing: a delisting should cost
 * one row, not the page.
 */
export async function fetchConstituents(net: Net, symbols: string[]): Promise<Constituent[]> {
  const rows = await Promise.all(symbols.map((symbol) => fetchOneQuote(net, symbol)));
  return rows.filter((r): r is Constituent => r !== null);
}

function fetchOneQuote(net: Net, symbol: string): Promise<Constituent | null> {
  const bucket = Math.floor(Date.now() / 3_600_000);
  return cached(`quote1:${symbol}:${bucket}`, 3_600_000, async () => {
    try {
      const raw = await net.json<{ chart?: { result?: { meta?: RawIndexMeta }[] | null } }>(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
          "?range=1d&interval=1d",
        { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } },
      );
      const m = raw.chart?.result?.[0]?.meta;
      const price = m?.regularMarketPrice;
      const prev = m?.chartPreviousClose ?? m?.previousClose;
      if (typeof price !== "number") return null;
      return {
        symbol,
        name: m?.longName ?? m?.shortName ?? symbol,
        price,
        changePct: typeof prev === "number" && prev > 0 ? ((price - prev) / prev) * 100 : 0,
        currency: m?.currency ?? "",
      };
    } catch {
      return null;
    }
  });
}
