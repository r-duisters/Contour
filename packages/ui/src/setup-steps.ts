/**
 * The two decisions the first-run flow makes that are worth testing without a
 * browser. Everything else it does is a form.
 */

/** A file someone picked to import: a full backup, or a Delta CSV. */
export type ImportKind = "backup" | "csv";

/**
 * What kind of file this is.
 *
 * The content decides, and the filename is not consulted at all. Phones rename
 * downloads, share sheets hand over `content://` paths with no extension, and
 * a backup saved from a browser arrives as `backup.json.txt` — a name is the
 * least reliable thing about a file on a handset. A backup is JSON with a
 * portfolio in it; a Delta export is not JSON at all.
 *
 * Anything else is called a CSV so the importer can produce a real error about
 * the row it choked on. "That backup would not load" is true of every file
 * that is not one, and tells a person nothing.
 */
export function importKindOf(text: string): ImportKind {
  if (text.trimStart().startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as { portfolio?: unknown };
      if (parsed && typeof parsed === "object" && "portfolio" in parsed) return "backup";
    } catch {
      // Not valid JSON despite the opening brace.
    }
  }
  return "csv";
}

/**
 * Whether the first-run flow should run.
 *
 * Two conditions, and both matter. An empty app needs it; an app with a
 * portfolio does not, even on a phone it has never run on before — restoring
 * a backup elsewhere and reinstalling must not throw someone back into the
 * wizard. And a person who skipped it is not asked again, which is the whole
 * meaning of "skip".
 */
export function needsSetup({
  portfolioCount,
  dismissed,
}: {
  portfolioCount: number;
  dismissed: boolean;
}): boolean {
  return portfolioCount === 0 && !dismissed;
}
