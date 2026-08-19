import webpush from "web-push";
import { prisma } from "../db";
import type { Notifier, NotifierPayload } from "./index";

export type StoredSubscription = { id: string; endpoint: string; p256dh: string; auth: string };
export type PushSendFn = (
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
) => Promise<unknown>;

export class WebPushNotifier implements Notifier {
  constructor(
    private readonly deps: {
      list: () => Promise<StoredSubscription[]>;
      remove: (id: string) => Promise<void>;
      sendFn: PushSendFn;
    },
  ) {}

  async send(payload: NotifierPayload): Promise<void> {
    const subs = await this.deps.list();
    if (subs.length === 0) throw new Error("no push subscriptions");
    const body = JSON.stringify({
      title: `${payload.symbol} · ${payload.signal}`,
      body: `price ${payload.price} (${payload.timeframe})`,
      url: "/alerts",
    });
    let delivered = 0;
    for (const s of subs) {
      try {
        await this.deps.sendFn({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body);
        delivered++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await this.deps.remove(s.id); // device gone
      }
    }
    if (delivered === 0) throw new Error("web push failed for all subscriptions");
  }
}

export function makeWebPushNotifier(): WebPushNotifier | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:admin@example.com", publicKey, privateKey);
  return new WebPushNotifier({
    list: () => prisma.pushSubscription.findMany(),
    remove: async (id) => {
      await prisma.pushSubscription.delete({ where: { id } }).catch(() => {});
    },
    sendFn: (sub, payload) => webpush.sendNotification(sub, payload),
  });
}
