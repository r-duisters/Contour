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

/**
 * The file with its block comments removed.
 *
 * The vocabulary check below is about what a person reads on screen, and this
 * codebase keeps its reasoning in block comments — including, in
 * `DailyMoveSetting`, a note explaining what the old name was and why it
 * changed. Grepping the raw text finds that note and fails for the reason the
 * file was written well. Line comments are left alone: stripping them would
 * also eat the `//` in a URL.
 */
const copyOf = (name: string) => ui(name).replace(/\/\*[\s\S]*?\*\//g, "");
const alertsPage = () =>
  readFileSync(new URL("../../../apps/mobile/src/app/alerts/page.tsx", import.meta.url).pathname, "utf8");

describe("what belongs where", () => {
  /**
   * "Tell me about big moves" writes a `pct_move` row with no symbol. That row
   * shows in the alerts list, can be paused there, and deleting it turns the
   * switch off. A control whose effect is a row in a list belongs beside the
   * list — it was in Settings only because the setup flow put it there.
   */
  it("keeps the daily-move rule on the alerts page, not in settings", () => {
    expect(alertsPage()).toContain("DailyMoveSetting");
    expect(ui("screens/SettingsScreen.tsx")).not.toContain("DailyMoveSetting");
  });

  /**
   * The daily-move rule is a stored alert, so it arrived in the list as well
   * as in its own switch — one rule shown twice, and the two disagreed: the
   * switch said "on" while the row said "Every holding · 5%", and pausing the
   * row left the switch still reading as on.
   */
  it("shows the daily-move rule once, not in the list as well", () => {
    expect(alertsPage()).toContain("const isDailyMove");
    expect(alertsPage()).toContain("filter((a) => !isDailyMove(a))");
  });

  /**
   * "Big moves" is how somebody describes the feature to a friend. The app has
   * one alert kind with a proper name already — a price target — and this is
   * the other one.
   */
  it("uses the app's own vocabulary for the two alert kinds", () => {
    for (const file of ["DailyMoveSetting.tsx", "screens/SetupScreen.tsx"]) {
      expect(copyOf(file), `${file} still says "big moves"`).not.toMatch(/big moves/i);
    }
    expect(alertsPage().replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/big moves/i);
    /*
     * And the notification body, which is copy a person reads and the one
     * place a rename does not reach: nobody re-opens the string that a phone
     * shows at 6am to check it still matches a switch on a settings screen.
     * It kept saying “big moves” for exactly that reason.
     */
    const copy = readFileSync(
      new URL("../../core/src/alert-copy.ts", import.meta.url).pathname, "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(copy, "the notification still says \"big moves\"").not.toMatch(/big moves/i);
  });

  /**
   * The section should answer whether alerts can reach you, and nothing about
   * what they say. Anything that creates or configures a rule has drifted back.
   */
  it("leaves the notifications section answering only whether alerts arrive", () => {
    const screen = ui("screens/SettingsScreen.tsx");
    expect(screen).toContain("NotificationAccess");
    for (const rule of ["DailyMoveSetting", "threshold", "pct_move"]) {
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
    // And the price sources are not a display question either: which currency
    // to show is, where the number came from is not.
    expect(ui("DisplaySettings.tsx")).not.toContain("equityProvider");
    expect(ui("PriceSourceSettings.tsx")).toContain("equityProvider");
    expect(ui("PriceSourceSettings.tsx")).toContain("Coin price source");
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
