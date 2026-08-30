import type { Notifier, NotifierPayload } from "./index";

/**
 * A POST of the alert, as JSON, to a URL somebody chose.
 *
 * This replaced `HomeAssistantNotifier`, which took a base URL and a webhook
 * id and assembled `${base}/api/webhook/${id}` — Home Assistant's path, and
 * only ever that. It worked, and it quietly made Home Assistant the one thing
 * an alert could reach: a trading bot, an n8n flow, a Discord relay or a
 * script on the same machine all speak HTTP and none of them serve that path.
 *
 * So the notifier takes a whole URL and posts to it. Home Assistant is one
 * destination among them now rather than the shape of the feature, and
 * `webhookUrl()` below keeps existing configurations working unchanged.
 *
 * The payload is unchanged, because it was already generic: symbol, signal,
 * price, time, the alert's id, and an optional `text` a receiver can use
 * instead of composing its own wording.
 */
export class WebhookNotifier implements Notifier {
  constructor(private readonly url: string) {}

  async send(payload: NotifierPayload): Promise<void> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`webhook ${res.status}: ${await res.text().catch(() => "")}`);
    }
  }
}

/**
 * Where an alert should be posted, from the two stored fields.
 *
 * The fields are still called `haUrl` and `haWebhookId` because they are
 * columns in two databases and a rename is a migration; what they *mean* has
 * widened. Read them as "the endpoint" and "an optional Home Assistant webhook
 * id":
 *
 * - **Both set** — Home Assistant, exactly as before. The id is appended to
 *   HA's own webhook path so an existing automation keeps firing and nobody
 *   has to re-enter anything.
 * - **URL only** — posted to verbatim. This is the general case: any endpoint
 *   that accepts a JSON POST.
 *
 * Returns null when there is nothing usable, so a caller can simply not add a
 * notifier rather than construct one that will throw on every alert. A URL
 * that is not absolute http(s) counts as nothing: a relative path would resolve
 * against the server itself and post alerts to Contour.
 */
export function webhookUrl(
  haUrl: string | null | undefined,
  haWebhookId: string | null | undefined,
): string | null {
  const base = haUrl?.trim();
  if (!base) return null;
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const id = haWebhookId?.trim();
  return id ? `${base.replace(/\/+$/, "")}/api/webhook/${id}` : base;
}
