import { describe, expect, it } from "vitest";
import { MemoryStore } from "../testing/memory-store";
import { DEFAULT_SETTINGS } from "../ports/store";
import { getSettings, saveSettings } from "./settings";

describe("getSettings", () => {
  it("returns the fully-defaulted settings the Store hands back, no passwordHash on it", async () => {
    const store = MemoryStore();

    const settings = await getSettings(store);

    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(settings).not.toHaveProperty("passwordHash");
  });

  it("reflects whatever the store already holds", async () => {
    const store = MemoryStore({ settings: { displayCurrency: "EUR", haUrl: "http://ha.local" } });

    expect(await getSettings(store)).toEqual({
      ...DEFAULT_SETTINGS,
      displayCurrency: "EUR",
      haUrl: "http://ha.local",
    });
  });
});

describe("saveSettings", () => {
  it("merges rather than replaces: a one-field patch leaves the rest untouched", async () => {
    const store = MemoryStore({
      settings: { displayCurrency: "EUR", haUrl: "http://ha.local", haWebhookId: "wh1" },
    });

    const saved = await saveSettings(store, { haWebhookId: "wh2" });

    expect(saved).toEqual({
      ...DEFAULT_SETTINGS,
      displayCurrency: "EUR",
      haUrl: "http://ha.local",
      haWebhookId: "wh2",
    });
    // Proves it is a real merge and not a coincidence of this one field.
    expect(await getSettings(store)).toEqual(saved);
  });

  it("an unknown key is ignored, exactly as the route's Zod schema (no .strict()) already does", async () => {
    const store = MemoryStore({ settings: { displayCurrency: "USD" } });

    const saved = await saveSettings(store, {
      displayCurrency: "EUR",
      // A field the wire type does not have; only a caller that bypasses Zod
      // (or, later, a device UI with none) could ever produce this.
      ...({ notAField: "sneaky" } as Record<string, unknown>),
    });

    expect(saved).toEqual({ ...DEFAULT_SETTINGS, displayCurrency: "EUR" });
    expect(saved).not.toHaveProperty("notAField");
  });

  it("an empty patch changes nothing", async () => {
    const store = MemoryStore({ settings: { displayCurrency: "EUR", equityApiKey: "key-1" } });

    const saved = await saveSettings(store, {});

    expect(saved).toEqual({ ...DEFAULT_SETTINGS, displayCurrency: "EUR", equityApiKey: "key-1" });
  });
});
