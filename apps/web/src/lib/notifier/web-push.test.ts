import { describe, expect, it, vi } from "vitest";
import { WebPushNotifier, type StoredSubscription } from "./web-push";
import type { NotifierPayload } from "./index";

const payload: NotifierPayload = {
  alertId: "a1", symbol: "BTCUSDT", timeframe: "1d",
  signal: "target_above:BTCUSDT", price: 100000, time: 1755500000000,
};

function sub(id: string): StoredSubscription {
  return { id, endpoint: `https://push.example/${id}`, p256dh: "k", auth: "s" };
}

describe("WebPushNotifier", () => {
  it("sends a JSON notification to every subscription", async () => {
    const sendFn = vi.fn().mockResolvedValue(undefined);
    const n = new WebPushNotifier({ list: async () => [sub("1"), sub("2")], remove: vi.fn(), sendFn });
    await n.send(payload);
    expect(sendFn).toHaveBeenCalledTimes(2);
    const body = JSON.parse(sendFn.mock.calls[0]![1] as string);
    expect(body.title).toContain("BTCUSDT");
    expect(body.url).toBe("/alerts");
  });

  it("prunes subscriptions that return 404/410 and still succeeds if one works", async () => {
    const remove = vi.fn();
    const sendFn = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("gone"), { statusCode: 410 }))
      .mockResolvedValueOnce(undefined);
    const n = new WebPushNotifier({ list: async () => [sub("dead"), sub("live")], remove, sendFn });
    await n.send(payload);
    expect(remove).toHaveBeenCalledWith("dead");
  });

  it("throws when there are no subscriptions", async () => {
    const n = new WebPushNotifier({ list: async () => [], remove: vi.fn(), sendFn: vi.fn() });
    await expect(n.send(payload)).rejects.toThrow();
  });

  it("throws when every send fails, without pruning non-410 errors", async () => {
    const remove = vi.fn();
    const sendFn = vi.fn().mockRejectedValue(Object.assign(new Error("boom"), { statusCode: 500 }));
    const n = new WebPushNotifier({ list: async () => [sub("1")], remove, sendFn });
    await expect(n.send(payload)).rejects.toThrow();
    expect(remove).not.toHaveBeenCalled();
  });
});
