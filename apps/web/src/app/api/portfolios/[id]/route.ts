import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deps } from "@/lib/deps";
import { NotFoundError } from "@/data/errors";
import { deletePortfolio, getPortfolio, renamePortfolio } from "@/data/services/portfolios";
import { serializeTx } from "../tx";

export const dynamic = "force-dynamic";

const Patch = z.object({
  name: z.string().min(1).max(100),
});

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { store } = deps();
  let portfolio;
  try {
    portfolio = await getPortfolio(store, id);
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: "not found" }, { status: 404 });
    throw err;
  }
  // `getPortfolio` hands back transactions oldest-first (the Store contract's
  // order, shared with every consumer of `store.portfolios.get`). This route
  // has always returned newest-first (`orderBy: { time: "desc" }`), so that
  // reshaping happens here rather than in the service, which has no route to
  // please and no business picking a display order.
  const newestFirst = [...portfolio.transactions].sort((a, b) => b.time - a.time);
  return NextResponse.json({
    portfolio: {
      id: portfolio.id,
      name: portfolio.name,
      createdAt: new Date(portfolio.createdAt).toISOString(),
      transactions: newestFirst.map(serializeTx),
    },
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = Patch.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const { store } = deps();
  // No existence check here, same as the Prisma `update` this replaces: an
  // unknown id throws uncaught and Next turns that into a 500. See
  // store-contract.ts's note on `rename` for why that stays unmapped.
  const updated = await renamePortfolio(store, id, body.data.name);
  return NextResponse.json({
    portfolio: { id: updated.id, name: updated.name, createdAt: new Date(updated.createdAt).toISOString() },
  });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { store } = deps();
  // Same as PATCH above: an unknown id throws uncaught, same as the Prisma
  // `delete` this replaces, and Next turns that into a 500.
  await deletePortfolio(store, id);
  return NextResponse.json({ ok: true });
}
