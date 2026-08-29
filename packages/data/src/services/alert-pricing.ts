import { pricingPair } from "@/core/symbols";
import { isEquityTicker } from "@/core/equity";
import { fetchPricesSafe } from "../sources/binance";
import { makeEquitySource } from "../sources/equity";
import { fetchCrypto24hAgo } from "./pricing";
import type { Net } from "../ports/net";
import type { EquityQuote } from "@/core/equity";

/**
 * Pricing an alert's symbol through the venue that actually lists it.
 *
 * The evaluator priced everything through Binance, so an alert on `ASML.AS`
 * saved, listed, and never evaluated: `pricingPair` answers `ASML.ASUSDT`,
 * which is not a market, and `fetchPricesSafe` omits what it cannot price. No
 * error, no event, no sign — the alert simply never fired, which is the worst
 * shape a bug can take in a feature whose whole job is to tell you something.
 *
 * A service, not a server module. The alerts *routes* are server-only — Home
 * Assistant, web-push and FCM all need one — but pricing a symbol is neither
 * HTTP nor persistence, and the device evaluates its own alerts on every
 * foreground. Both callers hand it the same `Net`.
 */

export type AssetKind = "crypto" | "equity";

/** An alert's symbol together with how to price it. */
export type PricedSymbol = { symbol: string; assetType: AssetKind };

/**
 * What kind of thing this alert is about.
 *
 * The alert's own column decides. Sniffing the ticker cannot: `isEquityTicker`
 * looks for an exchange suffix, and AMD, NVDA and every other US listing have
 * none — so they would go to Binance as `AMDUSDT`, a symbol that may well
 * exist and answer with an unrelated token's price. Firing on the wrong number
 * is worse than not firing.
 *
 * The sniff survives only as a fallback for rows written before the column
 * existed, where a dotted ticker is the one case it gets right.
 */
export function assetTypeOf(alert: { assetType?: string | null; symbol?: string | null }): AssetKind {
  if (alert.assetType === "equity" || alert.assetType === "crypto") return alert.assetType;
  return alert.symbol && isEquityTicker(alert.symbol) ? "equity" : "crypto";
}

/** Split once, so each half is asked of its own venue in one request. */
function split(wanted: PricedSymbol[]): { crypto: string[]; equity: string[] } {
  const crypto = new Set<string>();
  const equity = new Set<string>();
  for (const w of wanted) (w.assetType === "equity" ? equity : crypto).add(w.symbol);
  return { crypto: [...crypto], equity: [...equity] };
}

export type Settings = {
  equityProvider?: string | null;
  equityApiKey?: string | null;
};

/**
 * The live price of each symbol, keyed by the symbol as it was asked for.
 *
 * Keyed by the *stored* symbol rather than the pair, because that is what the
 * caller holds and what a notification names. A symbol nothing can price is
 * absent rather than zero — the caller skips it, which is the same rule the
 * valuation follows.
 */
export async function priceSymbols(
  net: Net, settings: Settings, wanted: PricedSymbol[],
): Promise<Record<string, number>> {
  const { crypto, equity } = split(wanted);
  const out: Record<string, number> = {};

  const [coins, shares] = await Promise.all([
    crypto.length
      ? fetchPricesSafe(net, crypto.map(pricingPair)).catch((): Record<string, number> => ({}))
      : Promise.resolve<Record<string, number>>({}),
    equity.length
      ? makeEquitySource(net, settings.equityProvider, settings.equityApiKey)
          .quotes(equity).catch((): Record<string, EquityQuote> => ({}))
      : Promise.resolve<Record<string, EquityQuote>>({}),
  ]);

  for (const symbol of crypto) {
    const price = coins[pricingPair(symbol)];
    if (typeof price === "number") out[symbol] = price;
  }
  for (const symbol of equity) {
    const quote = shares[symbol];
    if (quote && Number.isFinite(quote.price)) out[symbol] = quote.price;
  }
  return out;
}

/**
 * What each symbol was worth a day ago, for the percentage rules.
 *
 * The two venues answer differently and the difference is not hidden. Binance
 * gives a *rolling* twenty-four hours, which is what the screens show and what
 * `fetchCrypto24hAgo` exists to keep in step. An equity provider gives the
 * previous *close*, because a stock market is shut overnight and there is no
 * such thing as its price twenty-four hours ago on a Sunday. A move measured
 * against the last close is the move a person means for a share.
 */
export async function baselines(
  net: Net, settings: Settings, wanted: PricedSymbol[],
): Promise<Record<string, number>> {
  const { crypto, equity } = split(wanted);
  const out: Record<string, number> = {};

  const [coins, shares] = await Promise.all([
    crypto.length
      ? fetchCrypto24hAgo(net, crypto.map(pricingPair)).catch((): Record<string, number> => ({}))
      : Promise.resolve<Record<string, number>>({}),
    equity.length
      ? makeEquitySource(net, settings.equityProvider, settings.equityApiKey)
          .quotes(equity).catch((): Record<string, EquityQuote> => ({}))
      : Promise.resolve<Record<string, EquityQuote>>({}),
  ]);

  for (const symbol of crypto) {
    const base = coins[pricingPair(symbol)];
    if (typeof base === "number" && base > 0) out[symbol] = base;
  }
  for (const symbol of equity) {
    const prev = shares[symbol]?.prevClose;
    if (typeof prev === "number" && prev > 0) out[symbol] = prev;
  }
  return out;
}
