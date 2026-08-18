import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

export const dynamic = "force-dynamic";

const Body = z.object({ password: z.string().min(8).max(200) });

export async function POST(req: NextRequest) {
  const body = Body.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const existing = await prisma.settings.findUnique({ where: { id: 1 } });
  if (existing?.passwordHash) {
    return NextResponse.json({ error: "already set up" }, { status: 409 });
  }
  const passwordHash = await hashPassword(body.data.password);
  await prisma.settings.upsert({
    where: { id: 1 },
    update: { passwordHash },
    create: { id: 1, passwordHash },
  });

  const secret = process.env.SESSION_SECRET;
  if (!secret) return NextResponse.json({ error: "SESSION_SECRET not configured" }, { status: 500 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(secret), sessionCookieOptions());
  return res;
}
