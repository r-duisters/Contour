import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { NotFoundError } from "@/data/errors";
import { changes } from "@/data/services/series";
import { deps } from "@/lib/deps";

export const dynamic = "force-dynamic";

const Query = z.object({
  range: z.enum(["1d", "1w", "1m", "ytd", "1y", "2y", "5y", "all"]).default("1m"),
});

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = Query.safeParse({ range: req.nextUrl.searchParams.get("range") ?? "1m" });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { store, net } = deps();
  try {
    return NextResponse.json(await changes(store, net, id, parsed.data.range));
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: "not found" }, { status: 404 });
    throw err;
  }
}
