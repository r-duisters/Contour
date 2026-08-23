import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fetchKlines } from "@/data/sources/binance";
import { deps } from "@/lib/deps";
import { run } from "@/lib/indicator";
import { cached } from "@/lib/cache";

export const dynamic = "force-dynamic";

const Query = z.object({ symbol: z.string().min(1).max(20).default("BTCUSDT") });

// The indicator needs 1460 daily bars to warm up; Binance caps a page at 1000.
async function warmBars(symbol: string) {
  const { net } = deps();
  const recent = await fetchKlines(net, { symbol, interval: "1d", limit: 1000 });
  if (recent.length === 0) return [];
  const older = await fetchKlines(net, {
    symbol, interval: "1d", limit: 1000, endTime: recent[0]!.t - 1,
  }).catch(() => []);
  return [...older, ...recent];
}

/** Latest risk-metric reading, for the portfolio page chip. */
export async function GET(req: NextRequest) {
  const parsed = Query.safeParse({ symbol: req.nextUrl.searchParams.get("symbol") ?? "BTCUSDT" });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { symbol } = parsed.data;
  try {
    // Daily indicator: recomputing more than a few times an hour is wasted work.
    return NextResponse.json(
      await cached(`risk:${symbol}:${Math.floor(Date.now() / 900_000)}`, 900_000, () =>
        computeRisk(symbol),
      ),
    );
  } catch (e) {
    return NextResponse.json({ symbol, risk: null, zone: null, error: (e as Error).message });
  }
}

async function computeRisk(symbol: string) {
  const bars = await warmBars(symbol);
  const { series } = run(bars.slice(0, -1)); // drop the in-progress bar
  for (let i = series.riskMetric.length - 1; i >= 0; i--) {
    const risk = series.riskMetric[i];
    if (Number.isFinite(risk)) {
      const zone = risk! < 0.3 ? "buy" : risk! > 0.8 ? "sell" : "hold";
      return { symbol, risk, zone };
    }
  }
  return { symbol, risk: null, zone: null };
}
