import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

export const dynamic = "force-dynamic";

const Body = z.object({ password: z.string().min(1).max(200) });

// Best-effort brute-force damping; resets on restart (accepted for single-user).
const failures = new Map<string, { count: number; until: number }>();
const FREE_ATTEMPTS = 5;

function clientKey(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

export async function POST(req: NextRequest) {
  const key = clientKey(req);
  const f = failures.get(key);
  if (f && Date.now() < f.until) {
    return NextResponse.json({ error: "too many attempts, retry later" }, { status: 429 });
  }

  const body = Body.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings?.passwordHash) {
    return NextResponse.json({ setupRequired: true }, { status: 409 });
  }

  if (!(await verifyPassword(body.data.password, settings.passwordHash))) {
    const count = (f?.count ?? 0) + 1;
    const lockMin = count <= FREE_ATTEMPTS ? 0 : Math.min(60, 2 ** (count - FREE_ATTEMPTS));
    failures.set(key, { count, until: Date.now() + lockMin * 60_000 });
    return NextResponse.json({ error: "wrong password" }, { status: 401 });
  }

  failures.delete(key);
  const secret = process.env.SESSION_SECRET;
  if (!secret) return NextResponse.json({ error: "SESSION_SECRET not configured" }, { status: 500 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(secret), sessionCookieOptions());
  return res;
}
