import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serializeTx, TxInput } from "../../tx";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = TxInput.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const portfolio = await prisma.portfolio.findUnique({ where: { id } });
  if (!portfolio) return NextResponse.json({ error: "not found" }, { status: 404 });

  const created = await prisma.transaction.create({
    data: {
      portfolioId: id,
      symbol: body.data.symbol.toUpperCase(),
      side: body.data.side,
      quantity: body.data.quantity,
      price: body.data.price,
      fee: body.data.fee,
      time: BigInt(body.data.time),
      note: body.data.note,
    },
  });
  return NextResponse.json({ transaction: serializeTx(created) });
}
