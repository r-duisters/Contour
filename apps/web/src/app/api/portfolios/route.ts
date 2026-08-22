import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deps } from "@/lib/deps";
import { createPortfolio, listPortfolios } from "@/data/services/portfolios";
import type { Portfolio } from "@/data/ports/store";

export const dynamic = "force-dynamic";

const Create = z.object({
  name: z.string().min(1).max(100),
});

function toJson(p: Portfolio) {
  return { id: p.id, name: p.name, createdAt: new Date(p.createdAt).toISOString() };
}

// POST's response has always included `updatedAt` (Prisma's `@updatedAt`,
// stamped at creation time), which the list response never did.
function toJsonWithUpdatedAt(p: Portfolio) {
  return { ...toJson(p), updatedAt: new Date(p.updatedAt).toISOString() };
}

export async function GET() {
  const { store } = deps();
  // `listPortfolios` returns the bare `Portfolio` the Store port defines — no
  // transaction count, since that isn't a stored field. `countByPortfolio` is
  // the one aggregate query this needs; fetching each portfolio in full just
  // to read `.transactions.length` would cost one round trip (and every row)
  // per portfolio instead of one query total.
  const [portfolios, counts] = await Promise.all([listPortfolios(store), store.transactions.countByPortfolio()]);
  const withCounts = portfolios.map((p) => ({ ...toJson(p), transactionCount: counts[p.id] ?? 0 }));
  return NextResponse.json({ portfolios: withCounts });
}

export async function POST(req: NextRequest) {
  const body = Create.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const { store } = deps();
  const created = await createPortfolio(store, body.data.name);
  return NextResponse.json({ portfolio: toJsonWithUpdatedAt(created) });
}
