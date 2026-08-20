export type EquityQuote = { price: number; currency: string; prevClose?: number };

/** A source of stock/ETF prices. Symbols are exchange tickers (ASML.AS, AMD). */
export interface EquitySource {
  readonly name: string;
  quotes(symbols: string[]): Promise<Record<string, EquityQuote>>;
  /** Daily closes for a chart; empty when the source cannot serve history. */
  history?(symbol: string, range: string, interval?: string): Promise<{ t: number; c: number }[]>;
}

/**
 * Yahoo's chart API answers 429 to bare requests; it needs the header set a
 * browser XHR sends (Referer/Origin/sec-fetch), not just a User-Agent.
 */
const YAHOO_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://finance.yahoo.com/",
  Origin: "https://finance.yahoo.com",
  "sec-fetch-site": "same-site",
  "sec-fetch-mode": "cors",
};

/** Keyless. Covers Euronext/XETRA/US via exchange-suffixed tickers. */
export class YahooSource implements EquitySource {
  readonly name = "yahoo";
  async history(symbol: string, range = "1y", interval = "1d"): Promise<{ t: number; c: number }[]> {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
        `?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`,
      { headers: YAHOO_HEADERS },
    );
    if (!res.ok) throw new Error(`yahoo history ${res.status}`);
    const r = (await res.json())?.chart?.result?.[0];
    const stamps: number[] = r?.timestamp ?? [];
    const closes: (number | null)[] = r?.indicators?.quote?.[0]?.close ?? [];
    const out: { t: number; c: number }[] = [];
    stamps.forEach((sec, i) => {
      const c = closes[i];
      if (typeof c === "number") out.push({ t: sec * 1000, c });
    });
    return out;
  }

  async quotes(symbols: string[]): Promise<Record<string, EquityQuote>> {
    const results = await Promise.all(
      symbols.map(async (symbol): Promise<[string, EquityQuote] | null> => {
        try {
          const res = await fetch(
            `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`,
            { headers: YAHOO_HEADERS },
          );
          if (!res.ok) return null;
          const meta = (await res.json())?.chart?.result?.[0]?.meta;
          const price = meta?.regularMarketPrice;
          const prev = meta?.chartPreviousClose ?? meta?.previousClose;
          if (typeof price !== "number") return null;
          return [symbol, {
            price,
            currency: meta.currency ?? "USD",
            prevClose: typeof prev === "number" ? prev : undefined,
          }];
        } catch {
          return null;
        }
      }),
    );
    return Object.fromEntries(results.filter((r): r is [string, EquityQuote] => r !== null));
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
      const q = raw as { close?: string; currency?: string; previous_close?: string };
      const price = Number(q?.close);
      const prev = Number(q?.previous_close);
      if (Number.isFinite(price) && price > 0) {
        out[symbol] = {
          price,
          currency: (q.currency ?? "USD").toUpperCase(),
          prevClose: Number.isFinite(prev) && prev > 0 ? prev : undefined,
        };
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
        const prev = Number(data["Global Quote"]?.["08. previous close"]);
        // Alpha Vantage does not report the currency; infer from the suffix.
        if (Number.isFinite(price) && price > 0) {
          out[symbol] = {
            price,
            currency: currencyForTicker(symbol),
            prevClose: Number.isFinite(prev) && prev > 0 ? prev : undefined,
          };
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
