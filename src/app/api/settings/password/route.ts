import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

const Body = z.object({ current: z.string().min(1), next: z.string().min(8).max(200) });

export async function PUT(req: NextRequest) {
  const body = Body.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings?.passwordHash || !(await verifyPassword(body.data.current, settings.passwordHash))) {
    return NextResponse.json({ error: "current password is wrong" }, { status: 401 });
  }
  await prisma.settings.update({
    where: { id: 1 },
    data: { passwordHash: await hashPassword(body.data.next) },
  });
  return NextResponse.json({ ok: true });
}
