import type { Net } from "../ports/net";
import { fetch24hTicker } from "../sources/binance";
import {
  fetchConstituents, fetchIndexMeta, fetchIndexSeries, fetchScreener, fetchTopByMarketCap,
  type Constituent, type IndexMeta, type IndexSeries, type IndexSpec,
} from "../sources/markets";

/**
 * The Markets board: what moved today and what is largest, for one category.
 *
 * A service, so it takes its outside world as an argument and does no I/O of
 * its own. The route handler is a wrapper over this, and Phase 4's LocalClient
 * will call the same function with a different `Net`.
 */

export type MarketRow = {
  /** What to show: a base asset for a coin, a ticker for an equity. */
  symbol: string;
  /**
   * What to *ask for*, when that differs. A coin is displayed as BTC and
   * traded as BTCUSDT, and the price history is keyed on the pair — a link
   * built from the display symbol alone lands on a page with no chart.
   * Absent when there is no pair, which is every equity and every coin
   * CoinGecko ranks that Binance does not list.
   */
  pair?: string;
  name?: string;
  price: number;
  changePct: number;
  marketCap?: number;
  assetType: "crypto" | "equity";
};

export type MarketBoard = {
  /**
   * The market itself, before the outliers: the first two are drawn, the rest
   * sit behind "More". Ordered, and the screen does not reorder them.
   */
  indices: IndexSeries[];
  up: MarketRow[];
  down: MarketRow[];
  largest: MarketRow[];
  source: string;
  at: number;
  /**
   * Some of the board could not be loaded, and what is shown is what arrived.
   * Absent when everything did. The screen says so, because four empty columns
   * are indistinguishable from a flat market and only one of those is true.
   */
  partial?: boolean;
};

/**
 * What the strip shows, in the order it shows it. The first two are the visible
 * pair; everything after is one tap down.
 *
 * Stocks are the two blocs first — the S&P and the eurozone aggregate — then
 * the venues, home market leading. Crypto has no exchange to name (Binance is
 * a venue, not a market), so it is the largest coins and is not called an
 * index anywhere in the UI.
 */
const INDICES: Record<MarketCategory, IndexSpec[]> = {
  stocks: [
    { symbol: "^GSPC", label: "S&P 500", kind: "equity" },
    { symbol: "^STOXX50E", label: "Euro Stoxx 50", kind: "equity" },
    { symbol: "^AEX", label: "AEX", kind: "equity" },
    { symbol: "^NDX", label: "Nasdaq 100", kind: "equity" },
    { symbol: "^GDAXI", label: "DAX", kind: "equity" },
    { symbol: "^FTSE", label: "FTSE 100", kind: "equity" },
    { symbol: "^N225", label: "Nikkei 225", kind: "equity" },
    { symbol: "^HSI", label: "Hang Seng", kind: "equity" },
  ],
  crypto: [
    { symbol: "BTCUSDT", label: "Bitcoin", kind: "crypto" },
    { symbol: "ETHUSDT", label: "Ethereum", kind: "crypto" },
    { symbol: "SOLUSDT", label: "Solana", kind: "crypto" },
    { symbol: "XRPUSDT", label: "XRP", kind: "crypto" },
    { symbol: "BNBUSDT", label: "BNB", kind: "crypto" },
    { symbol: "DOGEUSDT", label: "Dogecoin", kind: "crypto" },
  ],
};

/**
 * Every card is fetched with the board, not on expansion.
 *
 * Expanding then costs nothing and never shows a spinner, and the whole set is
 * one cached hour of requests on a server with a single user. The alternative
 * — fetch two now, six on the tap — buys a little idle traffic back and pays
 * for it with a loading state in the one interaction the strip has.
 */
function indicesFor(net: Net, category: MarketCategory): Promise<IndexSeries[]> {
  return Promise.all(INDICES[category].map(async (spec): Promise<IndexSeries | null> => {
    const row = await fetchIndexSeries(net, spec);
    // Only an equity index has a page behind it: a crypto card is a coin, and
    // its page is the asset page every other coin already has.
    if (!row) return row;
    return spec.kind === "equity"
      ? { ...row, slug: slugFor(spec.label) }
      : { ...row, pair: spec.symbol };
  })).then((rows) => rows.filter((r): r is IndexSeries => r !== null));
}

export type MarketCategory = "crypto" | "stocks";

/** How many rows each movers column carries. */
const COLUMN = 5;
/**
 * How deep the ranked table goes.
 *
 * The screen shows ten and adds ten per tap, so this is the ceiling on that —
 * five taps. Fetched whole rather than paged, because both venues answer a
 * fifty-row request in the same round trip as a ten-row one, and paging would
 * buy a little idle traffic back in exchange for a spinner in the middle of
 * the only interaction the table has.
 */
const RANKED = 50;

/**
 * Pegged assets, excluded by name rather than by behaviour.
 *
 * Sorting by percentage change parks every stablecoin at the flat end
 * permanently — EURI and RLUSD both surfaced among the five weakest liquid
 * pairs on the day this was designed, at -1.0% and -0.0%. A volume floor does
 * not remove them because their volume is real. Only a list does.
 */
const PEGGED = new Set([
  "USDC", "FDUSD", "TUSD", "BUSD", "DAI", "USDP", "AEUR", "EUR", "EURI",
  "USD1", "USDE", "PYUSD", "XUSD", "RLUSD", "USDT",
]);

/** Below this, a 90% move is one trade rather than a market. */
const MIN_QUOTE_VOLUME = 10_000_000;

/**
 * Binance lists leveraged and index products against USDT too, and a 3× token
 * tracking a coin already in the column is noise rather than a second mover.
 */
const DERIVED = /(UP|DOWN|BULL|BEAR)$/;

export async function getMarkets(net: Net, category: MarketCategory): Promise<MarketBoard> {
  return category === "crypto" ? cryptoBoard(net) : stockBoard(net);
}

async function cryptoBoard(net: Net): Promise<MarketBoard> {
  // Settled for the same reason as the stock board: three independent sources,
  // and one refusal should cost its own section rather than the page.
  const [tickers, ranked, indices] = await settleAll([
    fetch24hTicker(net),
    fetchTopByMarketCap(net, RANKED),
    indicesFor(net, "crypto"),
  ] as const);

  // The ticker is the board. Without it there is nothing to show, and an
  // empty movers list would claim a still market.
  if (!tickers) throw new Error("no market data could be loaded");
  const partial = !ranked || !indices;

  const liquid = tickers.filter((t) => {
    if (!t.symbol.endsWith("USDT")) return false;
    const base = t.symbol.slice(0, -4);
    if (base === "" || PEGGED.has(base) || DERIVED.test(base)) return false;
    return t.quoteVolume >= MIN_QUOTE_VOLUME && Number.isFinite(t.priceChangePercent);
  });

  const row = (t: (typeof liquid)[number]): MarketRow => ({
    symbol: t.symbol.slice(0, -4),
    pair: t.symbol,
    price: t.lastPrice,
    changePct: t.priceChangePercent,
    assetType: "crypto",
  });

  // Filtered by sign, not merely sorted: on a day when everything liquid is
  // green, the bottom five are still gains, and a "down today" column full of
  // gains is a lie. An empty column is not.
  const up = liquid
    .filter((t) => t.priceChangePercent > 0)
    .sort((a, b) => b.priceChangePercent - a.priceChangePercent)
    .slice(0, COLUMN)
    .map(row);

  const down = liquid
    .filter((t) => t.priceChangePercent < 0)
    .sort((a, b) => a.priceChangePercent - b.priceChangePercent)
    .slice(0, COLUMN)
    .map(row);

  // One freshness per screen. CoinGecko decides the ranking and supplies the
  // cap, but its price is up to fifteen minutes old, and showing it beside a
  // one-minute-old price for the same coin puts two figures for BTC on one
  // page. Reprice from the ticker, and keep CoinGecko's price only where there
  // is no pair to reprice from — USDT is the quote asset, so USDTUSDT does not
  // exist.
  const byBase = new Map(tickers.filter((t) => t.symbol.endsWith("USDT"))
    .map((t) => [t.symbol.slice(0, -4), t]));

  const largest = (ranked ?? []).map((c): MarketRow => {
    const live = byBase.get(c.symbol);
    return {
      symbol: c.symbol,
      ...(live ? { pair: live.symbol } : {}),
      name: c.name,
      price: live ? live.lastPrice : c.price,
      changePct: live ? live.priceChangePercent : c.changePct,
      marketCap: c.marketCap,
      assetType: "crypto",
    };
  });

  return {
    indices: indices ?? [], up, down, largest,
    source: "Binance and CoinGecko", at: Date.now(),
    ...(partial ? { partial: true } : {}),
  };
}

async function stockBoard(net: Net): Promise<MarketBoard> {
  // Settled, not all. Four independent sources feed this board, and with
  // `Promise.all` a single upstream refusal emptied the whole page — which is
  // exactly what a phone saw when Yahoo answered 429 to one of them. Partial
  // is worth showing; the board says so rather than passing gaps off as a
  // quiet market.
  const [gainers, losers, actives, indices] = await settleAll([
    fetchScreener(net, "day_gainers", COLUMN),
    fetchScreener(net, "day_losers", COLUMN),
    fetchScreener(net, "most_actives", RANKED + 25),
    indicesFor(net, "stocks"),
  ] as const);

  // Every screener refused is a failure, not an empty market: a board of empty
  // columns claims the day was flat, and that is a different statement from
  // "nothing loaded". The indices strip is judged separately — it is eight
  // independent symbols and already drops the ones that fail.
  if (!gainers && !losers && !actives) {
    throw new Error("no market data could be loaded");
  }
  const partial = !gainers || !losers || !actives;

  const row = (e: { symbol: string; name: string; price: number; changePct: number; marketCap: number | null }): MarketRow => ({
    symbol: e.symbol,
    name: e.name,
    price: e.price,
    changePct: e.changePct,
    ...(e.marketCap === null ? {} : { marketCap: e.marketCap }),
    assetType: "equity",
  });

  // Yahoo has no "largest by market cap" screener, so the ranking is the most
  // active list sorted by cap. It is the largest of the actively traded, which
  // is what a browsing surface wants and is not quite the same claim — the
  // heading says "largest by market cap" of what is on the board.
  const largest = (actives ?? [])
    .filter((e) => typeof e.marketCap === "number")
    .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))
    .slice(0, RANKED)
    .map(row);

  return {
    indices: indices ?? [],
    up: (gainers ?? []).filter((e) => e.changePct > 0).slice(0, COLUMN).map(row),
    down: (losers ?? []).filter((e) => e.changePct < 0).slice(0, COLUMN).map(row),
    largest,
    source: "Yahoo Finance",
    at: Date.now(),
    ...(partial ? { partial: true } : {}),
  };
}

/** Every promise's value, or null where it rejected. */
async function settleAll<T extends readonly Promise<unknown>[]>(
  promises: T,
): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> | null }> {
  const settled = await Promise.allSettled(promises);
  return settled.map((r) => (r.status === "fulfilled" ? r.value : null)) as never;
}

/* ------------------------------------------------------------------ indices */

/**
 * A single index: its own figures, its month, and the companies in it.
 *
 * The constituents are a **fixed list**, and the UI says so. Yahoo's
 * components module and its batch-quote endpoint both answer `Invalid Crumb`
 * without the handshake this app cannot perform (spec §4.2), so there is no
 * feed to rank membership from. What is written below was checked against
 * Yahoo — every one of the eighty tickers resolves and returns a price — but
 * "these ten are the largest members today" is a claim nothing here can
 * verify, so the page claims only that they are major members.
 *
 * When one is wrong it goes quiet rather than lying: `fetchConstituents` drops
 * a ticker that fails to price.
 */
const CONSTITUENTS: Record<string, string[]> = {
  "^GSPC": ["NVDA", "MSFT", "AAPL", "AMZN", "GOOGL", "META", "AVGO", "TSLA", "BRK-B", "JPM"],
  "^NDX": ["NVDA", "MSFT", "AAPL", "AMZN", "AVGO", "META", "GOOGL", "TSLA", "NFLX", "COST"],
  "^STOXX50E": ["ASML.AS", "SAP.DE", "MC.PA", "SIE.DE", "TTE.PA", "SU.PA", "AIR.PA", "ALV.DE", "OR.PA", "SAN.PA"],
  "^AEX": ["ASML.AS", "SHELL.AS", "UNA.AS", "INGA.AS", "ADYEN.AS", "PRX.AS", "AD.AS", "PHIA.AS", "WKL.AS", "HEIA.AS"],
  "^GDAXI": ["SAP.DE", "SIE.DE", "ALV.DE", "DTE.DE", "AIR.DE", "MUV2.DE", "MBG.DE", "BAS.DE", "BMW.DE", "IFX.DE"],
  "^FTSE": ["AZN.L", "SHEL.L", "HSBA.L", "ULVR.L", "BP.L", "RIO.L", "GSK.L", "REL.L", "LSEG.L", "BATS.L"],
  "^N225": ["7203.T", "6758.T", "8306.T", "9984.T", "6861.T", "8035.T", "9432.T", "6098.T", "4063.T", "7974.T"],
  "^HSI": ["0700.HK", "9988.HK", "0939.HK", "1299.HK", "3690.HK", "0005.HK", "1810.HK", "0388.HK", "2318.HK", "0941.HK"],
};

/** URL-safe name for an index, so `^STOXX50E` is not in a path. */
export const INDEX_SLUGS: Record<string, IndexSpec> = Object.fromEntries(
  INDICES.stocks.map((spec) => [slugFor(spec.label), spec]),
);

/**
 * "S&P 500" -> "sp-500", "Euro Stoxx 50" -> "euro-stoxx-50".
 *
 * The ampersand is dropped rather than spelled out: expanding it gave
 * "sandp-500", which reads as a word nobody meant.
 */
function slugFor(label: string): string {
  return label.toLowerCase().replace(/&/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export type IndexDetail = {
  slug: string;
  meta: IndexMeta;
  /** A month of closes, as the strip draws them. */
  points: number[];
  changePct: number;
  /** Major members, priced live. A fixed list — see CONSTITUENTS. */
  constituents: Constituent[];
};

export async function getIndexDetail(net: Net, slug: string): Promise<IndexDetail | null> {
  const spec = INDEX_SLUGS[slug];
  if (!spec) return null;
  const [meta, series, constituents] = await Promise.all([
    fetchIndexMeta(net, spec.symbol),
    fetchIndexSeries(net, spec),
    fetchConstituents(net, CONSTITUENTS[spec.symbol] ?? []),
  ]);
  if (!meta) return null;
  return {
    slug,
    meta,
    points: series?.points ?? [],
    changePct: series?.changePct ?? 0,
    constituents,
  };
}
