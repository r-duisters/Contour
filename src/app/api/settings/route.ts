import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { HomeAssistantNotifier } from "@/lib/notifier/home-assistant";

export const dynamic = "force-dynamic";

const Body = z.object({
  haUrl: z.string().url().nullable().optional(),
  haWebhookId: z.string().nullable().optional(),
});

export async function GET() {
  const s = await prisma.settings.findUnique({ where: { id: 1 } });
  return NextResponse.json({ settings: s ?? null });
}

export async function PUT(req: NextRequest) {
  const body = Body.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const s = await prisma.settings.upsert({
    where: { id: 1 },
    update: body.data,
    create: { id: 1, ...body.data },
  });
  return NextResponse.json({ settings: s });
}

// POST sends a synthetic signal so you can verify the HA automation end-to-end.
export async function POST() {
  const s = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!s?.haUrl || !s?.haWebhookId) {
    return NextResponse.json({ error: "Home Assistant URL or webhook id not configured" }, { status: 400 });
  }
  const notifier = new HomeAssistantNotifier(s.haUrl, s.haWebhookId);
  await notifier.send({
    alertId: "test",
    symbol: "BTCUSDT",
    timeframe: "1h",
    signal: "long",
    price: 0,
    time: Date.now(),
    meta: { test: true },
  });
  return NextResponse.json({ ok: true });
}
