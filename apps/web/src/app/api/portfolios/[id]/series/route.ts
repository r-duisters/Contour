import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { RANGE_KEYS, type RangeKey } from "@/core/ranges";
import { NotFoundError } from "@/data/errors";
import { series } from "@/data/services/series";
import { deps } from "@/lib/deps";

export const dynamic = "force-dynamic";

const Query = z.object({
  range: z.enum(RANGE_KEYS as [RangeKey, ...RangeKey[]]).default("all"),
});

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = Query.safeParse({ range: req.nextUrl.searchParams.get("range") ?? "all" });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { store, net } = deps();
  try {
    return NextResponse.json(await series(store, net, id, parsed.data.range));
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: "not found" }, { status: 404 });
    throw err;
  }
}
