import type { Net } from "../ports/net";
import type { Store } from "../ports/store";

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
 * Latest EUR->USD rate, or null if the lookup failed. Ported from
 * `fx.ts#fetchLatestEurUsd` onto `Net` rather than global `fetch` — see
 * `packages/data/src/ports/net.ts` for why a non-2xx is a value here while a
 * transport or parse failure still propagates.
 */
async function fetchLatestEurUsd(net: Net): Promise<number | null> {
  const res = await net.request("https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD");
  if (!res.ok) return null;
  const data = await res.json<{ rates?: { USD?: number } }>();
  return data.rates?.USD ?? null;
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
  const settings = await store.settings.get();
  const currency = settings.displayCurrency;
  const displayUsd = currency === "EUR" ? ((await fetchLatestEurUsd(net)) ?? 0) : 1;
  const toDisplay = displayUsd > 0 ? 1 / displayUsd : 1;

  return {
    currency,
    toDisplay,
    displayUsd,
    equityProvider: settings.equityProvider,
    equityApiKey: settings.equityApiKey,
  };
}
