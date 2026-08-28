"use client";

import { useRef, useState } from "react";
import { IMPORT_FORMATS, type FormatId } from "@/lib/import-formats";
import MarkTile from "./MarkTile";

/**
 * Where a portfolio can come from, as something to point at.
 *
 * A bare file input asks a person to already know whether their export will be
 * understood. This says so before they choose, which is most of the value: the
 * answer to "will this work with my Kraken export" should be visible, not
 * discovered.
 *
 * **Monograms rather than real logos.** Each tile carries the source's own
 * brand colour and its initial, not its mark. Shipping other companies' logos
 * means shipping their trademarks, in an app that has no licence to and no
 * LICENSE file of its own yet, and a wrong or outdated logo looks worse than
 * no logo at all. The colours do the recognising — Binance's yellow and
 * Coinbase's blue are read before any lettering is.
 *
 * Tapping a tile opens the file picker with that reader pinned, which is how
 * someone whose file was misread, or was not recognised at all, gets it in
 * anyway. Choosing the plain file input instead lets the header decide.
 */
export default function ImportSources({
  onFile,
  busy = false,
}: {
  /** `format` is undefined when the source was not pinned — detect it. */
  onFile: (file: File, format?: FormatId) => void;
  busy?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [pinned, setPinned] = useState<FormatId | undefined>(undefined);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {/* The app's own backup gets the app's own mark, not a letter — it is
            the one source here whose logo this project may actually use. */}
        <Tile
          label="Contour"
          hint="Backup"
          badge={<MarkTile size={36} round="tile" />}
          onClick={() => { setPinned(undefined); input.current?.click(); }}
          disabled={busy}
        />
        {IMPORT_FORMATS.map((f) => (
          <Tile
            key={f.id}
            label={f.label}
            hint={f.hint}
            monogram={f.monogram}
            accent={f.accent}
            onClick={() => { setPinned(f.id); input.current?.click(); }}
            disabled={busy}
          />
        ))}
        <Tile
          label="Other"
          hint="Any CSV"
          monogram="+"
          accent="#525252"
          onClick={() => { setPinned("generic"); input.current?.click(); }}
          disabled={busy}
        />
      </div>

      <input
        ref={input}
        type="file"
        accept=".json,.csv,text/csv,application/json"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Cleared so choosing the same file twice still fires a change.
          e.target.value = "";
          if (file) onFile(file, pinned);
        }}
      />

      <button
        type="button"
        disabled={busy}
        onClick={() => { setPinned(undefined); input.current?.click(); }}
        className="w-full text-xs text-neutral-500 underline disabled:opacity-50"
      >
        Or choose a file and let Contour work out what it is
      </button>
    </div>
  );
}

function Tile({
  label, hint, monogram, accent, badge, onClick, disabled,
}: {
  label: string; hint: string; monogram?: string; accent?: string;
  badge?: React.ReactNode;
  onClick: () => void; disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      // The file's name is the hint, and it belongs on the control rather than
      // under it: a third line at a size below the type scale is how a grid
      // like this stops being readable.
      title={`${label} — ${hint}`}
      aria-label={`Import from ${label}: ${hint}`}
      className="flex flex-col items-center gap-1.5 rounded border border-neutral-800 p-2.5
                 hover:border-neutral-600 disabled:opacity-50 transition-colors"
    >
      {badge ?? (
        <span
          className="w-9 h-9 rounded-lg flex items-center justify-center text-base font-semibold text-white"
          style={{ backgroundColor: accent }}
          aria-hidden
        >
          {monogram}
        </span>
      )}
      <span className="text-xs leading-tight">{label}</span>
    </button>
  );
}
