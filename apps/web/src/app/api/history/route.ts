import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { history } from "@/data/services/series";
import { deps } from "@/lib/deps";

export const dynamic = "force-dynamic";

const Query = z.object({
  symbol: z.string().min(1).max(30),
  assetType: z.enum(["crypto", "equity"]).default("crypto"),
  range: z.enum(["1d", "1w", "1m", "ytd", "1y", "2y", "5y", "all"]).default("2y"),
});

export async function GET(req: NextRequest) {
  const parsed = Query.safeParse({
    symbol: req.nextUrl.searchParams.get("symbol") ?? "",
    assetType: req.nextUrl.searchParams.get("assetType") ?? "crypto",
    range: req.nextUrl.searchParams.get("range") ?? "2y",
  });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { symbol, assetType, range } = parsed.data;

  const { store, net } = deps();
  return NextResponse.json(await history(store, net, symbol, assetType, range));
}
