import { cached } from "@/core/cache";
import type { EquityQuote } from "@/core/equity";
import { type DisplayCurrency, FIAT, needsRate } from "@/core/currencies";
import { rateOn } from "@/core/fx";
import { pricingPair } from "@/core/symbols";
import type { Net } from "../ports/net";
import type { Store } from "../ports/store";
import { fetchKlines, fetchKlinesRange, fetchDailyStats } from "../sources/binance";
import { makeEquitySource } from "../sources/equity";
import { fetchEcbRates, fetchLatestUsdPer } from "../sources/fx";

const DAY_MS = 86_400_000;

/**
 * The preamble six route handlers each opened with: read settings, pick the
 * display currency, price it against USD, and derive the conversion factor.
 * `fetchEquityPricesUsd` and `fetchCryptoPrevCloses` land here too (Task 4) —
 * their callers need this same context, so this file is a pricing service,
 * not a single-function wrapper around it.
 */
export type DisplayContext = {
  currency: DisplayCurrency;
  /** Multiply a USD figure by this to get the display currency. */
  toDisplay: number;
  /** USD per 1 unit of the display currency; 1 when displaying USD. */
  displayUsd: number;
  equityProvider: string;
  equityApiKey: string | null;
};

/**
 * The part of the preamble that has nothing to do with the rate lookup.
 * `displayContext` builds on it for "latest"; Task 4's `snapshot` conversion
 * needs a point-in-time rate instead and can build a `displayContextAt(date)`
 * on the same settings read without re-copying it.
 */
async function settingsPart(store: Store): Promise<{
  currency: DisplayCurrency;
  equityProvider: string;
  equityApiKey: string | null;
}> {
  const settings = await store.settings.get();
  return {
    currency: settings.displayCurrency,
    equityProvider: settings.equityProvider,
    equityApiKey: settings.equityApiKey,
  };
}

/**
 * Every route that called this preamble picked `currency` from settings and
 * used it — unconditionally — to decide which stored transactions were
 * already priced in the display currency (`toDisplayTxs`'s native-currency
 * match). Only *after* that did three of the six routes relabel a failed EUR
 * lookup back to "USD" for the figure they returned to the caller. That
 * relabelling is response-shaping specific to each route, not part of this
 * shared preamble, so `currency` here stays the raw pick from settings even
 * when `displayUsd` is 0 — exactly what the routes being converted already do.
 */
export async function displayContext(store: Store, net: Net): Promise<DisplayContext> {
  const { currency, equityProvider, equityApiKey } = await settingsPart(store);
  const displayUsd = (await fetchLatestUsdPer(net, currency)) ?? 0;
  const toDisplay = displayUsd > 0 ? 1 / displayUsd : 1;

  return { currency, toDisplay, displayUsd, equityProvider, equityApiKey };
}

/**
 * The same context as `displayContext`, but for a past date: `snapshot` values
 * a portfolio as it stood on one day, and re-converting that day's figures at
 * today's rate would misstate them by however much the currency pair has moved
 * since. It shares `settingsPart` with the live variant so the two can never
 * disagree about which currency is being displayed.
 *
 * `toDisplay` falls back to **1**, not 0, when the rate lookup fails — the
 * behaviour of the route this replaces. Under a EUR display that silently
 * treats USD figures as euros, which is wrong but is what the endpoint does
 * today; changing it is a behaviour change, not a conversion.
 */
export type DatedDisplayContext = {
  currency: DisplayCurrency;
  /** Multiply a USD figure by this to get the display currency, as of `at`. */
  toDisplay: number;
  equityProvider: string;
  equityApiKey: string | null;
};

export async function displayContextAt(
  store: Store,
  net: Net,
  at: number,
): Promise<DatedDisplayContext> {
  const { currency, equityProvider, equityApiKey } = await settingsPart(store);
  let toDisplay = 1;
  if (currency !== "USD") {
    try {
      const rates = await fetchEcbRates(net, "USD", currency, at - 10 * DAY_MS, at + DAY_MS);
      toDisplay = rateOn(rates, at) ?? 1;
    } catch {
      toDisplay = 1;
    }
  }
  return { currency, toDisplay, equityProvider, equityApiKey };
}

/**
 * Live equity quotes converted to USD via current ECB rates.
 *
 * Lifted from `valuation/route.ts`, but placed here rather than in the
 * valuation service: `benchmark`, `history`, `changes` and `series` all reach
 * for equity prices too, and a service-to-service import across domains is a
 * seam that only has to be untangled later.
 */
export async function fetchEquityPricesUsd(
  net: Net,
  symbols: string[],
  provider: string | null | undefined,
  apiKey: string | null | undefined,
): Promise<Record<string, { price: number; prevClose?: number; name?: string; instrumentType?: string }>> {
  if (symbols.length === 0) return {};
  const source = makeEquitySource(net, provider, apiKey);
  let quotes: Record<string, EquityQuote> = {};
  try {
    quotes = await source.quotes(symbols);
  } catch {
    return {};
  }
  const out: Record<string, { price: number; prevClose?: number; name?: string; instrumentType?: string }> = {};
  const fxCache = new Map<string, number | null>();
  for (const [symbol, q] of Object.entries(quotes)) {
    const cur = q.currency.toUpperCase();
    if (cur === "USD") { out[symbol] = { price: q.price, prevClose: q.prevClose, name: q.name, instrumentType: q.instrumentType }; continue; }
    // Some venues quote in minor units (GBp on LSE).
    const minor = cur === "GBP" && q.price > 1000 ? 100 : 1;
    const price = q.price / minor;
    if (!fxCache.has(cur)) {
      try {
        const rates = await fetchEcbRates(
          net, cur === "GBX" ? "GBP" : cur, "USD", Date.now() - 10 * DAY_MS, Date.now(),
        );
        fxCache.set(cur, rateOn(rates, Date.now()));
      } catch {
        fxCache.set(cur, null);
      }
    }
    const rate = fxCache.get(cur);
    if (rate) {
      out[symbol] = {
        price: price * rate,
        prevClose: q.prevClose !== undefined ? (q.prevClose / minor) * rate : undefined,
        name: q.name,
        instrumentType: q.instrumentType,
      };
    }
  }
  return out;
}

/** Last fully closed daily candle per symbol — two bars each, fetched in parallel. */
/**
 * What each pair traded at a rolling twenty-four hours ago.
 *
 * A thin read of `fetchDailyStats`, which asks Binance for its own
 * rolling-window open rather than reconstructing one. The previous version
 * read 25 hourly klines per pair and took the oldest bar's close — hour-aligned,
 * so the window ran 24 to 25 hours, and 0.58 points adrift on ETHUSDT at 12:35
 * UTC on 2026-08-25.
 *
 * Crypto only, and that is not an oversight. Equities keep the previous
 * session close (`fetchEquityPricesUsd` carries the provider's own figure),
 * because a market that shuts has no price twenty-four hours ago: measured on
 * 2026-08-25 at 09:17 UTC, the nearest real AMD trade to "a day ago" was 62
 * hours old — the previous Friday — because the US session had not opened on
 * either day. A rolling window there would report three days and call it one.
 */
export async function fetchCrypto24hAgo(
  net: Net,
  symbols: string[],
): Promise<Record<string, number>> {
  const stats = await fetchDailyStats(net, symbols);
  return Object.fromEntries(Object.entries(stats).map(([pair, s]) => [pair, s.open24h]));
}

/**
 * USD per one unit of `currency` on a given date, or null when no rate can be
 * had. A stable answers 1 without asking anyone.
 *
 * One date, one currency — deliberately not the importer's shape. `transfer.ts`
 * fetches a range per currency across many rows, which is the right access
 * pattern there and the wrong one for a single manual entry. What the two share
 * is the classification in `@/core/currencies`, not the fetching: the rule for
 * *which* source answers must have one home, while *how much* is asked for at a
 * time is each caller's business.
 */
export async function usdRateOn(
  net: Net,
  currency: string,
  time: number,
): Promise<number | null> {
  const c = currency.toUpperCase();
  if (!needsRate(c)) return 1;

  const from = time - 5 * DAY_MS;
  const to = time + DAY_MS;

  // Binance first: it covers coin quotes, and for fiat it is the same series
  // the importer uses, so a hand entry and an import agree.
  try {
    const bars = await fetchKlinesRange(net, {
      symbol: pricingPair(c), interval: "1d", from, to,
    });
    const byDay = new Map(bars.map((b) => [b.t, b.c]));
    const hit = rateOn(byDay, time);
    if (hit !== null) return hit;
  } catch {
    // No Binance market for this currency; fall through to the ECB.
  }

  // EURUSDT only lists from late 2020, so an older fiat trade needs the ECB.
  if (FIAT.has(c)) {
    try {
      const ecb = await fetchEcbRates(net, c, "USD", from, to);
      return rateOn(ecb, time);
    } catch {
      // Unavailable; the caller stores the native figures and a zero price.
    }
  }
  return null;
}
