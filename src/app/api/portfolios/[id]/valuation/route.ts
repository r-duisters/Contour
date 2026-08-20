import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fetchKlinesRange, fetchPricesSafe } from "@/lib/binance";
import { fetchLatestEurUsd, fetchEcbRates, rateOn } from "@/lib/fx";
import { makeEquitySource, type EquityQuote } from "@/lib/equity";
import {
  computeHoldings, portfolioValueSeries, valueHoldings, type Tx, type TxSide,
} from "@/lib/portfolio";
import type { Bar } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const portfolio = await prisma.portfolio.findUnique({
    where: { id },
    include: { transactions: true },
  });
  if (!portfolio) return NextResponse.json({ error: "not found" }, { status: 404 });

  const settingsRow0 = await prisma.settings.findUnique({
    where: { id: 1 },
    select: { displayCurrency: true, equityProvider: true, equityApiKey: true },
  });
  const currency = settingsRow0?.displayCurrency === "EUR" ? "EUR" : "USD";
  // USD per 1 unit of the display currency (1 for USD).
  const displayUsd = currency === "EUR" ? ((await fetchLatestEurUsd()) ?? 0) : 1;
  const toDisplay = displayUsd > 0 ? 1 / displayUsd : 1;

  /**
   * Everything is computed in the display currency. Trades settled in that
   * currency use the amount actually paid; the rest convert from USD at the
   * current rate. Re-converting a 2017 EUR purchase through today's USD rate
   * would misstate the cost basis, which is what this avoids.
   */
  const txs: Tx[] = portfolio.transactions.map((t) => {
    const native = t.nativeCurrency === currency && t.nativePrice !== null;
    return {
      symbol: t.symbol,
      side: t.side as TxSide,
      quantity: t.quantity,
      price: native ? t.nativePrice! : t.price * toDisplay,
      fee: native && t.nativeFee !== null ? t.nativeFee! : t.fee * toDisplay,
      time: Number(t.time),
    };
  });

  const equitySymbols = new Set(
    portfolio.transactions.filter((t) => t.assetType === "equity").map((t) => t.symbol),
  );
  const holdings = computeHoldings(txs);
  const held = holdings.filter((h) => h.quantity > 0).map((h) => h.symbol);
  const cryptoSymbols = held.filter((s) => !equitySymbols.has(s));
  const heldEquities = held.filter((s) => equitySymbols.has(s));

  const [cryptoPrices, equityPrices, candles] = await Promise.all([
    fetchPricesSafe(cryptoSymbols),
    fetchEquityPricesUsd(heldEquities, settingsRow0?.equityProvider, settingsRow0?.equityApiKey),
    fetchDailyCandles(txs.filter((t) => !equitySymbols.has(t.symbol))),
  ]);
  const prices: Record<string, number> = {};
  const prevCloses: Record<string, number> = {};
  for (const [sym, usd] of Object.entries(cryptoPrices)) prices[sym] = usd * toDisplay;
  for (const [sym, q] of Object.entries(equityPrices)) {
    prices[sym] = q.price * toDisplay;
    if (q.prevClose !== undefined) prevCloses[sym] = q.prevClose * toDisplay;
  }
  // Crypto previous close: the last fully closed daily candle.
  for (const [sym, bars] of Object.entries(candles)) {
    const closed = bars.filter((b) => b.t + 86_400_000 <= Date.now());
    const last = closed[closed.length - 1];
    if (last) prevCloses[sym] = last.c * toDisplay;
  }

  const valued = valueHoldings(holdings, prices).map((h) => {
    const prev = prevCloses[h.symbol];
    const dayChange = h.price !== null && prev !== undefined && prev > 0
      ? { abs: (h.price - prev) * h.quantity, pct: ((h.price - prev) / prev) * 100 }
      : null;
    return {
      ...h,
      assetType: equitySymbols.has(h.symbol) ? ("equity" as const) : ("crypto" as const),
      dayChange,
    };
  });
  const series = portfolioValueSeries(txs, candles).map((p) => ({
    t: p.t,
    value: p.value * toDisplay, // candles are USD closes
  }));

  // Day change covers only holdings with a previous close; its base is their
  // value alone, so the percentage is not diluted by unpriced assets.
  const withDay = valued.filter((h) => h.dayChange !== null && h.quantity > 0);
  const dayAbs = sum(withDay.map((h) => h.dayChange!.abs));
  const dayBase = sum(withDay.map((h) => (h.value ?? 0) - h.dayChange!.abs));

  const totals = {
    dayChange: withDay.length > 0
      ? { abs: dayAbs, pct: dayBase > 0 ? (dayAbs / dayBase) * 100 : 0, covered: withDay.length }
      : null,
    value: sum(valued.map((h) => h.value ?? 0)),
    costBasis: sum(valued.filter((h) => h.quantity > 0).map((h) => h.costBasis)),
    unrealizedPnl: sum(valued.map((h) => h.unrealizedPnl ?? 0)),
    realizedPnl: sum(valued.map((h) => h.realizedPnl)),
    fees: sum(valued.map((h) => h.fees)),
  };

  // Figures are already in the display currency; rate stays for compatibility.
  return NextResponse.json({
    holdings: valued, totals, series,
    currency: displayUsd > 0 ? currency : "USD",
    rate: 1,
  });
}

/** Live equity quotes converted to USD via current ECB rates. */
async function fetchEquityPricesUsd(
  symbols: string[],
  provider: string | null | undefined,
  apiKey: string | null | undefined,
): Promise<Record<string, { price: number; prevClose?: number }>> {
  if (symbols.length === 0) return {};
  const source = makeEquitySource(provider, apiKey);
  let quotes: Record<string, EquityQuote> = {};
  try {
    quotes = await source.quotes(symbols);
  } catch {
    return {};
  }
  const out: Record<string, { price: number; prevClose?: number }> = {};
  const fxCache = new Map<string, number | null>();
  for (const [symbol, q] of Object.entries(quotes)) {
    const cur = q.currency.toUpperCase();
    if (cur === "USD") { out[symbol] = { price: q.price, prevClose: q.prevClose }; continue; }
    // Some venues quote in minor units (GBp on LSE).
    const minor = cur === "GBP" && q.price > 1000 ? 100 : 1;
    const price = q.price / minor;
    if (!fxCache.has(cur)) {
      try {
        const rates = await fetchEcbRates(cur === "GBX" ? "GBP" : cur, "USD", Date.now() - 10 * 86_400_000, Date.now());
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
      };
    }
  }
  return out;
}

async function fetchDailyCandles(txs: Tx[]): Promise<Record<string, Bar[]>> {
  if (txs.length === 0) return {};
  const from = Math.min(...txs.map((t) => t.time));
  const symbols = [...new Set(txs.map((t) => t.symbol))];
  const results = await Promise.allSettled(
    symbols.map((s) => fetchKlinesRange({ symbol: s, interval: "1d", from, to: Date.now() })),
  );
  const out: Record<string, Bar[]> = {};
  results.forEach((r, i) => {
    if (r.status === "fulfilled") out[symbols[i]!] = r.value;
  });
  return out;
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
