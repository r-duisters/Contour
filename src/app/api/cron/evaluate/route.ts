import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fetchKlines } from "@/lib/binance";
import { run } from "@/lib/indicator";
import { HomeAssistantNotifier } from "@/lib/notifier/home-assistant";
import type { Notifier } from "@/lib/notifier";
import type { Timeframe } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Evaluate every enabled alert against the latest closed bars and dispatch
 * any new signals via the configured notifier. Idempotent: a (alertId, barTime, kind)
 * unique constraint prevents duplicate dispatch across cron ticks.
 */
export async function GET() {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  const notifier = makeNotifier(settings);
  const alerts = await prisma.alert.findMany({ where: { enabled: true } });
  const summary: { alertId: string; fired: number; skipped: number; error?: string }[] = [];

  for (const a of alerts) {
    try {
      const bars = await fetchKlines({
        symbol: a.symbol, interval: a.timeframe as Timeframe, limit: 500,
      });
      // Drop the in-progress bar; only act on closed bars.
      const closed = bars.slice(0, -1);
      const { signals } = run(closed, JSON.parse(a.params));

      let fired = 0, skipped = 0;
      for (const s of signals) {
        if (a.lastBarTime && BigInt(s.barTime) <= a.lastBarTime) { skipped++; continue; }
        try {
          await prisma.alertEvent.create({
            data: {
              alertId: a.id,
              barTime: BigInt(s.barTime),
              signal: s.kind,
              price: s.price,
              payload: JSON.stringify({ symbol: a.symbol, timeframe: a.timeframe, ...s }),
            },
          });
          if (notifier) {
            await notifier.send({
              alertId: a.id,
              symbol: a.symbol,
              timeframe: a.timeframe,
              signal: s.kind,
              price: s.price,
              time: s.barTime,
            });
            await prisma.alertEvent.updateMany({
              where: { alertId: a.id, barTime: BigInt(s.barTime), signal: s.kind },
              data: { delivered: true },
            });
          }
          fired++;
        } catch (e) {
          // unique-constraint violation = already dispatched; treat as skipped
          if ((e as { code?: string }).code === "P2002") skipped++;
          else throw e;
        }
      }

      await prisma.alert.update({
        where: { id: a.id },
        data: {
          lastEvaluated: new Date(),
          lastBarTime: closed.length ? BigInt(closed[closed.length - 1]!.t) : a.lastBarTime,
        },
      });
      summary.push({ alertId: a.id, fired, skipped });
    } catch (e) {
      summary.push({ alertId: a.id, fired: 0, skipped: 0, error: (e as Error).message });
    }
  }

  return NextResponse.json({ ok: true, summary });
}

function makeNotifier(s: { haUrl: string | null; haWebhookId: string | null } | null): Notifier | null {
  if (!s?.haUrl || !s?.haWebhookId) return null;
  return new HomeAssistantNotifier(s.haUrl, s.haWebhookId);
}
