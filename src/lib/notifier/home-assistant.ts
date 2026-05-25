import type { Notifier, NotifierPayload } from "./index";

export class HomeAssistantNotifier implements Notifier {
  constructor(
    private readonly haUrl: string,
    private readonly webhookId: string,
  ) {}

  async send(payload: NotifierPayload): Promise<void> {
    const url = `${this.haUrl.replace(/\/+$/, "")}/api/webhook/${this.webhookId}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`HA webhook ${res.status}: ${await res.text().catch(() => "")}`);
    }
  }
}
