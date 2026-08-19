import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { HomeAssistantNotifier } from "@/lib/notifier/home-assistant";
import type { Notifier } from "@/lib/notifier";
import { makeWebPushNotifier } from "@/lib/notifier/web-push";

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

// POST sends a synthetic signal through every configured notifier (HA + Web Push).
export async function POST() {
  const s = await prisma.settings.findUnique({ where: { id: 1 } });
  const notifiers: { name: string; n: Notifier }[] = [];
  if (s?.haUrl && s?.haWebhookId) {
    notifiers.push({ name: "home-assistant", n: new HomeAssistantNotifier(s.haUrl, s.haWebhookId) });
  }
  const wp = makeWebPushNotifier();
  if (wp) notifiers.push({ name: "web-push", n: wp });
  if (notifiers.length === 0) {
    return NextResponse.json({ error: "no notifier configured" }, { status: 400 });
  }
  const results: Record<string, string> = {};
  for (const { name, n } of notifiers) {
    try {
      await n.send({
        alertId: "test", symbol: "BTCUSDT", timeframe: "1h",
        signal: "test", price: 0, time: Date.now(), meta: { test: true },
      });
      results[name] = "ok";
    } catch (e) {
      results[name] = (e as Error).message;
    }
  }
  return NextResponse.json({ ok: Object.values(results).some((v) => v === "ok"), results });
}
