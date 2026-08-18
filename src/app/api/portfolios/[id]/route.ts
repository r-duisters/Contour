import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { serializeTx } from "../tx";

export const dynamic = "force-dynamic";

const Patch = z.object({
  name: z.string().min(1).max(100),
});

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const portfolio = await prisma.portfolio.findUnique({
    where: { id },
    include: { transactions: { orderBy: { time: "desc" } } },
  });
  if (!portfolio) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    portfolio: {
      id: portfolio.id,
      name: portfolio.name,
      createdAt: portfolio.createdAt,
      transactions: portfolio.transactions.map(serializeTx),
    },
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = Patch.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const updated = await prisma.portfolio.update({ where: { id }, data: { name: body.data.name } });
  return NextResponse.json({ portfolio: updated });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await prisma.portfolio.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
