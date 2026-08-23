/**
 * What an equity quote *is*, and the ticker facts that need no network.
 *
 * The three providers that produce these live in
 * `packages/data/src/sources/equity.ts`, against an injected `Net`; they import
 * this interface so the two cannot drift on the shape of a quote.
 */

/**
 * `instrumentType` is the provider's own word for what the security is —
 * Yahoo answers "EQUITY" or "ETF". It is grouping information only: nothing
 * writes it back, because `Transaction.assetType` describes how the app
 * prices a holding, not how a fund differs from a share.
 */
export type EquityQuote = {
  price: number; currency: string; prevClose?: number; name?: string;
  instrumentType?: string;
};

/** A source of stock/ETF prices. Symbols are exchange tickers (ASML.AS, AMD). */
export interface EquitySource {
  readonly name: string;
  quotes(symbols: string[]): Promise<Record<string, EquityQuote>>;
  /** Daily closes for a chart; empty when the source cannot serve history. */
  history?(symbol: string, range: string, interval?: string): Promise<{ t: number; c: number }[]>;
}

/** Exchange-suffix → trading currency, for sources that omit it. */
export function currencyForTicker(symbol: string): string {
  const suffix = symbol.includes(".") ? symbol.split(".").pop()!.toUpperCase() : "";
  const bySuffix: Record<string, string> = {
    AS: "EUR", PA: "EUR", DE: "EUR", F: "EUR", BR: "EUR", MI: "EUR", MC: "EUR", LS: "EUR", VI: "EUR",
    L: "GBP", SW: "CHF", ST: "SEK", OL: "NOK", CO: "DKK", TO: "CAD", AX: "AUD", T: "JPY", HK: "HKD",
  };
  return bySuffix[suffix] ?? "USD";
}

/** True for tickers that look like exchange-listed securities rather than coins. */
export function isEquityTicker(symbol: string): boolean {
  return /\.[A-Z]{1,4}$/.test(symbol.toUpperCase());
}
