import { NextRequest, NextResponse } from "next/server";
import { getScript } from "@/lib/pinescript/library";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  try {
    return NextResponse.json({ name, source: await getScript(name) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
