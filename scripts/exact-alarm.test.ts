import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The coupling between a manifest line and a notification option.
 *
 * `AndroidManifest.xml` removes `SCHEDULE_EXACT_ALARM`, because Google Play
 * restricts it and this app never schedules a notification for a time. That
 * makes `AlarmManager.canScheduleExactAlarms()` false for this app on Android
 * 12 and above, permanently and by design.
 *
 * `@capacitor/local-notifications` then has a trap in it.
 * `isExactNotification` defaults to **true**, and `LocalNotificationsPlugin`
 * checks it *before* it looks at whether a notification is scheduled at all:
 *
 *     val honorExact = notifications.any { it.isExactNotification }
 *     if (honorExact && SDK_INT >= S && !canScheduleExactAlarms()) {
 *         startActivityForResult(call, ACTION_REQUEST_SCHEDULE_EXACT_ALARM, …)
 *         return
 *     }
 *
 * So an immediate notification — no `schedule` field, no alarm, nothing to be
 * exact about — opens the system's "Alarms & reminders" settings screen
 * instead of posting. Every alert on Android 12+ would become a settings
 * screen, and the notification would never arrive.
 *
 * Nothing else catches this. It type-checks, it builds, it passes every other
 * test, and it only misbehaves on a real phone at the moment an alert fires —
 * which is the moment nobody is watching.
 */

const DEVICE_ALERTS = new URL("../apps/mobile/src/app/device-alerts.tsx", import.meta.url).pathname;
const MANIFEST = new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url).pathname;

const withoutComments = (path: string) =>
  readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "");

describe("posting a notification without the exact-alarm permission", () => {
  /**
   * The premise. If the permission ever comes back the option below stops
   * mattering — but the permission cannot come back, because Play rejects it,
   * so this pins the reason rather than leaving the option looking arbitrary.
   */
  it("is the situation this app is permanently in", () => {
    expect(withoutComments(MANIFEST))
      .toContain('<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" tools:node="remove" />');
  });

  /**
   * Every `schedule()` call, not just the one that exists today. The check is
   * per call site because the plugin's guard is per batch: one notification
   * left at the default is enough to divert the whole call to a settings
   * screen.
   */
  it("passes isExactNotification: false on every schedule call", () => {
    const source = withoutComments(DEVICE_ALERTS);
    const calls = source.match(/LocalNotifications\.schedule\(\{[\s\S]*?\n  \}\);/g) ?? [];
    expect(calls.length, "no LocalNotifications.schedule call found — has it moved?")
      .toBeGreaterThan(0);
    for (const call of calls) {
      expect(call, "a schedule() call leaves isExactNotification at its default of true, which opens Android's \"Alarms & reminders\" screen instead of posting")
        .toContain("isExactNotification: false");
    }
  });
});
