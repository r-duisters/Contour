import { NextResponse } from "next/server";
import { z } from "zod";
import { deps } from "@/lib/deps";
import { getMarkets } from "@/data/services/markets";

export const dynamic = "force-dynamic";

// Caching and shaping both live in the service and the sources beneath it, so
// this handler is the wrapper it is meant to be: read the category, call,
// respond.
const Category = z.enum(["crypto", "stocks"]).catch("crypto");

export async function GET(req: Request) {
  const { net } = deps();
  const category = Category.parse(new URL(req.url).searchParams.get("category") ?? undefined);
  try {
    return NextResponse.json({ board: await getMarkets(net, category) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
