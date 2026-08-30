/**
 * The one file Android's backup is allowed to take.
 *
 * `res/xml/data_extraction_rules.xml` excludes every domain and includes
 * exactly one directory, `files/backup/`. That directory is empty on a fresh
 * install, so a person who never opts in has nothing carried to Google — which
 * is the default the security review of 2026-08-30 argued for and an emulator
 * confirmed.
 *
 * Capacitor's `Directory.Data` is the app's `files/` on Android, so
 * `backup/portfolio.json` under it is exactly what the rules name. The two have
 * to agree and nothing enforces it but this comment and
 * `scripts/android-manifest.test.ts`, which pins the rule side.
 *
 * Every function answers `null` off a phone rather than throwing.
 * `packages/ui` is shared with a web build that has no Capacitor and no Android
 * backup to opt into, and the screen draws nothing for null — the same rule
 * `device-notifications.ts` follows.
 */

/** Matches `<include domain="file" path="backup/" />` in the rules files. */
const DIR = "backup";
const PATH = `${DIR}/portfolio.json`;

async function filesystem() {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return null;
    return await import("@capacitor/filesystem");
  } catch {
    return null;
  }
}

export type BackupState = { present: boolean; at: number | null };

export const deviceBackup = {
  /** Whether a copy is there, and when it was written. Null off a phone. */
  async read(): Promise<BackupState | null> {
    const fs = await filesystem();
    if (!fs) return null;
    try {
      const stat = await fs.Filesystem.stat({ path: PATH, directory: fs.Directory.Data });
      return { present: true, at: typeof stat.mtime === "number" ? stat.mtime : null };
    } catch {
      // `stat` throws for a missing file, which is the ordinary answer here
      // and not a failure worth reporting.
      return { present: false, at: null };
    }
  },

  /** Put a copy where the backup rules can reach it. */
  async write(body: string): Promise<void> {
    const fs = await filesystem();
    if (!fs) return;
    // `recursive` because `files/backup/` does not exist on a fresh install —
    // the rules name a directory Android is willing to take, not one it makes.
    await fs.Filesystem.mkdir({ path: DIR, directory: fs.Directory.Data, recursive: true })
      .catch(() => { /* already there */ });
    await fs.Filesystem.writeFile({
      path: PATH,
      data: body,
      directory: fs.Directory.Data,
      encoding: fs.Encoding.UTF8,
    });
  },

  /** Take it back out. Turning the switch off has to remove what is there. */
  async clear(): Promise<void> {
    const fs = await filesystem();
    if (!fs) return;
    await fs.Filesystem.deleteFile({ path: PATH, directory: fs.Directory.Data })
      .catch(() => { /* nothing to remove */ });
  },

  /**
   * Refresh the copy, but only if one is already there.
   *
   * Called when the app opens. It must never *create* the file: doing so would
   * turn the switch on for somebody who never touched it, which is the exact
   * failure the whole arrangement exists to prevent. A stale backup is a
   * lesser problem than an unasked-for one, so this errs towards doing nothing.
   */
  async refresh(body: () => Promise<string>): Promise<void> {
    const state = await this.read();
    if (!state?.present) return;
    try {
      await this.write(await body());
    } catch {
      // The old copy stays. Failing to refresh costs freshness, not data.
    }
  },
};
