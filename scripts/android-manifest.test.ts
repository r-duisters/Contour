import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The manifest decisions that protect the portfolio, held in place.
 *
 * Every one of these is a single attribute or a single line of XML, and every
 * one of them was wrong for months without anything noticing — which is the
 * argument for the file. A test suite that runs on every push is the only
 * thing in this repository that reads the manifest at all.
 *
 * See `docs/security-review-2026-08-30.md` for what each one cost.
 */

const RES = new URL("../android/app/src/main/res/", import.meta.url).pathname;
const MANIFEST = new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url).pathname;

/**
 * The file with its comments stripped.
 *
 * These files explain themselves at length, and several of the comments quote
 * the element they removed — `file_paths.xml` names `<external-path>` in prose
 * precisely to say why it is gone. A test that greps the raw text then finds
 * the thing it is asserting is absent, and fails for the reason the file was
 * written well.
 */
const withoutComments = (path: string) => readFileSync(path, "utf8").replace(/<!--[\s\S]*?-->/g, "");

const manifest = () => withoutComments(MANIFEST);
const xml = (name: string) => withoutComments(`${RES}xml/${name}`);

describe("what Android Auto Backup may take", () => {
  /**
   * The default is the whole app data directory, database included, uploaded
   * to the owner's Google Drive. An app whose premise is that the portfolio
   * stays on the phone cannot inherit that default, and inheriting it is what
   * happens when these two attributes are absent — silently, with no error and
   * nothing on screen.
   */
  it("names both rules files, since neither covers every Android version", () => {
    expect(manifest()).toContain('android:dataExtractionRules="@xml/data_extraction_rules"');
    expect(manifest()).toContain('android:fullBackupContent="@xml/backup_rules"');
  });

  /**
   * Naming an `<include>` at all is what excludes the rest: from that point
   * Android backs up only the listed paths.
   *
   * These files used to spell the exclusions out as well, five `<exclude>`
   * lines per file, added as belt and braces. They were inert, and the first
   * release build ever attempted refused them — `lintVitalRelease` reports "`.`
   * is not in an included path", because an exclude outside the included set
   * can never apply. So the assertion is the opposite of what it was: an
   * exclude here is a sign somebody has misread how the file works, and it
   * will stop the release build.
   */
  it("limits the backup by including one path, and excludes nothing", () => {
    for (const name of ["backup_rules.xml", "data_extraction_rules.xml"]) {
      const rules = xml(name);
      expect(rules, `${name} has no include, so the whole app data dir is backed up`)
        .toContain('<include domain="file" path="backup/" />');
      expect(rules, `${name} has an <exclude>, which lintVitalRelease rejects`)
        .not.toContain("<exclude");
    }
  });

  /**
   * `device-transfer` is the phone-to-phone copy and never reaches Google, so
   * it is the more defensible of the two — which is exactly why it is worth a
   * test. It would be an easy thing to leave open by omission.
   */
  it("limits the device-to-device transfer as well as the cloud one", () => {
    const rules = xml("data_extraction_rules.xml");
    const transfer = rules.slice(rules.indexOf("<device-transfer>"));
    expect(transfer).toContain('<include domain="file" path="backup/" />');
  });

  /**
   * One included directory, empty until somebody opts in. Backup is not turned
   * off — it is turned down to nothing and given a way back up.
   */
  it("leaves a way in for the opt-in", () => {
    for (const name of ["backup_rules.xml", "data_extraction_rules.xml"]) {
      expect(xml(name)).toContain('<include domain="file" path="backup/" />');
    }
  });
});

describe("what may be handed to another app", () => {
  /**
   * `save-file.ts` writes exports to `Directory.Cache` and shares the URI.
   * That is the only filesystem use in the device build, so it is the only
   * path this provider needs. It shipped with Capacitor's template — all of
   * external storage as well — which was surface rather than exposure, on the
   * one component whose job is handing file access to other applications.
   */
  it("exposes the cache and nothing else", () => {
    const paths = xml("file_paths.xml");
    expect(paths).toContain("<cache-path");
    expect(paths).not.toContain("<external-path");
    expect(paths).not.toContain("<external-files-path");
    expect(paths).not.toContain("<root-path");
  });
});

/**
 * A `<uses-permission>` for `name` that is not a removal.
 *
 * The negative lookahead is the whole point: `tools:node="remove"` uses the
 * same element to mean the opposite thing, and a test that just greps for the
 * permission name would read a removal as a declaration.
 */
const declaring = (name: string) =>
  new RegExp(`<uses-permission[^>]*android:name="android.permission.${name}"(?![^>]*tools:node="remove")`);

describe("what the app asks the phone for", () => {
  /**
   * `@capacitor/background-runner` declares three location permissions in its
   * own manifest and the merger pulls them in. They are removed with
   * `tools:node="remove"`, which is a line that looks like boilerplate and is
   * not: without it a portfolio tracker asks for background location.
   */
  it("declares no location permission", () => {
    for (const p of ["ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION", "ACCESS_BACKGROUND_LOCATION"]) {
      expect(manifest(), `${p} is declared without tools:node="remove"`).not.toMatch(declaring(p));
    }
  });

  /**
   * The two Google Play forbids this app, and the reason it can afford to lose
   * both.
   *
   * `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` buys Android's one-tap "let this run
   * in the background" dialog. Play permits it only where doze breaks the core
   * function — calling apps, safety apps, task automation, peripheral
   * companions — and a price-alert tracker is on none of those lists. Without
   * it `BatteryOptimizationPlugin` opens the battery-optimisation *list*
   * instead: same destination, no permission, one tap further away.
   *
   * `SCHEDULE_EXACT_ALARM` arrives from `@capacitor/local-notifications` and
   * `@capacitor/background-runner`, both of which *can* schedule a notification
   * for a time. This app never does — every `LocalNotifications.schedule` call
   * omits the `schedule` field, which posts immediately and sets no alarm — so
   * removing it removes nothing that runs. Play treats it as restricted and
   * expects a declaration naming an alarm-clock or calendar use case this app
   * does not have.
   *
   * Both are one line to add back, and neither would fail anything else here:
   * the app would build, install and run, and the rejection would arrive weeks
   * later from a review queue.
   */
  it("declares no permission Google Play restricts", () => {
    for (const p of ["REQUEST_IGNORE_BATTERY_OPTIMIZATIONS", "SCHEDULE_EXACT_ALARM"]) {
      expect(manifest(), `${p} is declared, and Play rejects this app for it`)
        .not.toMatch(declaring(p));
    }
  });

  /**
   * A dependency declares `SCHEDULE_EXACT_ALARM`, so leaving it out of our own
   * manifest is not enough — the merger folds it back in. Only the explicit
   * removal keeps it out of the built APK, and the test above passes either
   * way, which is why this one exists beside it.
   */
  it("removes the exact-alarm permission its dependencies declare", () => {
    expect(manifest())
      .toContain('<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" tools:node="remove" />');
  });
});

describe("what the Android build is allowed to depend on", () => {
  const gradle = (p: string) =>
    readFileSync(new URL(`../android/${p}`, import.meta.url).pathname, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  /**
   * Nothing proprietary, and the reason is not purity.
   *
   * F-Droid builds from source using free dependencies only, and
   * `com.google.gms:google-services` was on the buildscript classpath because
   * Capacitor's template puts it there. A classpath entry is fetched whether
   * or not the plugin is ever applied, so every build pulled a proprietary
   * artifact from Google's Maven — for Firebase, which this app does not have
   * and, by the direction in CLAUDE.md, cannot have: push needs Google, an
   * account and a server to push from.
   *
   * Comments are stripped before the check because the file now explains at
   * length why the dependency is absent, and a test that greps raw text would
   * read that explanation as the thing it forbids.
   */
  it("pulls no proprietary Google artifact", () => {
    for (const f of ["build.gradle", "app/build.gradle"]) {
      expect(gradle(f), `${f} references a proprietary Google plugin`)
        .not.toMatch(/com\.google\.(gms|firebase)/);
    }
  });

  /**
   * The one prebuilt binary in the build, named so it stays visible.
   *
   * `@capacitor/background-runner` ships `android-js-engine-release.aar` — 2.4
   * MB, compiled elsewhere, no source in the package — and the `flatDir` below
   * is what puts it on the classpath. It runs the half-hourly alert check, so
   * it is not removable without losing that.
   *
   * This asserts the situation rather than forbidding it: F-Droid rejects
   * prebuilt binaries, so anyone reading this should know the blocker exists
   * and where it lives before wondering why the app is not listed.
   */
  it("has exactly one prebuilt binary on the classpath, and it is the JS engine", () => {
    const app = gradle("app/build.gradle");
    expect(app).toContain("@capacitor/background-runner/android/src/main/libs");
    const flatDirs = [...app.matchAll(/dirs\s+'([^']+)'/g)].map((m) => m[1]);
    expect(flatDirs, "a new flatDir means a new prebuilt binary — see F-Droid conformance")
      .toEqual([
        "../capacitor-cordova-android-plugins/src/main/libs",
        "../../node_modules/@capacitor/background-runner/android/src/main/libs",
      ]);
  });
});
