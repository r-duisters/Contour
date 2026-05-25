import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  const updated = await prisma.alert.update({
    where: { id },
    data: { enabled: body.enabled },
  });
  return NextResponse.json({ alert: updated });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await prisma.alert.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
