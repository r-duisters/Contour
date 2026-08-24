import { NextResponse } from "next/server";
import { deps } from "@/lib/deps";
import { fetchQuotesFor } from "@/data/sources/binance";

export const dynamic = "force-dynamic";

/** Which currencies a coin's price can be quoted in, for the transaction form. */
export async function GET(_req: Request, ctx: { params: Promise<{ asset: string }> }) {
  const { asset } = await ctx.params;
  const { net } = deps();
  return NextResponse.json({ quotes: await fetchQuotesFor(net, decodeURIComponent(asset)) });
}
