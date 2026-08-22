import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deps } from "@/lib/deps";
import { createPortfolio, getPortfolio, listPortfolios } from "@/data/services/portfolios";

export const dynamic = "force-dynamic";

const Create = z.object({
  name: z.string().min(1).max(100),
});

export async function GET() {
  const { store } = deps();
  const portfolios = await listPortfolios(store);
  // `listPortfolios` returns the bare `Portfolio` the Store port defines — no
  // transaction count, since that isn't a stored field. The old single-query
  // `_count` this replaces is a Prisma-only trick anyway; a device build has
  // no equivalent, so the count is derived the same way `getPortfolio` already
  // exposes it, one portfolio at a time.
  const withCounts = await Promise.all(
    portfolios.map(async (p) => ({
      id: p.id,
      name: p.name,
      createdAt: new Date(p.createdAt).toISOString(),
      transactionCount: (await getPortfolio(store, p.id)).transactions.length,
    })),
  );
  return NextResponse.json({ portfolios: withCounts });
}

export async function POST(req: NextRequest) {
  const body = Create.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const { store } = deps();
  const created = await createPortfolio(store, body.data.name);
  return NextResponse.json({
    portfolio: { id: created.id, name: created.name, createdAt: new Date(created.createdAt).toISOString() },
  });
}
