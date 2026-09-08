import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The chain a notification tap travels to reach the asset's page.
 *
 * Five files in four languages, coupled by literal strings that nothing
 * type-checks: the patched plugin puts the payload on the launch intent,
 * MainActivity stashes it and rings a window event, a local Capacitor plugin
 * hands it over on request, and `notification-taps.tsx` navigates. Rename any
 * one of the strings and every link still compiles, builds and ships — the
 * tap just silently goes back to doing nothing, which is exactly where this
 * feature started: the stock plugin aimed its tap intent at an action no
 * activity declares.
 */

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p: string) => readFileSync(`${ROOT}${p}`, "utf8");

const patch = read("patches/@capacitor+background-runner+3.0.0.patch");
const mainActivity = read("android/app/src/main/java/app/contour/local/MainActivity.java");
const tapPlugin = read("android/app/src/main/java/app/contour/local/NotificationTapPlugin.java");
const taps = read("apps/mobile/src/app/notification-taps.tsx");
const runner = read("apps/mobile/public/runner/alerts.js");
const foreground = read("apps/mobile/src/app/device-alerts.tsx");

describe("a notification tap reaches the asset page", () => {
  it("launches the app from a background notification, with the payload aboard", () => {
    // The stock intent's action, ".NOTIFICATION_CLICKED", matches nothing in
    // the manifest, so the tap was inert. The launcher intent is the fix and
    // the extra is the cargo.
    expect(patch).toContain("getLaunchIntentForPackage");
    expect(patch).toContain('putExtra("notificationExtra"');
    expect(patch).toContain('optJSONObject("extra")');
  });

  it("stashes the payload under the key the patch writes", () => {
    expect(mainActivity).toContain('getStringExtra("notificationExtra")');
    expect(mainActivity).toContain("registerPlugin(NotificationTapPlugin.class)");
    // The warm-tap doorbell, and the page listening for the same name.
    expect(mainActivity).toContain('triggerWindowJSEvent("contourNotificationTap"');
    expect(taps).toContain('"contourNotificationTap"');
  });

  it("hands it over through the plugin the page asks for", () => {
    expect(tapPlugin).toContain('name = "NotificationTap"');
    expect(tapPlugin).toContain("takePendingNotificationTap");
    expect(mainActivity).toContain("takePendingNotificationTap");
    expect(taps).toContain('registerPlugin<{ consume(): Promise<{ extra: string | null }> }>("NotificationTap")');
  });

  it("carries a symbol and venue from both notification paths", () => {
    // The runner's per-rule notices carry where to land; the portfolio-wide
    // one deliberately does not — there is no one asset to land on.
    expect(runner).toContain("tapExtra(rule)");
    expect(runner).toMatch(/schedule\(\[\{ id, title, body, extra \}\]\)/);
    expect(foreground).toContain("extra: { symbol, assetType }");
    // And the page reads the foreground plugin's own tap event.
    expect(taps).toContain('"localNotificationActionPerformed"');
  });
});
