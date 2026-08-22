import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { benchmark } from "@/data/services/series";
import { deps } from "@/lib/deps";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

const Query = z.object({
  key: z.enum(["sp500", "aex", "nasdaq", "world", "btc", "eth"]),
  from: z.coerce.number().int().positive(),
  barMs: z.coerce.number().int().positive().default(DAY_MS),
  /** When given, also simulate this portfolio's cash flows into the benchmark. */
  portfolioId: z.string().min(1).optional(),
  /** Value already held when the window opened, treated as a day-one buy. */
  opening: z.coerce.number().nonnegative().optional(),
});

export async function GET(req: NextRequest) {
  const q = Query.safeParse({
    key: req.nextUrl.searchParams.get("key"),
    from: req.nextUrl.searchParams.get("from"),
    barMs: req.nextUrl.searchParams.get("barMs") ?? DAY_MS,
    portfolioId: req.nextUrl.searchParams.get("portfolioId") ?? undefined,
    opening: req.nextUrl.searchParams.get("opening") ?? undefined,
  });
  if (!q.success) return NextResponse.json({ error: q.error.flatten() }, { status: 400 });

  const { store, net } = deps();
  return NextResponse.json(await benchmark(store, net, q.data));
}
