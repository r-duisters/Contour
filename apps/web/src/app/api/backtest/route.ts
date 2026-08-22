import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fetchKlinesRange } from "@/lib/binance";
import { run } from "@/lib/indicator";
import { simulate } from "@/lib/backtest";
import { prisma } from "@/lib/db";
import type { Timeframe } from "@/lib/types";

export const dynamic = "force-dynamic";

const Body = z.object({
  symbol: z.string().min(1),
  interval: z.string().min(1),
  from: z.number().int(),
  to: z.number().int(),
  params: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { symbol, interval, from, to, params } = parsed.data;

  const bars = await fetchKlinesRange({
    symbol, interval: interval as Timeframe, from, to,
  });
  const { signals, series } = run(bars, params ?? {});
  const stats = simulate(bars, signals);

  await prisma.backtestRun.create({
    data: {
      symbol, timeframe: interval,
      fromTime: BigInt(from), toTime: BigInt(to),
      params: JSON.stringify(params ?? {}),
      stats: JSON.stringify({
        totalReturnPct: stats.totalReturnPct,
        winRate: stats.winRate,
        maxDrawdownPct: stats.maxDrawdownPct,
        tradeCount: stats.trades.length,
      }),
    },
  });

  return NextResponse.json({
    bars, signals, series,
    stats: {
      ...stats,
      // keep response light — trim curve to <= 2000 points
      equityCurve: thinTo(stats.equityCurve, 2000),
    },
  });
}

function thinTo<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = Math.ceil(arr.length / max);
  return arr.filter((_, i) => i % step === 0);
}
