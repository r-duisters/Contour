import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fetchKlinesRange, fetchPricesSafe } from "@/lib/binance";
import { fetchLatestEurUsd, fetchEcbRates, rateOn } from "@/lib/fx";
import { makeEquitySource } from "@/lib/equity";
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

  const txs: Tx[] = portfolio.transactions.map((t) => ({
    symbol: t.symbol,
    side: t.side as TxSide,
    quantity: t.quantity,
    price: t.price,
    fee: t.fee,
    time: Number(t.time),
  }));

  const equitySymbols = new Set(
    portfolio.transactions.filter((t) => t.assetType === "equity").map((t) => t.symbol),
  );
  const holdings = computeHoldings(txs);
  const held = holdings.filter((h) => h.quantity > 0).map((h) => h.symbol);
  const cryptoSymbols = held.filter((s) => !equitySymbols.has(s));
  const heldEquities = held.filter((s) => equitySymbols.has(s));

  const settingsRow = await prisma.settings.findUnique({
    where: { id: 1 },
    select: { displayCurrency: true, equityProvider: true, equityApiKey: true },
  });

  const [cryptoPrices, equityPrices, candles] = await Promise.all([
    fetchPricesSafe(cryptoSymbols),
    fetchEquityPricesUsd(heldEquities, settingsRow?.equityProvider, settingsRow?.equityApiKey),
    fetchDailyCandles(txs.filter((t) => !equitySymbols.has(t.symbol))),
  ]);
  const prices = { ...cryptoPrices, ...equityPrices };

  const valued = valueHoldings(holdings, prices);
  const series = portfolioValueSeries(txs, candles);

  const totals = {
    value: sum(valued.map((h) => h.value ?? 0)),
    costBasis: sum(valued.filter((h) => h.quantity > 0).map((h) => h.costBasis)),
    unrealizedPnl: sum(valued.map((h) => h.unrealizedPnl ?? 0)),
    realizedPnl: sum(valued.map((h) => h.realizedPnl)),
    fees: sum(valued.map((h) => h.fees)),
  };

  // Display currency: values stay in USD internally; the client multiplies
  // by this rate. EUR uses the live ECB reference rate.
  const currency = settingsRow?.displayCurrency === "EUR" ? "EUR" : "USD";
  let rate = 1;
  if (currency === "EUR") {
    const eurUsd = await fetchLatestEurUsd();
    if (eurUsd && eurUsd > 0) rate = 1 / eurUsd;
    else return NextResponse.json({ holdings: valued, totals, series, currency: "USD", rate: 1 });
  }

  return NextResponse.json({ holdings: valued, totals, series, currency, rate });
}

/** Live equity quotes converted to USD via current ECB rates. */
async function fetchEquityPricesUsd(
  symbols: string[],
  provider: string | null | undefined,
  apiKey: string | null | undefined,
): Promise<Record<string, number>> {
  if (symbols.length === 0) return {};
  const source = makeEquitySource(provider, apiKey);
  let quotes: Record<string, { price: number; currency: string }> = {};
  try {
    quotes = await source.quotes(symbols);
  } catch {
    return {};
  }
  const out: Record<string, number> = {};
  const fxCache = new Map<string, number | null>();
  for (const [symbol, q] of Object.entries(quotes)) {
    const cur = q.currency.toUpperCase();
    if (cur === "USD") { out[symbol] = q.price; continue; }
    // Some venues quote in minor units (GBp on LSE).
    const price = cur === "GBP" && q.price > 1000 ? q.price / 100 : q.price;
    if (!fxCache.has(cur)) {
      try {
        const rates = await fetchEcbRates(cur === "GBX" ? "GBP" : cur, "USD", Date.now() - 10 * 86_400_000, Date.now());
        fxCache.set(cur, rateOn(rates, Date.now()));
      } catch {
        fxCache.set(cur, null);
      }
    }
    const rate = fxCache.get(cur);
    if (rate) out[symbol] = price * rate;
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
