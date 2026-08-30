"use client";

import { useCallback, useEffect, useState } from "react";
import { useDataClient } from "@/data/client/context";
import Switch from "./Switch";
import { deviceBackup } from "./device-backup";

/**
 * Whether to let Android's own backup carry a copy of the portfolio.
 *
 * The app used to be in Android Auto Backup by default, because that is the
 * default and nobody had said otherwise: the whole data directory, the
 * unencrypted database included, uploaded to the owner's Google Drive. That
 * was measured on an emulator — a 4.45 MB blob holding `contourSQLite.db` and
 * the WebView's storage — and excluded in
 * `res/xml/data_extraction_rules.xml`.
 *
 * Excluding it entirely would also have closed the door on the thing worth
 * having. A phone that dies with the only copy of a ledger on it is a real way
 * to lose years of records, and "back it up" is a reasonable thing to want.
 * What was wrong was that it happened to everybody without being asked.
 *
 * So: one directory is included, `files/backup/`, and it is empty until this
 * switch fills it. **The switch is the file.** There is no stored flag, because
 * a flag and a directory can disagree and then the screen would be describing
 * something other than what Google has.
 *
 * What goes in is the app's own export, not the database. A raw SQLite file
 * from an older schema is a migration problem on restore; the export is the one
 * format this app reads from any version of itself, and it is the same file a
 * person gets from Portfolio data.
 */
export default function BackupToggle({ portfolioId }: { portfolioId: string | null }) {
  const client = useDataClient();
  const [on, setOn] = useState<boolean | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Reading is a promise away, always. `deviceBackup.read` imports Capacitor
   * lazily, so nothing here can settle in the same tick as the render — which
   * is also why the effect owns a cancel flag rather than calling a `useCallback`
   * that sets state: a switch unmounted mid-read must not write to it.
   */
  const [reads, setReads] = useState(0);
  const read = useCallback(() => setReads((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const state = await deviceBackup.read();
      if (cancelled) return;
      if (state === null) { setOn(null); return; }   // not a phone
      setOn(state.present);
      setAt(state.at);
    })();
    return () => { cancelled = true; };
  }, [reads]);

  // A browser has no Android backup to opt into. Draw nothing rather than a
  // switch that would describe someone else's platform.
  if (on === null) return null;

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      if (!next) {
        await deviceBackup.clear();
      } else if (portfolioId) {
        const file = await client.exportFile(portfolioId, "json");
        await deviceBackup.write(file.body);
      } else {
        setError("No portfolio to back up yet.");
      }
      read();
    } catch {
      setError("Could not change the backup. Nothing was sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm">Include a copy in Google backup</div>
          <p className="text-xs text-neutral-500 mt-0.5">
            Android backs some apps up to your Google Drive. Contour is left out of
            that unless you switch this on — and even then it is an export of your
            transactions, never the database itself. Off, nothing of yours leaves the
            phone this way.
          </p>
        </div>
        <Switch
          checked={on}
          onChange={(next) => { if (!busy) void toggle(next); }}
          label="Include a copy in Google backup"
        />
      </div>
      {/*
        The date matters more than it looks. The copy is written when the
        switch goes on and refreshed when the app opens, so a person who
        switched it on in March and is reading this in August should be able to
        see which of those they have.
      */}
      {on && at !== null && (
        <p className="text-xs text-neutral-500 mt-2">
          Copied {new Date(at).toLocaleDateString(undefined, {
            day: "numeric", month: "short", year: "numeric",
          })}.
        </p>
      )}
      {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
    </div>
  );
}
