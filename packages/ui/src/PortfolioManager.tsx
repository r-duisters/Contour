"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Plus, Trash2, Upload } from "lucide-react";
import { useDataClient } from "@/data/client/context";

type PortfolioRow = { id: string; name: string; transactionCount: number };

/**
 * Everything that administers a portfolio rather than reads it: creating,
 * deleting, importing, exporting and restoring. It lives on More so the
 * portfolio screen can be nothing but the money.
 */
export default function PortfolioManager() {
  const client = useDataClient();
  const [portfolios, setPortfolios] = useState<PortfolioRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
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

  async function importCsv(file: File) {
    if (!selectedId) return;
    setMsg("Importing…");
    try {
      const csv = await file.text();
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
      // A refused import used to be reported from the response body here; the
      // client now carries that same sentence on the error, so both the refusal
      // and an unreachable server land in this one branch.
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

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Portfolio data</h2>

      {portfolios.length > 1 && (
        <select
          className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm"
          value={selectedId ?? ""}
          onChange={(e) => setSelectedId(e.target.value || null)}
        >
          {portfolios.map((p) => (
            <option key={p.id} value={p.id}>{p.name} ({p.transactionCount})</option>
          ))}
        </select>
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

          <div className="flex gap-2 flex-wrap items-center">
            <a href={`/api/portfolios/${selectedId}/export?format=json`} className={btn}>
              <Download size={12} aria-hidden />Backup (JSON)
            </a>
            <a href={`/api/portfolios/${selectedId}/export?format=csv`} className={btn}>
              <Download size={12} aria-hidden />Transactions (CSV)
            </a>
            <a href={`/api/portfolios/${selectedId}/export?format=ghostfolio`} className={btn}>
              <Download size={12} aria-hidden />Ghostfolio (CSV)
            </a>
          </div>
        </>
      )}

      <div className="flex gap-2 flex-wrap items-center">
        <input
          className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm"
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
