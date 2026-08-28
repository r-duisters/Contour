"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, Plus, Trash2, Upload } from "lucide-react";
import { useDataClient } from "@/data/client/context";
import { useSaveFile } from "./save-file";
import type { ExportFormat } from "@/data/client/data-client";
import type { ImportReport } from "@/data/services/transfer";
import type { Finding } from "@/core/ledger-audit";
import { field } from "./field";
import Button from "./Button";

type PortfolioRow = { id: string; name: string; transactionCount: number };

/**
 * Everything that administers a portfolio rather than reads it: creating,
 * deleting, importing, exporting and restoring. It lives on More so the
 * portfolio screen can be nothing but the money.
 */
/**
 * One plain sentence per finding.
 *
 * Each says what is wrong and what it means for the figures, and none of them
 * says "invalid" — the file is fine. It is the history behind it that has a
 * hole, and telling somebody their export is broken sends them to re-download
 * the wrong thing.
 */
function findingText(f: Finding): string {
  if (f.kind === "underfunded-currency") {
    const when = new Date(f.at).toLocaleDateString();
    return `${f.currency} is short ${f.shortfall.toLocaleString()} by ${when}: more was spent than the ledger shows arriving. Deposits are probably missing.`;
  }
  if (f.kind === "inconsistent-cash-legs") {
    return `Only ${f.withLeg} of ${f.total} ${f.currency} trades record the matching cash movement, so any cash balance drawn from them counts some purchases and not others.`;
  }
  return `${f.symbol}: ${f.shortfall.toLocaleString()} more was sold than was ever bought or received, so some purchases are missing.`;
}

export default function PortfolioManager() {
  const client = useDataClient();
  const saveFile = useSaveFile();
  const [portfolios, setPortfolios] = useState<PortfolioRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  /** A previewed import waiting on a decision: the file, and what it found. */
  const [pending, setPending] = useState<{ csv: string; report: ImportReport } | null>(null);
  const csvRef = useRef<HTMLInputElement>(null);
  const backupRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const rows = await client.listPortfolios().catch(() => null);
    if (!rows) return;
    setPortfolios(rows);
    setSelectedId((cur) => cur ?? rows[0]?.id ?? null);
  }, [client]);
  useEffect(() => { load(); }, [load]);

  async function createPortfolio() {
    if (!newName.trim()) return;
    try {
      const created = await client.createPortfolio(newName.trim());
      setNewName("");
      await load();
      setSelectedId(created.id);
      setMsg(`Created "${created.name}".`);
    } catch (e) {
      // Same shape as the import and restore branches below. Without it a
      // refused or unreachable write leaves the screen silent: the name stays
      // in the box and nothing says why nothing happened.
      setMsg(`Could not create the portfolio: ${(e as Error).message}`);
    }
  }

  async function deletePortfolio() {
    if (!selectedId) return;
    if (!window.confirm("Delete this portfolio and all its transactions?")) return;
    try {
      await client.deletePortfolio(selectedId);
      setSelectedId(null);
      await load();
      setMsg("Portfolio deleted.");
    } catch (e) {
      // The selection is deliberately left alone: the portfolio is still
      // there, so clearing it would tell the opposite of the truth.
      setMsg(`Could not delete the portfolio: ${(e as Error).message}`);
    }
  }

  /**
   * Import in two beats: preview, then commit.
   *
   * The preview is skipped silently when the audit finds nothing, which is the
   * common case — a clean file should not cost a confirmation. A person only
   * meets the panel when their ledger will not balance, and then they are
   * choosing with the findings in front of them rather than after the fact.
   */
  async function importCsv(file: File) {
    if (!selectedId) return;
    setMsg("Checking the file…");
    setPending(null);
    try {
      const csv = await file.text();
      const preview = await client.importCsv(selectedId, csv, { dryRun: true });
      if (preview.audit.length > 0) {
        setPending({ csv, report: preview });
        setMsg(null);
        return;
      }
      await commitImport(csv);
    } catch (e) {
      // A refused import used to be reported from the response body here; the
      // client now carries that same sentence on the error, so both the refusal
      // and an unreachable server land in this one branch.
      setMsg(`Import failed: ${(e as Error).message}`);
    }
  }

  async function commitImport(csv: string) {
    if (!selectedId) return;
    setPending(null);
    setMsg("Importing…");
    try {
      const d = await client.importCsv(selectedId, csv);
      const parts = [`Imported ${d.imported} transactions`];
      if (d.duplicates) parts.push(`${d.duplicates} already present (skipped)`);
      if (d.skipped.length) {
        const shown = d.skipped.slice(0, 3)
          .map((x) => `line ${x.line}: ${x.reason}`).join("; ");
        parts.push(`skipped ${d.skipped.length} (${shown}${d.skipped.length > 3 ? "; …" : ""})`);
      }
      if (d.warnings.length) parts.push(`${d.warnings.length} without a price`);
      setMsg(parts.join(" · "));
      await load();
    } catch (e) {
      setMsg(`Import failed: ${(e as Error).message}`);
    }
  }

  async function clearImported() {
    if (!selectedId) return;
    if (!window.confirm("Remove every transaction that came from a CSV import into this portfolio?")) return;
    try {
      const deleted = await client.clearImported(selectedId);
      setMsg(`Removed ${deleted} imported transactions.`);
      await load();
    } catch (e) {
      setMsg(`Could not remove the imported transactions: ${(e as Error).message}`);
    }
  }

  async function restoreBackup(file: File) {
    setMsg("Restoring…");
    try {
      const backup = await file.text();
      const d = await client.restoreBackup(backup);
      setMsg(`Restored ${d.restored} transactions into "${d.name}".`);
      await load();
      setSelectedId(d.id);
    } catch (e) {
      setMsg(`Restore failed: ${(e as Error).message}`);
    }
  }

  const btn = "text-xs text-neutral-300 inline-flex items-center gap-1 border border-neutral-700 rounded px-2 py-1";

  async function exportAs(format: ExportFormat) {
    if (!selectedId) return;
    try {
      await saveFile(await client.exportFile(selectedId, format));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not export this portfolio.");
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Portfolio data</h2>

      {portfolios.length > 1 && (
        <select
          className={field()}
          value={selectedId ?? ""}
          onChange={(e) => setSelectedId(e.target.value || null)}
        >
          {portfolios.map((p) => (
            <option key={p.id} value={p.id}>{p.name} ({p.transactionCount})</option>
          ))}
        </select>
      )}

      {pending && (
        <div className="border border-amber-900/60 bg-amber-950/20 rounded p-3 space-y-2">
          <p className="flex items-center gap-2 text-sm text-amber-500">
            <AlertTriangle size={14} aria-hidden />
            This file imports cleanly, but the ledger it produces does not balance
          </p>
          <ul className="space-y-1 text-xs text-neutral-400 list-disc pl-4">
            {pending.report.audit.map((f, i) => <li key={i}>{findingText(f)}</li>)}
          </ul>
          <p className="text-xs text-neutral-500">
            {pending.report.imported > 0
              ? `${pending.report.imported} new ${pending.report.imported === 1 ? "transaction is" : "transactions are"} ready to import.`
              : "This file adds nothing new — every row is already here."}
            {" "}Nothing has been written yet. Importing is safe either way; the
            figures will simply be wrong in the ways listed above until the
            missing rows are added.
          </p>
          <div className="flex gap-2 flex-wrap">
            <Button onClick={() => commitImport(pending.csv)}>Import anyway</Button>
            <Button variant="secondary" onClick={() => { setPending(null); setMsg("Import cancelled. Nothing was changed."); }}>
              Cancel and fix the export
            </Button>
          </div>
        </div>
      )}

      <input ref={csvRef} type="file" accept=".csv,text/csv" className="hidden"
             onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = ""; }} />
      <input ref={backupRef} type="file" accept=".json,application/json" className="hidden"
             onChange={(e) => { const f = e.target.files?.[0]; if (f) restoreBackup(f); e.target.value = ""; }} />

      {selectedId && (
        <>
          <div className="flex gap-2 flex-wrap items-center">
            <button onClick={() => csvRef.current?.click()} className={btn}>
              <Upload size={12} aria-hidden />Import Delta CSV
            </button>
            <button onClick={() => backupRef.current?.click()} className={btn}>
              <Upload size={12} aria-hidden />Restore backup…
            </button>
          </div>

          {/* Buttons, not `<a download>` anchors. An anchor cannot work on a
              device — there is no download the viewer can start — so the
              screen asks the client for bytes and hands them to whatever this
              app does with a file. */}
          <div className="flex gap-2 flex-wrap items-center">
            {([
              ["json", "Backup (JSON)"],
              ["csv", "Transactions (CSV)"],
              ["ghostfolio", "Ghostfolio (CSV)"],
            ] as [ExportFormat, string][]).map(([format, label]) => (
              <button key={format} onClick={() => exportAs(format)} className={btn}>
                <Download size={12} aria-hidden />{label}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="flex gap-2 flex-wrap items-center">
        <input
          className={field()}
          placeholder="New portfolio name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && createPortfolio()}
        />
        <button onClick={createPortfolio} className={btn}>
          <Plus size={12} aria-hidden />Create
        </button>
      </div>

      {selectedId && (
        <div className="flex gap-4 flex-wrap items-center pt-1">
          <button onClick={clearImported} className="text-xs underline text-red-500 inline-flex items-center gap-1">
            <Trash2 size={12} aria-hidden />Remove CSV-imported transactions…
          </button>
          <button onClick={deletePortfolio} className="text-xs underline text-red-500 inline-flex items-center gap-1">
            <Trash2 size={12} aria-hidden />Delete portfolio…
          </button>
        </div>
      )}

      {msg && <p className="text-xs text-neutral-400">{msg}</p>}
    </section>
  );
}
