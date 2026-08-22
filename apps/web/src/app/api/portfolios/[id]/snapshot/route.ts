import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deps } from "@/lib/deps";
import { NotFoundError } from "@/data/errors";
import { snapshot } from "@/data/services/valuation";

export const dynamic = "force-dynamic";

const Query = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = Query.safeParse({ date: req.nextUrl.searchParams.get("date") ?? "" });
  if (!parsed.success) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }
  // The regex admits "2026-13-45"; only Date.parse can reject that, and the
  // two failures have always had different messages.
  if (!Number.isFinite(Date.parse(`${parsed.data.date}T00:00:00Z`))) {
    return NextResponse.json({ error: "unparseable date" }, { status: 400 });
  }

  const { store, net } = deps();
  try {
    return NextResponse.json(await snapshot(store, net, id, parsed.data.date));
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: "not found" }, { status: 404 });
    throw err;
  }
}
