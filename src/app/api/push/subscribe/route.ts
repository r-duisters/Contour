import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const Subscribe = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});
const Unsubscribe = z.object({ endpoint: z.string().url() });

export async function POST(req: NextRequest) {
  const body = Subscribe.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const { endpoint, keys } = body.data;
  const sub = await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: { p256dh: keys.p256dh, auth: keys.auth },
    create: { endpoint, p256dh: keys.p256dh, auth: keys.auth },
  });
  return NextResponse.json({ id: sub.id });
}

export async function DELETE(req: NextRequest) {
  const body = Unsubscribe.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  await prisma.pushSubscription.deleteMany({ where: { endpoint: body.data.endpoint } });
  return NextResponse.json({ ok: true });
}
