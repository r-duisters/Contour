import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { searchAssets } from "@/data/services/lookup";
import { deps } from "@/lib/deps";

export const dynamic = "force-dynamic";

const Query = z.object({ q: z.string().min(1).max(64) });

export async function GET(req: NextRequest) {
  const parsed = Query.safeParse({ q: req.nextUrl.searchParams.get("q") ?? "" });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { net } = deps();
  // The array itself, not an envelope: the client hands it straight to a list,
  // and `listSymbols` next door only has one because it predates that habit.
  return NextResponse.json(await searchAssets(net, parsed.data.q));
}
