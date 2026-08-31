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

  it("words a notification the same way the shared module does", () => {
    /*
     * The runner cannot import `packages/core/src/alert-copy.ts` — that
     * runtime has no imports at all — so the wording is duplicated by hand,
     * as its Binance call already is. Before the shared module existed the two
     * evaluators worded the same event differently: "up 5.2%" from the app and
     * "up 5.2% in 24h" from the runner. Both can fire for one move, because
     * the duplication is deliberate, so a person received two notifications
     * that did not look like the same thing.
     *
     * These are the phrases a reader would notice differing. A change to
     * either side has to be made on both, and this is what says so.
     */
    const shared = readFileSync(join(ROOT, "packages/core/src/alert-copy.ts"), "utf8");
    for (const phrase of [
      "% in 24 hours",
      "fell below",
      "rose above",
      "this one-shot alert has switched itself off",
      "still watching",
      "From your daily move rule on",
      // The portfolio kind, whose notice names a book rather than a ticker.
      "% in 24 hours",
      // The position kind, which speaks in the holder's terms rather than the market's.
      "% on what you paid",
      "average cost",
      // The alert that says the other alerts are blind.
      "No price for",
    ]) {
      expect(shared, `shared copy should contain ${phrase}`).toContain(phrase);
      expect(runner, `runner copy should contain ${phrase}`).toContain(phrase);
    }
  });

  /**
   * Both lists, and evaluated differently.
   *
   * A portfolio rule has no `symbol`, and the runner's first filter is
   * `r && r.symbol` — so shipping them in the same array would drop every one
   * of them silently, which is the shape of the bug `expandRules` was written
   * to fix on the app side. They travel in their own list and are read from
   * their own key.
   */
  it("receives portfolio rules separately, since a symbol filter would drop them", () => {
    expect(runner, "the runner must store the second list").toContain("alertPortfolioRules");
    expect(runner, "and evaluate it against a total").toContain("portfolioMoveNotice");
    const device = readFileSync(join(ROOT, "apps/mobile/src/app/device-alerts.tsx"), "utf8");
    expect(device, "the app must send it").toContain("portfolioRules");
  });

  /**
   * A total from some of its parts is a different portfolio's move, so an
   * unpriced holding must abandon the whole check rather than sum the rest.
   * The app side gets this from `evaluatePortfolioMove`; here it is by hand.
   */
  it("abandons a portfolio check when any holding is unpriced", () => {
    expect(runner).toMatch(/complete\s*=\s*false/);
  });

  /**
   * An outage is not a delisting, and reporting every symbol as broken when
   * the network is down trains people to ignore the one time it is true.
   * Both sides gate on something else having priced.
   */
  it("only reports an unpriced symbol when something else priced", () => {
    expect(runner).toMatch(/rules\.some\(\(r\) => prices\[r\.symbol\]\)/);
    const shared = readFileSync(join(ROOT, "packages/core/src/alert-rules.ts"), "utf8");
    expect(shared, "unpricedSymbols must answer nothing when nothing priced")
      .toMatch(/if \(!wanted\.some\(\(w\) => got\(w\.symbol\)\)\) return \[\];/);
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
