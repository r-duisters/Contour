import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fetchKlines, fetchKlinesRange } from "@/lib/binance";
import { makeEquitySource } from "@/lib/equity";
import { prisma } from "@/lib/db";
import {
  flowsByBar, indexSeries, moneyWeightedReturn, simulateFlowsInto,
} from "@/lib/performance";
import { fetchLatestEurUsd } from "@/lib/fx";
import { toDisplayTxs } from "@/lib/display-tx";
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
  /** When given, also simulate this portfolio's cash flows into the benchmark. */
  portfolioId: z.string().min(1).optional(),
  /** Value already held when the window opened, treated as a day-one buy. */
  opening: z.coerce.number().nonnegative().optional(),
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
    portfolioId: req.nextUrl.searchParams.get("portfolioId") ?? undefined,
    opening: req.nextUrl.searchParams.get("opening") ?? undefined,
  });
  if (!q.success) return NextResponse.json({ error: q.error.flatten() }, { status: 400 });
  const { key, from, barMs, portfolioId, opening } = q.data;
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

    const sameFlows = portfolioId
      ? await simulateSameFlows(portfolioId, bars, from, barMs, opening ?? 0)
      : null;

    return NextResponse.json({
      key,
      label: bench.label,
      points: indexSeries(bars),
      sameFlows,
    });
  } catch (e) {
    return NextResponse.json({ key, label: bench.label, points: [], error: (e as Error).message });
  }
}

/**
 * Put the portfolio's own cash flows into the benchmark on the same days.
 * This is the fair long-horizon comparison: an index quote assumes a lump sum
 * on day one, which nobody actually did.
 */
async function simulateSameFlows(
  portfolioId: string,
  bars: { t: number; c: number }[],
  from: number,
  barMs: number,
  opening: number,
): Promise<{ finalValue: number; annualPct: number | null; series: { t: number; value: number }[] } | null> {
  const portfolio = await prisma.portfolio.findUnique({
    where: { id: portfolioId },
    include: { transactions: true },
  });
  if (!portfolio || bars.length === 0) return null;

  const settings = await prisma.settings.findUnique({
    where: { id: 1 },
    select: { displayCurrency: true },
  });
  const currency = settings?.displayCurrency === "EUR" ? "EUR" : "USD";
  const displayUsd = currency === "EUR" ? ((await fetchLatestEurUsd()) ?? 0) : 1;
  const toDisplay = displayUsd > 0 ? 1 / displayUsd : 1;

  // Cash movements are not trades: buying euros is not investing them, and
  // counting a deposit as a benchmark purchase bought index units with money
  // that never left the bank.
  const txs = toDisplayTxs(
    portfolio.transactions.filter((t) => t.assetType !== "cash" && Number(t.time) >= from),
    currency,
    toDisplay,
  );

  const prices = new Map(bars.map((b) => [b.t, b.c]));
  const timeline = [...prices.keys()].sort((a, b) => a - b);
  if (timeline.length === 0) return null;

  // A window that opens mid-history starts with money already invested. Without
  // seeding it, the index is handed only the last year's deposits and compared
  // against a portfolio that had a decade's worth working for it.
  const flows = [
    ...(opening > 0 ? [{ t: timeline[0]!, amount: opening }] : []),
    ...[...flowsByBar(txs, barMs).entries()]
      .filter(([t]) => t > timeline[0]!)
      .map(([t, amount]) => ({ t, amount })),
  ];
  if (flows.length === 0) return null;
  const series = simulateFlowsInto(flows, prices, timeline);
  const finalValue = series[series.length - 1]?.value ?? 0;
  const annualPct = moneyWeightedReturn(flows, finalValue, timeline[timeline.length - 1] ?? Date.now());
  return { finalValue, annualPct, series };
}
