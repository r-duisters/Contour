/**
 * What a phone has to agree to before an alert can reach anybody.
 *
 * Two separate permissions, and they fail differently. Android 13 and later
 * post nothing at all without notification permission, which is loud: no
 * notification ever appears. Battery optimisation is quiet — the scheduled
 * background check is simply deferred, sometimes for hours, sometimes
 * forever, and the only symptom is a notification that does not arrive, which
 * looks exactly like a market that did not move. The second is the one worth
 * asking about explicitly, because nobody would ever go looking for it.
 *
 * Everything here answers safely off a phone. `packages/ui` is shared with a
 * web build that has no Capacitor at all, so each call feature-detects and
 * returns the honest "not available" rather than throwing — the setup step
 * then simply does not draw the control, which is the same rule
 * `sendTestNotification` follows on the settings screen.
 */

export type NotificationPermission = "granted" | "denied" | "unavailable";

async function native(): Promise<boolean> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** Ask for permission to post notifications. Idempotent once granted. */
export async function requestNotifications(): Promise<NotificationPermission> {
  if (!(await native())) return "unavailable";
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const current = await LocalNotifications.checkPermissions();
    if (current.display === "granted") return "granted";
    const asked = await LocalNotifications.requestPermissions();
    return asked.display === "granted" ? "granted" : "denied";
  } catch {
    return "unavailable";
  }
}

/**
 * Whether the scheduled check is already free to run.
 *
 * `null` means the question does not apply here — a browser, or a phone below
 * API 23 where there is no doze to be exempt from. The caller draws nothing
 * for null rather than offering a button that cannot do anything.
 */
export async function isBatteryExempt(): Promise<boolean | null> {
  if (!(await native())) return null;
  try {
    const { registerPlugin } = await import("@capacitor/core");
    const plugin = registerPlugin<BatteryOptimization>("BatteryOptimization");
    return (await plugin.isExempt()).exempt;
  } catch {
    return null;
  }
}

/** Show the system's allow/deny dialog, and answer with where it left things. */
export async function requestBatteryExemption(): Promise<boolean | null> {
  if (!(await native())) return null;
  try {
    const { registerPlugin } = await import("@capacitor/core");
    const plugin = registerPlugin<BatteryOptimization>("BatteryOptimization");
    return (await plugin.request()).exempt;
  } catch {
    return null;
  }
}

/** The local plugin in `android/app/src/main/java/app/contour/local`. */
type BatteryOptimization = {
  isExempt(): Promise<{ exempt: boolean }>;
  request(): Promise<{ exempt: boolean }>;
};
