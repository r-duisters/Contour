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

describe("what the app asks the phone for", () => {
  /**
   * `@capacitor/background-runner` declares three location permissions in its
   * own manifest and the merger pulls them in. They are removed with
   * `tools:node="remove"`, which is a line that looks like boilerplate and is
   * not: without it a portfolio tracker asks for background location.
   */
  it("declares no location permission", () => {
    for (const p of ["ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION", "ACCESS_BACKGROUND_LOCATION"]) {
      const declared = new RegExp(`<uses-permission[^>]*android:name="android.permission.${p}"(?![^>]*tools:node="remove")`);
      expect(manifest(), `${p} is declared without tools:node="remove"`).not.toMatch(declared);
    }
  });
});
