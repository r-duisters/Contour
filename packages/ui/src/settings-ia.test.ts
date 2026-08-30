import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Where a control lives, held in place.
 *
 * Three things were filed by proximity rather than by meaning, and each was
 * plausible where it sat — which is why none of them looked wrong until
 * somebody went looking for one and could not find it.
 *
 * Nothing here checks that a screen renders. It checks the arrangement, which
 * is the part that drifts: a control is added next to the thing it is about
 * rather than under the question it answers, and a settings screen slowly
 * becomes a list of everything.
 */

const ui = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url).pathname, "utf8");
const alertsPage = () =>
  readFileSync(new URL("../../../apps/mobile/src/app/alerts/page.tsx", import.meta.url).pathname, "utf8");

describe("what belongs where", () => {
  /**
   * "Tell me about big moves" writes a `pct_move` row with no symbol. That row
   * shows in the alerts list, can be paused there, and deleting it turns the
   * switch off. A control whose effect is a row in a list belongs beside the
   * list — it was in Settings only because the setup flow put it there.
   */
  it("keeps the big-moves rule on the alerts page, not in settings", () => {
    expect(alertsPage()).toContain("BigMoveSetting");
    expect(ui("screens/SettingsScreen.tsx")).not.toContain("BigMoveSetting");
  });

  /**
   * The section should answer whether alerts can reach you, and nothing about
   * what they say. Anything that creates or configures a rule has drifted back.
   */
  it("leaves the notifications section answering only whether alerts arrive", () => {
    const screen = ui("screens/SettingsScreen.tsx");
    expect(screen).toContain("NotificationAccess");
    for (const rule of ["BigMoveSetting", "threshold", "pct_move"]) {
      expect(screen, `SettingsScreen mentions ${rule}, which is an alert rule`).not.toContain(rule);
    }
  });

  /**
   * `privateCoinPrices` spent one build under Display, because that is where
   * the price fields are. It changes what Binance is told and nothing about
   * what is shown.
   */
  it("files the privacy switches under privacy, not display", () => {
    expect(ui("DisplaySettings.tsx")).not.toContain("privateCoinPrices");
    expect(ui("PrivacySettings.tsx")).toContain("privateCoinPrices");
    expect(ui("PrivacySettings.tsx")).toContain("BackupToggle");
  });

  /**
   * The included directory and the path written into it have to agree, and
   * nothing but this connects them: one is Android XML, the other TypeScript.
   */
  it("writes the backup copy into the one directory the rules include", () => {
    const rules = readFileSync(
      new URL("../../../android/app/src/main/res/xml/data_extraction_rules.xml", import.meta.url).pathname,
      "utf8",
    );
    expect(rules).toContain('<include domain="file" path="backup/" />');
    expect(ui("device-backup.ts")).toContain('const DIR = "backup"');
    // Directory.Data is `files/` on Android, which is what domain="file" means.
    expect(ui("device-backup.ts")).toContain("Directory.Data");
  });

  /**
   * The one rule that keeps the switch honest: it reflects whether the file is
   * there, so it can never claim a copy exists that Google does not have.
   */
  it("never creates the backup copy without being asked", () => {
    const backup = ui("device-backup.ts");
    expect(backup).toContain("if (!state?.present) return;");
  });
});
