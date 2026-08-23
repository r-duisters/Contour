import { NextRequest, NextResponse } from "next/server";
import { deps } from "@/lib/deps";
import { NotFoundError } from "@/data/errors";
import { insights } from "@/data/services/valuation";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { store, net } = deps();
  try {
    return NextResponse.json(await insights(store, net, id));
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: "not found" }, { status: 404 });
    throw err;
  }
}
