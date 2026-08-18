import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fetchKlinesRange, fetchPrices } from "@/lib/binance";
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

  const holdings = computeHoldings(txs);
  const symbols = holdings.filter((h) => h.quantity > 0).map((h) => h.symbol);

  const [prices, candles] = await Promise.all([
    fetchPricesSafe(symbols),
    fetchDailyCandles(txs),
  ]);

  const valued = valueHoldings(holdings, prices);
  const series = portfolioValueSeries(txs, candles);

  const totals = {
    value: sum(valued.map((h) => h.value ?? 0)),
    costBasis: sum(valued.filter((h) => h.quantity > 0).map((h) => h.costBasis)),
    unrealizedPnl: sum(valued.map((h) => h.unrealizedPnl ?? 0)),
    realizedPnl: sum(valued.map((h) => h.realizedPnl)),
    fees: sum(valued.map((h) => h.fees)),
  };

  return NextResponse.json({ holdings: valued, totals, series });
}

/** Batch ticker lookup; one bad symbol 400s the whole batch, so fall back to per-symbol. */
async function fetchPricesSafe(symbols: string[]): Promise<Record<string, number>> {
  if (symbols.length === 0) return {};
  try {
    return await fetchPrices(symbols);
  } catch {
    const out: Record<string, number> = {};
    const results = await Promise.allSettled(symbols.map((s) => fetchPrices([s])));
    for (const r of results) {
      if (r.status === "fulfilled") Object.assign(out, r.value);
    }
    return out;
  }
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
