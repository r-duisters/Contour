import { NextResponse } from "next/server";
import { deps } from "@/lib/deps";
import { getIndexDetail } from "@/data/services/markets";

export const dynamic = "force-dynamic";

// A wrapper. The slug is validated by the service, which owns the list of
// indices — a Zod enum here would be a second copy of it.
export async function GET(_req: Request, ctx: { params: Promise<{ index: string }> }) {
  const { index } = await ctx.params;
  const { net } = deps();
  try {
    const detail = await getIndexDetail(net, index);
    if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ index: detail });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
