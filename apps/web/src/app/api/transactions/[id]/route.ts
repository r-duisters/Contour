import { NextRequest, NextResponse } from "next/server";
import { deps } from "@/lib/deps";
import { deleteTransaction, updateTransaction } from "@/data/services/transactions";
import { serializeTx, TxPatch } from "../../portfolios/tx";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = TxPatch.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const { time, symbol, ...rest } = body.data;
  const { store } = deps();
  // No existence check here, same as the Prisma `update` this replaces: an
  // unknown id throws uncaught and Next turns that into a 500. See
  // store-contract.ts's note on `update` for why that stays unmapped.
  const updated = await updateTransaction(store, id, {
    ...rest,
    ...(symbol !== undefined ? { symbol: symbol.toUpperCase() } : {}),
    ...(time !== undefined ? { time } : {}),
  });
  return NextResponse.json({ transaction: serializeTx(updated) });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { store } = deps();
  // Same as PATCH above: an unknown id throws uncaught, same as the Prisma
  // `delete` this replaces, and Next turns that into a 500.
  await deleteTransaction(store, id);
  return NextResponse.json({ ok: true });
}
