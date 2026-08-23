import { currencyForTicker, type EquityQuote, type EquitySource } from "@/core/equity";
import type { Net } from "../ports/net";

/**
 * The three equity price providers, reached through an injected `Net`.
 *
 * The only copy: `packages/core/src/equity.ts`'s `fetch`-based classes were
 * deleted, and what remains there is the interface, the quote shape and
 * `currencyForTicker` — imported here rather than restated, so there is one
 * definition of what a quote *is*.
 */

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

type YahooChart = {
  chart?: {
    result?: {
      timestamp?: number[];
      indicators?: { quote?: { close?: (number | null)[] }[] };
      meta?: {
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        currency?: string;
        longName?: string;
        shortName?: string;
      };
    }[];
  };
};

/** Keyless. Covers Euronext/XETRA/US via exchange-suffixed tickers. */
class YahooSource implements EquitySource {
  readonly name = "yahoo";
  constructor(private readonly net: Net) {}

  async history(symbol: string, range = "1y", interval = "1d"): Promise<{ t: number; c: number }[]> {
    const data = await this.net.json<YahooChart>(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
        `?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`,
      { headers: YAHOO_HEADERS },
    );
    const r = data?.chart?.result?.[0];
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
          const res = await this.net.request(
            `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`,
            { headers: YAHOO_HEADERS },
          );
          if (!res.ok) return null;
          const meta = (await res.json<YahooChart>())?.chart?.result?.[0]?.meta;
          const price = meta?.regularMarketPrice;
          const prev = meta?.chartPreviousClose ?? meta?.previousClose;
          if (typeof price !== "number") return null;
          return [symbol, {
            price,
            currency: meta?.currency ?? "USD",
            prevClose: typeof prev === "number" ? prev : undefined,
            name: meta?.longName ?? meta?.shortName ?? undefined,
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
class TwelveDataSource implements EquitySource {
  readonly name = "twelvedata";
  constructor(private readonly net: Net, private readonly apiKey: string) {}

  async quotes(symbols: string[]): Promise<Record<string, EquityQuote>> {
    const out: Record<string, EquityQuote> = {};
    if (symbols.length === 0) return out;
    const url =
      `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbols.join(","))}` +
      `&apikey=${encodeURIComponent(this.apiKey)}`;
    const data = await this.net.json<Record<string, unknown>>(url);
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
class AlphaVantageSource implements EquitySource {
  readonly name = "alphavantage";
  constructor(private readonly net: Net, private readonly apiKey: string) {}

  async quotes(symbols: string[]): Promise<Record<string, EquityQuote>> {
    const out: Record<string, EquityQuote> = {};
    for (const symbol of symbols) {
      try {
        const res = await this.net.request(
          `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}` +
            `&apikey=${encodeURIComponent(this.apiKey)}`,
        );
        if (!res.ok) continue;
        const data = await res.json<{ "Global Quote"?: Record<string, string> }>();
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

export function makeEquitySource(
  net: Net,
  provider: string | null | undefined,
  apiKey: string | null | undefined,
): EquitySource {
  if (provider === "twelvedata" && apiKey) return new TwelveDataSource(net, apiKey);
  if (provider === "alphavantage" && apiKey) return new AlphaVantageSource(net, apiKey);
  return new YahooSource(net);
}
