import { describe, expect, it, vi } from "vitest";
import { FcmNotifier, type FcmSendFn } from "./fcm";

const payload = {
  alertId: "a1", symbol: "BTCUSDT", timeframe: "1d",
  signal: "target_above:BTCUSDT", price: 79_000, time: Date.now(),
};

function notifier(sendFn: FcmSendFn & { mock: { calls: unknown[][] } }, tokens = ["tok-a", "tok-b"]) {
  const removed: string[] = [];
  const n = new FcmNotifier({
    list: async () => tokens.map((t, i) => ({ id: String(i), token: t })),
    remove: async (id) => { removed.push(id); },
    sendFn,
  });
  return { n, removed };
}

describe("FcmNotifier", () => {
  it("sends a notification payload, not data-only", async () => {
    const sendFn = vi.fn<FcmSendFn>().mockResolvedValue({ ok: true });
    const { n } = notifier(sendFn);

    await n.send(payload);

    const [, message] = sendFn.mock.calls[0]! as [string, {
      notification: { title: string };
      android: { priority: string };
    }];
    // Android renders a `notification` block itself, without waking the app to
    // run code. A data-only message needs the app to execute, which is exactly
    // what Doze prevents — the failure this whole path exists to avoid.
    expect(message.notification).toBeTruthy();
    expect(message.notification.title).toContain("BTCUSDT");
    expect(message.android.priority).toBe("high");
  });

  it("reaches every registered device", async () => {
    const sendFn = vi.fn<FcmSendFn>().mockResolvedValue({ ok: true });
    const { n } = notifier(sendFn);

    await n.send(payload);

    expect(sendFn.mock.calls.map((c) => (c as [string, unknown])[0])).toEqual(["tok-a", "tok-b"]);
  });

  it("forgets a token Google says is gone", async () => {
    // UNREGISTERED means the app was uninstalled or the token rotated. Keeping
    // it means paying to retry a dead device on every tick, for ever.
    const sendFn = vi.fn<FcmSendFn>()
      .mockRejectedValueOnce(Object.assign(new Error("nope"), { fcmError: "UNREGISTERED" }))
      .mockResolvedValueOnce({ ok: true });
    const { n, removed } = notifier(sendFn);

    await n.send(payload);

    expect(removed).toEqual(["0"]);
  });

  it("keeps a token whose send failed for some other reason", async () => {
    // A network blip is not a dead device. Dropping the token would silently
    // unsubscribe someone because their wifi hiccuped.
    const sendFn = vi.fn<FcmSendFn>()
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValueOnce({ ok: true });
    const { n, removed } = notifier(sendFn);

    await n.send(payload);

    expect(removed).toEqual([]);
  });

  it("throws when nothing was delivered, so the caller does not mark it sent", async () => {
    const sendFn = vi.fn<FcmSendFn>().mockRejectedValue(new Error("down"));
    const { n } = notifier(sendFn);

    await expect(n.send(payload)).rejects.toThrow();
  });

  it("throws when no device is registered at all", async () => {
    const { n } = notifier(vi.fn<FcmSendFn>(), []);
    await expect(n.send(payload)).rejects.toThrow(/no fcm/i);
  });
});
