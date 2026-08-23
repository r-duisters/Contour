import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fetchKlines } from "@/data/sources/binance";
import { deps } from "@/lib/deps";
import type { Timeframe } from "@/lib/types";

export const dynamic = "force-dynamic";

const Query = z.object({
  symbol: z.string().min(1),
  interval: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  endTime: z.coerce.number().int().optional(),
  startTime: z.coerce.number().int().optional(),
});

export async function GET(req: NextRequest) {
  const parsed = Query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { symbol, interval, limit, endTime, startTime } = parsed.data;
  try {
    const bars = await fetchKlines(deps().net, { symbol, interval: interval as Timeframe, limit, endTime, startTime });
    return NextResponse.json({ bars });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
