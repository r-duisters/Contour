import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const Patch = z.object({ enabled: z.boolean() });

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = Patch.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }
  const updated = await prisma.alert.update({
    where: { id },
    data: { enabled: body.data.enabled },
  });
  /*
   * Shaped the way GET shapes a row, not returned raw.
   *
   * `params` is a JSON *string* in the column, and this route handed the row
   * straight back — so the same alert had an object for `params` when listed
   * and a string when toggled. Nothing read the response until `DataClient`
   * grew `setAlertEnabled`, which is exactly how a divergence like this waits.
   * Response shaping is a route's job; the parse is the shaping.
   */
  return NextResponse.json({
    alert: {
      ...updated,
      params: JSON.parse(updated.params),
      lastBarTime: updated.lastBarTime ? Number(updated.lastBarTime) : null,
    },
  });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await prisma.alert.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
