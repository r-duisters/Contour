import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assetInfo } from "@/lib/asset-info";

export const dynamic = "force-dynamic";

const Query = z.object({
  symbol: z.string().min(1).max(30).regex(/^[A-Za-z0-9.^_-]+$/),
  assetType: z.enum(["crypto", "equity"]).default("crypto"),
});

/**
 * Background, sentiment and headlines for one holding. Separate from the
 * valuation call because none of it is needed to answer "what is it worth",
 * and every source here is someone else's server.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol: rawSymbol } = await ctx.params;
  const parsed = Query.safeParse({
    symbol: decodeURIComponent(rawSymbol),
    assetType: req.nextUrl.searchParams.get("assetType") ?? "crypto",
  });
  if (!parsed.success) return NextResponse.json({ error: "bad symbol" }, { status: 400 });
  const { symbol, assetType } = parsed.data;

  try {
    return NextResponse.json(await assetInfo(symbol.toUpperCase(), assetType));
  } catch {
    // A background panel is never worth failing the page over.
    return NextResponse.json({
      symbol, about: null, tags: [], stats: [], sentiment: null, news: [], sources: [],
      unavailable: true,
    });
  }
}
