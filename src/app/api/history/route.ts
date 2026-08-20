import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { fetchKlines } from "@/lib/binance";
import { makeEquitySource } from "@/lib/equity";

export const dynamic = "force-dynamic";

const Query = z.object({
  symbol: z.string().min(1).max(30),
  assetType: z.enum(["crypto", "equity"]).default("crypto"),
});

/** Daily closes for one holding, for the detail chart. */
export async function GET(req: NextRequest) {
  const parsed = Query.safeParse({
    symbol: req.nextUrl.searchParams.get("symbol") ?? "",
    assetType: req.nextUrl.searchParams.get("assetType") ?? "crypto",
  });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { symbol, assetType } = parsed.data;

  try {
    if (assetType === "equity") {
      const settings = await prisma.settings.findUnique({
        where: { id: 1 },
        select: { equityProvider: true, equityApiKey: true },
      });
      const source = makeEquitySource(settings?.equityProvider, settings?.equityApiKey);
      const bars = source.history ? await source.history(symbol, "2y") : [];
      return NextResponse.json({ bars });
    }
    const klines = await fetchKlines({ symbol, interval: "1d", limit: 730 });
    return NextResponse.json({ bars: klines.map((b) => ({ t: b.t, c: b.c })) });
  } catch (e) {
    return NextResponse.json({ bars: [], error: (e as Error).message });
  }
}
