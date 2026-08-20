export type EquityQuote = { price: number; currency: string };

/** A source of stock/ETF prices. Symbols are exchange tickers (ASML.AS, AMD). */
export interface EquitySource {
  readonly name: string;
  quotes(symbols: string[]): Promise<Record<string, EquityQuote>>;
}

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** Keyless, but Yahoo rate-limits datacenter and many residential IPs (HTTP 429). */
export class YahooSource implements EquitySource {
  readonly name = "yahoo";
  async quotes(symbols: string[]): Promise<Record<string, EquityQuote>> {
    const out: Record<string, EquityQuote> = {};
    for (const symbol of symbols) {
      try {
        const res = await fetch(
          `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`,
          { headers: { "User-Agent": UA, Accept: "application/json" } },
        );
        if (!res.ok) continue;
        const meta = (await res.json())?.chart?.result?.[0]?.meta;
        const price = meta?.regularMarketPrice;
        if (typeof price === "number") out[symbol] = { price, currency: meta.currency ?? "USD" };
      } catch {
        // try the next symbol
      }
    }
    return out;
  }
}

/** Free tier: 800 requests/day, 8/minute. Covers Euronext/XETRA. */
export class TwelveDataSource implements EquitySource {
  readonly name = "twelvedata";
  constructor(private readonly apiKey: string) {}
  async quotes(symbols: string[]): Promise<Record<string, EquityQuote>> {
    const out: Record<string, EquityQuote> = {};
    if (symbols.length === 0) return out;
    const url =
      `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbols.join(","))}` +
      `&apikey=${encodeURIComponent(this.apiKey)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`twelvedata ${res.status}`);
    const data = (await res.json()) as Record<string, unknown>;
    // One symbol returns a bare object; several return a map keyed by symbol.
    const entries = symbols.length === 1 ? [[symbols[0]!, data] as const] : Object.entries(data);
    for (const [symbol, raw] of entries) {
      const q = raw as { close?: string; currency?: string; code?: number };
      const price = Number(q?.close);
      if (Number.isFinite(price) && price > 0) {
        out[symbol] = { price, currency: (q.currency ?? "USD").toUpperCase() };
      }
    }
    return out;
  }
}

/** Free tier: 25 requests/day — enough for a handful of holdings, one call each. */
export class AlphaVantageSource implements EquitySource {
  readonly name = "alphavantage";
  constructor(private readonly apiKey: string) {}
  async quotes(symbols: string[]): Promise<Record<string, EquityQuote>> {
    const out: Record<string, EquityQuote> = {};
    for (const symbol of symbols) {
      try {
        const res = await fetch(
          `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}` +
            `&apikey=${encodeURIComponent(this.apiKey)}`,
        );
        if (!res.ok) continue;
        const data = (await res.json()) as { "Global Quote"?: Record<string, string> };
        const price = Number(data["Global Quote"]?.["05. price"]);
        // Alpha Vantage does not report the currency; infer from the suffix.
        if (Number.isFinite(price) && price > 0) {
          out[symbol] = { price, currency: currencyForTicker(symbol) };
        }
      } catch {
        // try the next symbol
      }
    }
    return out;
  }
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

export function makeEquitySource(
  provider: string | null | undefined,
  apiKey: string | null | undefined,
): EquitySource {
  if (provider === "twelvedata" && apiKey) return new TwelveDataSource(apiKey);
  if (provider === "alphavantage" && apiKey) return new AlphaVantageSource(apiKey);
  return new YahooSource();
}
