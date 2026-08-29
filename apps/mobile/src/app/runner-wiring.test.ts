import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The three things that must agree for a background alert to ever fire, none
 * of which any other check can see.
 *
 * The background runner is a file Android loads by path, under a label the app
 * dispatches to by string, in a runtime with no imports. Nothing type-checks
 * across that boundary: a renamed label, a moved file, or a field the app
 * stopped sending all produce exactly the same symptom, which is a
 * notification that does not arrive — indistinguishable from a market that did
 * not move. That is the worst shape a bug can take in a feature whose entire
 * job is to tell you something.
 */
const ROOT = join(new URL("../../../../", import.meta.url).pathname);
const config = readFileSync(join(ROOT, "capacitor.config.ts"), "utf8");
const dispatcher = readFileSync(join(ROOT, "apps/mobile/src/app/device-alerts.tsx"), "utf8");
const runner = readFileSync(join(ROOT, "apps/mobile/public/runner/alerts.js"), "utf8");
/** The alerts screen, which is the other end of the status channel. */
const dispatcher0 = readFileSync(join(ROOT, "apps/mobile/src/app/alerts/page.tsx"), "utf8");

describe("the background runner's wiring", () => {
  it("ships the file the config names, inside the bundle the config ships", () => {
    // `webDir` for this build is apps/mobile/out, which Next fills from
    // apps/mobile/public. A runner under apps/web/public — where the wrapper
    // build's lives — would not be in this APK at all.
    expect(existsSync(join(ROOT, "apps/mobile/public/runner/alerts.js"))).toBe(true);
    expect(config).toContain('src: "runner/alerts.js"');
  });

  it("dispatches to the label the standalone build registers", () => {
    expect(config).toContain('"app.contour.standalone.alerts"');
    expect(dispatcher).toContain('label: "app.contour.standalone.alerts"');
  });

  it("keeps the two builds' labels apart, since both install side by side", () => {
    // One label shared would let the wrapper's foreground pass write rules
    // that the standalone build's job then evaluates, against a portfolio it
    // has never seen.
    expect(config).toContain('"app.contour.local.alerts"');
  });

  it("listens for the event the config schedules, and for the rules push", () => {
    expect(config).toContain('event: "alertCheck"');
    expect(runner).toContain('addEventListener("alertCheck"');
    expect(runner).toContain('addEventListener("setRules"');
  });

  it("reads the venue the expander sends, rather than pricing everything as a coin", () => {
    // `expandRules` marks each check crypto or equity. A runner that ignored
    // that would ask Binance for AMD and get an unrelated token's price.
    expect(runner).toContain('r.assetType === "equity"');
    expect(runner).toContain("query1.finance.yahoo.com");
  });

  it("waits half an hour, which is what the settings screen tells people", () => {
    expect(config).toContain("interval: url ? 15 : 30");
  });

  it("can be asked what it has been doing, from the app", () => {
    /*
     * Android decides whether a periodic job runs, and when it declines there
     * is no error and no event — the check simply does not happen. The alerts
     * page showed a "last checked" time written by the *foreground* pass, from
     * localStorage, while the runner records its own in CapacitorKV. Two
     * stores: the line never covered the background half, so a runner that had
     * never once fired looked exactly like a market that had not moved.
     *
     * `dispatchEvent` resolving is the only channel out of that runtime, so
     * both ends have to name the same event.
     */
    expect(runner).toContain('addEventListener("getStatus"');
    expect(dispatcher0).toContain('event: "getStatus"');
    // And the runner has to be writing what it reports.
    expect(runner).toContain('writeJson("lastRun"');
    expect(runner).toContain('writeJson("lastError"');
  });

  it("keeps the runner's location permissions out of the build", () => {
    /*
     * @capacitor/background-runner declares coarse, fine and background
     * location in its own manifest, because the runner can be used for
     * geofencing. This app wakes it to compare prices and never asks where the
     * phone is.
     *
     * The merger folds those in silently, and they surface on the install
     * screen — so an app whose whole argument is that nothing leaves the
     * device would be asking for background location in the one place a person
     * actually looks. Verified in the built APK with `aapt2 dump badging`;
     * this is the check that keeps it that way without a build.
     */
    const manifest = readFileSync(
      join(ROOT, "android/app/src/main/AndroidManifest.xml"), "utf8",
    );
    for (const permission of [
      "ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION", "ACCESS_BACKGROUND_LOCATION",
    ]) {
      expect(manifest).toContain(
        `<uses-permission android:name="android.permission.${permission}" tools:node="remove" />`,
      );
    }
  });
});
