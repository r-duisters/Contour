import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fetchKlinesRange } from "@/lib/binance";
import { fetchEcbRates, fetchLatestEurUsd, rateOn } from "@/lib/fx";
import { currencyForTicker, makeEquitySource } from "@/lib/equity";
import { portfolioValueSeries, type Tx, type TxSide } from "@/lib/portfolio";
import { cached } from "@/lib/cache";
import type { Bar } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Portfolio value over time. Split out of /valuation because it needs full
 * price history for every asset ever held — seconds of work that must not
 * delay the headline figures.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const portfolio = await prisma.portfolio.findUnique({
    where: { id },
    include: { transactions: true },
  });
  if (!portfolio) return NextResponse.json({ error: "not found" }, { status: 404 });

  const settings = await prisma.settings.findUnique({
    where: { id: 1 },
    select: { displayCurrency: true, equityProvider: true, equityApiKey: true },
  });
  const currency = settings?.displayCurrency === "EUR" ? "EUR" : "USD";
  const displayUsd = currency === "EUR" ? ((await fetchLatestEurUsd()) ?? 0) : 1;
  const toDisplay = displayUsd > 0 ? 1 / displayUsd : 1;

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
  if (txs.length === 0) return NextResponse.json({ series: [], currency });

  const equitySymbols = new Set(
    portfolio.transactions.filter((t) => t.assetType === "equity").map((t) => t.symbol),
  );
  const from = Math.min(...txs.map((t) => t.time));
  const symbols = [...new Set(txs.map((t) => t.symbol))];

  // Equity closes arrive in the venue's own currency; convert each day with
  // the ECB rate for that day so the history is not skewed by today's FX.
  const source = makeEquitySource(settings?.equityProvider, settings?.equityApiKey);
  const fxByCurrency = new Map<string, Map<number, number>>();
  for (const s of symbols) {
    if (!equitySymbols.has(s)) continue;
    const cur = currencyForTicker(s);
    if (cur === "USD" || fxByCurrency.has(cur)) continue;
    try {
      fxByCurrency.set(cur, await fetchEcbRates(cur, "USD", from, Date.now()));
    } catch {
      fxByCurrency.set(cur, new Map());
    }
  }

  const histories = await Promise.allSettled(
    symbols.map(async (s): Promise<Bar[]> => {
      if (!equitySymbols.has(s)) {
        return fetchKlinesRange({ symbol: s, interval: "1d", from, to: Date.now() });
      }
      const rows = await cached(
        `eqhist:${s}:${Math.floor(Date.now() / 3_600_000)}`,
        3_600_000,
        async () => (source.history ? await source.history(s, "10y") : []),
      );
      const cur = currencyForTicker(s);
      const fx = fxByCurrency.get(cur);
      return rows.flatMap((r) => {
        const usd = cur === "USD" ? r.c : (() => {
          const rate = fx ? rateOn(fx, r.t) : null;
          return rate === null ? null : r.c * rate;
        })();
        if (usd === null) return [];
        // Normalise to the UTC day so equity and crypto bars line up.
        const day = Math.floor(r.t / 86_400_000) * 86_400_000;
        return [{ t: day, o: usd, h: usd, l: usd, c: usd, v: 0 }];
      });
    }),
  );

  const candles: Record<string, Bar[]> = {};
  histories.forEach((r, i) => {
    if (r.status === "fulfilled") candles[symbols[i]!] = r.value;
  });

  const series = portfolioValueSeries(txs, candles).map((p) => ({
    t: p.t,
    value: p.value * toDisplay,
  }));
  return NextResponse.json({ series, currency });
}
