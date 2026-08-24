import type { Net } from "../ports/net";
import { fetch24hTicker } from "../sources/binance";
import { fetchIndexSeries, fetchScreener, fetchTopByMarketCap, type IndexSeries, type IndexSpec } from "../sources/markets";

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
  return Promise.all(INDICES[category].map((spec) => fetchIndexSeries(net, spec)))
    .then((rows) => rows.filter((r): r is IndexSeries => r !== null));
}

export type MarketCategory = "crypto" | "stocks";

/** How many rows each column carries. */
const COLUMN = 5;
const RANKED = 10;

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
  const [tickers, ranked, indices] = await Promise.all([
    fetch24hTicker(net),
    fetchTopByMarketCap(net, RANKED),
    indicesFor(net, "crypto"),
  ]);

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

  const largest = ranked.map((c): MarketRow => {
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

  return { indices, up, down, largest, source: "Binance and CoinGecko", at: Date.now() };
}

async function stockBoard(net: Net): Promise<MarketBoard> {
  const [gainers, losers, actives, indices] = await Promise.all([
    fetchScreener(net, "day_gainers", COLUMN),
    fetchScreener(net, "day_losers", COLUMN),
    fetchScreener(net, "most_actives", 25),
    indicesFor(net, "stocks"),
  ]);

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
  const largest = actives
    .filter((e) => typeof e.marketCap === "number")
    .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))
    .slice(0, RANKED)
    .map(row);

  return {
    indices,
    up: gainers.filter((e) => e.changePct > 0).slice(0, COLUMN).map(row),
    down: losers.filter((e) => e.changePct < 0).slice(0, COLUMN).map(row),
    largest,
    source: "Yahoo Finance",
    at: Date.now(),
  };
}
