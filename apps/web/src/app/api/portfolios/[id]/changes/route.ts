import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { fetchKlines, fetchKlinesRange } from "@/lib/binance";
import { makeEquitySource } from "@/lib/equity";
import { cached } from "@/lib/cache";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

const Query = z.object({
  range: z.enum(["1d", "1w", "1m", "ytd", "1y", "2y", "5y", "all"]).default("1m"),
});

function windowStart(range: string, firstTx: number): number {
  const now = Date.now();
  switch (range) {
    case "1d": return now - DAY_MS;
    case "1w": return now - 7 * DAY_MS;
    case "1m": return now - 31 * DAY_MS;
    case "ytd": return Date.UTC(new Date(now).getUTCFullYear(), 0, 1);
    case "1y": return now - 365 * DAY_MS;
    case "2y": return now - 2 * 365 * DAY_MS;
    case "5y": return now - 5 * 365 * DAY_MS;
    default: return firstTx;
  }
}

/**
 * Price change per held asset over the selected period, so a holding row can
 * say how the asset itself moved. This is the asset's price return, not the
 * position's — buying more mid-period does not flatter it.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = Query.safeParse({ range: req.nextUrl.searchParams.get("range") ?? "1m" });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { range } = parsed.data;

  const portfolio = await prisma.portfolio.findUnique({
    where: { id },
    include: { transactions: { select: { symbol: true, assetType: true, time: true } } },
  });
  if (!portfolio) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (portfolio.transactions.length === 0) return NextResponse.json({ range, changes: {} });

  const firstTx = Math.min(...portfolio.transactions.map((t) => Number(t.time)));
  const from = windowStart(range, firstTx);
  const equity = new Set(
    portfolio.transactions.filter((t) => t.assetType === "equity").map((t) => t.symbol),
  );
  const symbols = [...new Set(portfolio.transactions.map((t) => t.symbol))];

  const settings = await prisma.settings.findUnique({
    where: { id: 1 },
    select: { equityProvider: true, equityApiKey: true },
  });
  const source = makeEquitySource(settings?.equityProvider, settings?.equityApiKey);
  const years = Math.max(1, Math.min(10, Math.ceil((Date.now() - from) / (365 * DAY_MS))));

  const results = await Promise.allSettled(
    symbols.map(async (symbol): Promise<[string, number] | null> => {
      const closes = await cached(
        `chg:${symbol}:${range}:${Math.floor(Date.now() / 900_000)}`,
        900_000,
        async (): Promise<number[]> => {
          if (equity.has(symbol)) {
            if (!source.history) return [];
            const rows = await source.history(
              symbol,
              range === "1d" ? "1d" : `${years}y`,
              range === "1d" ? "60m" : "1d",
            );
            return rows.filter((r) => r.t >= from).map((r) => r.c);
          }
          if (range === "1d") {
            const bars = await fetchKlines({ symbol, interval: "1h", limit: 25 });
            return bars.map((b) => b.c);
          }
          const bars = await fetchKlinesRange({ symbol, interval: "1d", from, to: Date.now() });
          return bars.map((b) => b.c);
        },
      );
      const first = closes.find((c) => c > 0);
      const last = closes[closes.length - 1];
      if (first === undefined || last === undefined || first <= 0) return null;
      return [symbol, ((last - first) / first) * 100];
    }),
  );

  const changes: Record<string, number> = {};
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) changes[r.value[0]] = r.value[1];
  }
  return NextResponse.json({ range, changes });
}
