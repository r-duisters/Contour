import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fetchKlines, fetchKlinesRange } from "@/lib/binance";
import { makeEquitySource } from "@/lib/equity";
import { prisma } from "@/lib/db";
import { indexSeries } from "@/lib/performance";
import { cached } from "@/lib/cache";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

/** What a portfolio can be measured against. */
export const BENCHMARKS = {
  sp500: { label: "S&P 500", symbol: "^GSPC", kind: "equity" },
  aex: { label: "AEX", symbol: "^AEX", kind: "equity" },
  nasdaq: { label: "Nasdaq 100", symbol: "^NDX", kind: "equity" },
  world: { label: "MSCI World (IWDA)", symbol: "IWDA.AS", kind: "equity" },
  btc: { label: "Bitcoin", symbol: "BTCUSDT", kind: "crypto" },
  eth: { label: "Ethereum", symbol: "ETHUSDT", kind: "crypto" },
} as const;

const Query = z.object({
  key: z.enum(["sp500", "aex", "nasdaq", "world", "btc", "eth"]),
  from: z.coerce.number().int().positive(),
  barMs: z.coerce.number().int().positive().default(DAY_MS),
});

/**
 * A benchmark rebased to 100 at the start of the window, so it can be drawn
 * against a portfolio's time-weighted return index.
 */
export async function GET(req: NextRequest) {
  const q = Query.safeParse({
    key: req.nextUrl.searchParams.get("key"),
    from: req.nextUrl.searchParams.get("from"),
    barMs: req.nextUrl.searchParams.get("barMs") ?? DAY_MS,
  });
  if (!q.success) return NextResponse.json({ error: q.error.flatten() }, { status: 400 });
  const { key, from, barMs } = q.data;
  const bench = BENCHMARKS[key];

  try {
    const bars = await cached(
      `bench:${key}:${from}:${barMs}:${Math.floor(Date.now() / 900_000)}`,
      900_000,
      async () => {
        if (bench.kind === "crypto") {
          const raw = barMs === DAY_MS
            ? await fetchKlinesRange({ symbol: bench.symbol, interval: "1d", from, to: Date.now() })
            : await fetchKlines({ symbol: bench.symbol, interval: "1h", limit: 26 });
          return raw.map((b) => ({ t: Math.floor(b.t / barMs) * barMs, c: b.c }));
        }
        const settings = await prisma.settings.findUnique({
          where: { id: 1 },
          select: { equityProvider: true, equityApiKey: true },
        });
        const source = makeEquitySource(settings?.equityProvider, settings?.equityApiKey);
        if (!source.history) return [];
        const years = Math.ceil((Date.now() - from) / (365 * DAY_MS));
        const range = barMs === DAY_MS ? `${Math.max(1, Math.min(10, years))}y` : "1d";
        const rows = await source.history(bench.symbol, range, barMs === DAY_MS ? "1d" : "60m");
        return rows
          .filter((r) => r.t >= from)
          .map((r) => ({ t: Math.floor(r.t / barMs) * barMs, c: r.c }));
      },
    );

    return NextResponse.json({
      key,
      label: bench.label,
      points: indexSeries(bars),
    });
  } catch (e) {
    return NextResponse.json({ key, label: bench.label, points: [], error: (e as Error).message });
  }
}
