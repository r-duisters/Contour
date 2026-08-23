import type { Settings, SettingsPatch, Store } from "../ports/store";

/**
 * Storage in, storage out — same shape as `portfolios.ts`. Zod validation of
 * the inbound PUT body stays in the route (this file has to run with no Zod
 * on a device build); what stays here is the one thing worth keeping out of
 * the route regardless: a patch is trimmed to the keys `Settings` actually
 * has before it reaches the store, so a caller that skipped route validation
 * (a future device UI with no Zod either) still cannot smuggle an arbitrary
 * field into the settings row. `MemoryStore.settings.save` and `PrismaStore`
 * both merge rather than replace; this only decides what is eligible to
 * merge.
 */
const PATCHABLE_KEYS = [
  "displayCurrency",
  "equityProvider",
  "equityApiKey",
  "haUrl",
  "haWebhookId",
  "mqttBrokerUrl",
  "mqttTopicPrefix",
] as const satisfies readonly (keyof Settings)[];

function trim(patch: SettingsPatch): SettingsPatch {
  const clean: SettingsPatch = {};
  for (const key of PATCHABLE_KEYS) {
    if (key in patch) (clean as Record<string, unknown>)[key] = patch[key];
  }
  return clean;
}

export function getSettings(store: Store): Promise<Settings> {
  return store.settings.get();
}

/**
 * Whether the install has ever been configured. Separate from `getSettings`
 * rather than folded into a nullable return, because the twenty call sites
 * that stopped null-checking are the reason `get()` is non-nullable. Only the
 * settings screen needs the difference, to render a virgin install as first-run
 * rather than as a form full of defaults.
 */
export function settingsExist(store: Store): Promise<boolean> {
  return store.settings.exists();
}

export function saveSettings(store: Store, patch: SettingsPatch): Promise<Settings> {
  return store.settings.save(trim(patch));
}
