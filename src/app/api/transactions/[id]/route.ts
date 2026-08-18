import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serializeTx, TxInput } from "../../portfolios/tx";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = TxInput.partial().safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const { time, symbol, ...rest } = body.data;
  const updated = await prisma.transaction.update({
    where: { id },
    data: {
      ...rest,
      ...(symbol !== undefined ? { symbol: symbol.toUpperCase() } : {}),
      ...(time !== undefined ? { time: BigInt(time) } : {}),
    },
  });
  return NextResponse.json({ transaction: serializeTx(updated) });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await prisma.transaction.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
