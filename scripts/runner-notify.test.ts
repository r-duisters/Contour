import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The background runner's notifications must post directly, not via an alarm.
 *
 * `@capacitor/background-runner`'s Android side never posts a notification
 * itself: `Notifications.kt` routes every one — immediate or not — through
 * `AlarmManager`, with `scheduleAt` defaulting to "now". This app cannot hold
 * `SCHEDULE_EXACT_ALARM` (removed for Play; see `exact-alarm.test.ts`), so
 * that alarm is `setAndAllowWhileIdle` — inexact and Doze-deferred. The
 * runner would evaluate in a maintenance window, "send" its notification, and
 * Android would hold the alarm until the phone woke: an alert that arrives
 * only when the person picks up the phone, which is exactly the failure the
 * runner exists to prevent, reported 2026-09-06.
 *
 * `patches/@capacitor+background-runner+3.0.0.patch` makes the plugin post a
 * notification with no `scheduleAt` directly through `NotificationManager`,
 * inside the WorkManager run Android has already granted. Nothing else
 * catches a missing patch: the unpatched plugin type-checks, builds, and
 * misbehaves only on a dozing physical phone.
 */

const ROOT = new URL("..", import.meta.url).pathname;
const PATCH = `${ROOT}patches/@capacitor+background-runner+3.0.0.patch`;
const INSTALLED =
  `${ROOT}node_modules/@capacitor/background-runner/android/src/main/java/io/ionic/backgroundrunner/plugin/api/Notifications.kt`;

describe("background-runner notifications post directly", () => {
  it("keeps the patch that bypasses the alarm for immediate notifications", () => {
    expect(existsSync(PATCH), "the patch file is gone — without it the runner's notifications become Doze-deferred alarms").toBe(true);
    const patch = readFileSync(PATCH, "utf8");
    expect(patch).toContain("if (it.hasScheduleAt)");
    expect(patch).toContain("notificationManager.notify(it.id, builder.build())");
  });

  it("applies the patch on every install", () => {
    const pkg = JSON.parse(readFileSync(`${ROOT}package.json`, "utf8"));
    expect(pkg.scripts.postinstall, "postinstall must run patch-package, or npm ci ships the unpatched plugin")
      .toContain("patch-package");
  });

  it("is applied to the copy this checkout would build", () => {
    // The APK compiles the plugin from node_modules source
    // (android/capacitor.settings.gradle), so this is the copy that ships.
    const installed = readFileSync(INSTALLED, "utf8");
    expect(installed, "node_modules holds the unpatched plugin — run npx patch-package")
      .toContain("if (it.hasScheduleAt)");
  });

  it("keeps the runner's own notifications immediate", () => {
    // The patch only rescues the no-`scheduleAt` path. A `scheduleAt` added to
    // the runner's schedule() call would put its alerts back on the inexact
    // alarm this patch exists to avoid.
    const runner = readFileSync(`${ROOT}apps/mobile/public/runner/alerts.js`, "utf8");
    expect(runner).toContain("CapacitorNotifications.schedule");
    expect(runner).not.toContain("scheduleAt");
  });
});
