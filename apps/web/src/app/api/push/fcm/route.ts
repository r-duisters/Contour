import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Where a device hands over its FCM registration token.
 *
 * Separate from `/api/push/subscribe`, which takes a Web Push endpoint and
 * keypair. The two mechanisms address different things and only one works per
 * platform: the APK can use FCM and not Web Push, a browser the reverse.
 */
const Register = z.object({
  token: z.string().min(20).max(4096),
  label: z.string().max(64).optional(),
});
const Unregister = z.object({ token: z.string().min(20).max(4096) });

export async function POST(req: NextRequest) {
  const body = Register.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const { token, label } = body.data;
  // Upsert, because a device re-registers on every launch and the token only
  // sometimes changes. A second row for the same device would notify twice.
  const row = await prisma.fcmToken.upsert({
    where: { token },
    update: { label: label ?? null },
    create: { token, label: label ?? null },
  });
  return NextResponse.json({ id: row.id });
}

export async function DELETE(req: NextRequest) {
  const body = Unregister.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  await prisma.fcmToken.deleteMany({ where: { token: body.data.token } });
  return NextResponse.json({ ok: true });
}

export async function GET() {
  // How many devices would be notified, so Settings can say so rather than
  // leaving the question open.
  return NextResponse.json({ devices: await prisma.fcmToken.count() });
}
