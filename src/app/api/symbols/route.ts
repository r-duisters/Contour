import { NextResponse } from "next/server";
import { fetchUsdtSymbols } from "@/lib/binance";

export const dynamic = "force-dynamic";

// exchangeInfo is ~2MB and changes rarely; cache the filtered list for an hour.
let cache: { symbols: string[]; at: number } | null = null;
const TTL_MS = 3_600_000;

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json({ symbols: cache.symbols });
  }
  try {
    const symbols = await fetchUsdtSymbols();
    cache = { symbols, at: Date.now() };
    return NextResponse.json({ symbols });
  } catch (e) {
    if (cache) return NextResponse.json({ symbols: cache.symbols });
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
