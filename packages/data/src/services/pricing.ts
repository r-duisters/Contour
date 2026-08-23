import { cached } from "@/core/cache";
import type { EquityQuote } from "@/core/equity";
import { rateOn } from "@/core/fx";
import type { Net } from "../ports/net";
import type { Store } from "../ports/store";
import { fetchKlines } from "../sources/binance";
import { makeEquitySource } from "../sources/equity";
import { fetchEcbRates, fetchLatestEurUsd } from "../sources/fx";

const DAY_MS = 86_400_000;

/**
 * The preamble six route handlers each opened with: read settings, pick the
 * display currency, price it against USD, and derive the conversion factor.
 * `fetchEquityPricesUsd` and `fetchCryptoPrevCloses` land here too (Task 4) —
 * their callers need this same context, so this file is a pricing service,
 * not a single-function wrapper around it.
 */
export type DisplayContext = {
  currency: "USD" | "EUR";
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
  currency: "USD" | "EUR";
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
  const displayUsd = currency === "EUR" ? ((await fetchLatestEurUsd(net)) ?? 0) : 1;
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
  currency: "USD" | "EUR";
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
export async function fetchCryptoPrevCloses(
  net: Net,
  symbols: string[],
): Promise<Record<string, number>> {
  if (symbols.length === 0) return {};
  const results = await Promise.allSettled(
    symbols.map((s) =>
      cached(`prevclose:${s}:${Math.floor(Date.now() / 300_000)}`, 300_000, () =>
        fetchKlines(net, { symbol: s, interval: "1d", limit: 2 }),
      ),
    ),
  );
  const out: Record<string, number> = {};
  results.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    const closed = r.value.filter((b) => b.t + DAY_MS <= Date.now());
    const last = closed[closed.length - 1];
    if (last) out[symbols[i]!] = last.c;
  });
  return out;
}
