import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { fetchKlines, fetchKlinesRange } from "@/lib/binance";
import { makeEquitySource } from "@/lib/equity";
import { cached } from "@/lib/cache";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

const Query = z.object({
  symbol: z.string().min(1).max(30),
  assetType: z.enum(["crypto", "equity"]).default("crypto"),
  range: z.enum(["1d", "1w", "1m", "ytd", "1y", "2y", "5y", "all"]).default("2y"),
});

/** Window start, and how fine the bars should be inside it. */
function window_(range: string): { from: number; hourly: boolean } {
  const now = Date.now();
  switch (range) {
    case "1d": return { from: now - DAY_MS, hourly: true };
    case "1w": return { from: now - 7 * DAY_MS, hourly: true };
    case "1m": return { from: now - 31 * DAY_MS, hourly: false };
    case "ytd": return { from: Date.UTC(new Date(now).getUTCFullYear(), 0, 1), hourly: false };
    case "1y": return { from: now - 365 * DAY_MS, hourly: false };
    case "2y": return { from: now - 2 * 365 * DAY_MS, hourly: false };
    case "5y": return { from: now - 5 * 365 * DAY_MS, hourly: false };
    default: return { from: 0, hourly: false }; // everything the source will give
  }
}

/** Yahoo takes its own vocabulary for the same idea. */
function yahooRange(range: string): { range: string; interval: string } {
  switch (range) {
    case "1d": return { range: "1d", interval: "60m" };
    case "1w": return { range: "5d", interval: "60m" };
    case "1m": return { range: "1mo", interval: "1d" };
    case "ytd": return { range: "ytd", interval: "1d" };
    case "1y": return { range: "1y", interval: "1d" };
    case "2y": return { range: "2y", interval: "1d" };
    case "5y": return { range: "5y", interval: "1d" };
    default: return { range: "max", interval: "1wk" };
  }
}

/** Price history for one holding over the chosen period. */
export async function GET(req: NextRequest) {
  const parsed = Query.safeParse({
    symbol: req.nextUrl.searchParams.get("symbol") ?? "",
    assetType: req.nextUrl.searchParams.get("assetType") ?? "crypto",
    range: req.nextUrl.searchParams.get("range") ?? "2y",
  });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { symbol, assetType, range } = parsed.data;

  try {
    const bars = await cached(
      `hist:${symbol}:${assetType}:${range}:${Math.floor(Date.now() / 900_000)}`,
      900_000,
      async (): Promise<{ t: number; c: number }[]> => {
        if (assetType === "equity") {
          const settings = await prisma.settings.findUnique({
            where: { id: 1 },
            select: { equityProvider: true, equityApiKey: true },
          });
          const source = makeEquitySource(settings?.equityProvider, settings?.equityApiKey);
          if (!source.history) return [];
          const y = yahooRange(range);
          return source.history(symbol, y.range, y.interval);
        }

        const { from, hourly } = window_(range);
        if (hourly) {
          const limit = range === "1d" ? 25 : 168;
          const raw = await fetchKlines({ symbol, interval: "1h", limit });
          return raw.map((b) => ({ t: b.t, c: b.c }));
        }
        // Daily bars: one page is enough for a year, longer windows paginate.
        if (from === 0 || Date.now() - from > 1000 * DAY_MS) {
          const raw = await fetchKlinesRange({
            symbol, interval: "1d", from: from || Date.parse("2017-01-01"), to: Date.now(),
          });
          return raw.map((b) => ({ t: b.t, c: b.c }));
        }
        const days = Math.ceil((Date.now() - from) / DAY_MS) + 1;
        const raw = await fetchKlines({ symbol, interval: "1d", limit: Math.min(1000, days) });
        return raw.filter((b) => b.t >= from).map((b) => ({ t: b.t, c: b.c }));
      },
    );

    const first = bars.find((b) => b.c > 0)?.c;
    const last = bars[bars.length - 1]?.c;
    const changePct = first && last ? ((last - first) / first) * 100 : null;
    return NextResponse.json({ bars, range, changePct });
  } catch (e) {
    return NextResponse.json({ bars: [], range, changePct: null, error: (e as Error).message });
  }
}
