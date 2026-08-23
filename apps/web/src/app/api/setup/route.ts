import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import {
  createSessionToken, isSecureRequest, SESSION_COOKIE, sessionCookieOptions,
} from "@/lib/session";

export const dynamic = "force-dynamic";

const Body = z.object({ password: z.string().min(8).max(200) });

/**
 * Reads and writes the settings row through Prisma, deliberately, and not
 * through the `Store` port the rest of the app moved behind in Phase 2.
 *
 * Both touches below name `passwordHash` and nothing else, and `passwordHash`
 * is absent from `Store.Settings` on purpose: it is a server credential, and
 * the port's second implementation is SQLite inside an APK that has no
 * password, no session and no login screen. A `getPasswordHash` /
 * `setPasswordHash` pair would free this route only by obliging that
 * implementation to answer a question it has no truthful answer to.
 *
 * `settings.exists()` cannot stand in for the read either. A row can exist
 * with a null hash — `PUT /api/settings` creates one whenever a display
 * currency is saved — so substituting it would answer 409 to an owner who has
 * never chosen a password and lock them out of first run.
 *
 * This is one of five auth sites (both login files, the password change, the
 * setup page, and here) that read the hash directly; routing only this one
 * through a port would leave the other four and make the port claim a concept
 * it half-owns. So the gap Phase 2's review flagged is closed by decision:
 * `/api/setup` is permanently inline, alongside the rest of authentication.
 */
export async function POST(req: NextRequest) {
  const body = Body.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const secret = process.env.SESSION_SECRET;
  if (!secret) return NextResponse.json({ error: "SESSION_SECRET not configured" }, { status: 500 });

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

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(secret), sessionCookieOptions(isSecureRequest(req)));
  return res;
}
