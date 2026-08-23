import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { HomeAssistantNotifier } from "@/lib/notifier/home-assistant";
import type { Notifier } from "@/lib/notifier";
import { makeWebPushNotifier } from "@/lib/notifier/web-push";
import { deps } from "@/lib/deps";
import { getSettings, saveSettings } from "@/data/services/settings";

export const dynamic = "force-dynamic";

const Body = z.object({
  haUrl: z.string().url().nullable().optional(),
  haWebhookId: z.string().nullable().optional(),
  displayCurrency: z.enum(["USD", "EUR"]).optional(),
  equityProvider: z.enum(["yahoo", "twelvedata", "alphavantage"]).optional(),
  equityApiKey: z.string().max(200).nullable().optional(),
});

// The row id is always 1 — a hard-coded singleton, never a stored field on
// the `Store` port's `Settings` (which has no id at all, and never leaks
// `passwordHash` either). The wire shape has always included it, so it is
// added back here rather than changing what every settings screen reads.
function toJson(s: Awaited<ReturnType<typeof getSettings>>) {
  return { id: 1, ...s };
}

export async function GET() {
  // A virgin database (before /api/setup ever runs) has no settings row.
  // `getSettings()` defaults it unconditionally — deliberately, since that
  // removed some twenty `where: { id: 1 }` null checks elsewhere — but this
  // route's wire format has always answered bare `null` in that one case
  // (`s ?? null` on the old `findUnique`), which `settings/page.tsx` fetches
  // and tolerates as a distinct state from a real, defaulted row. Reproducing
  // that stays the route's job, not the service's: it is response shaping,
  // not storage.
  const exists = await prisma.settings.findUnique({ where: { id: 1 }, select: { id: true } });
  if (!exists) return NextResponse.json({ settings: null });
  const { store } = deps();
  return NextResponse.json({ settings: toJson(await getSettings(store)) });
}

export async function PUT(req: NextRequest) {
  const body = Body.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const { store } = deps();
  const s = await saveSettings(store, body.data);
  return NextResponse.json({ settings: toJson(s) });
}

/**
 * Sends a synthetic signal through every configured notifier (HA + Web Push).
 * Left inline rather than moved behind the ports: this is a server-only
 * integration test-ping, the one handler in this file the mobile/APK build
 * will never call, and moving it would put Home Assistant / web-push wiring
 * into a package that has to run inside an APK with none of it available.
 */
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
