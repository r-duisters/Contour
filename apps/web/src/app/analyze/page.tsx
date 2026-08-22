"use client";

import { FlaskConical } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type Severity = "warning" | "info" | "suggestion";
type Finding = {
  id: string;
  severity: Severity;
  category: string;
  line?: number;
  excerpt?: string;
  message: string;
  fix?: string;
};
type ScriptMeta = { name: string; bytes: number };

// Amber is the app's warning colour and red means a loss, so a red "warning"
// row read as money lost rather than as a defect in the script.
const SEVERITY_COLOR: Record<Severity, string> = {
  warning: "text-amber-400 bg-amber-950/40 border-amber-900",
  info: "text-blue-400 bg-blue-950/40 border-blue-900",
  suggestion: "text-neutral-300 bg-neutral-900 border-neutral-800",
};

// IDs that have automated transformers. Keep in sync with apply.ts.
const AUTOMATABLE = new Set<string>([
  "dead-input:takeProfitSelected",
  "dead-input:takeProfitPercent",
  "dead-input:stopLossSelected",
  "dead-input:stopLossPercent",
  "dead-input:takeProfitPrice",
  "dead-input:stopLossPrice",
  "correctness:trading-capital-negative",
  "correctness:sell-qty-from-capital",
  "documentation:copy-paste-log",
  "robustness:unlatched-95-sell",
  "robustness:end-date-stops-trading",
  "robustness:no-symbol-guard",
]);
const isAutomatable = (id: string) =>
  AUTOMATABLE.has(id) || id.startsWith("repaint:lookahead-");

export default function AnalyzePage() {
  const [scripts, setScripts] = useState<ScriptMeta[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [source, setSource] = useState("");
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<string | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);

  // Load the library on mount.
  useEffect(() => {
    fetch("/api/scripts")
      .then((r) => r.json())
      .then((d: { scripts: ScriptMeta[] }) => {
        setScripts(d.scripts);
        if (d.scripts.length > 0 && !selected) {
          loadScript(d.scripts[0]!.name);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadScript(name: string) {
    setSelected(name);
    setPreview(null);
    setSavedName(null);
    setFindings(null);
    setSummary(null);
    setPicked(new Set());
    const r = await fetch(`/api/scripts/${encodeURIComponent(name)}`);
    const d = await r.json();
    setSource(d.source ?? "");
  }

  async function analyze() {
    if (!source.trim()) return;
    setBusy(true); setPreview(null); setSavedName(null);
    try {
      const r = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      });
      const d = await r.json();
      setFindings(d.findings);
      setSummary(d.summary);
      // pre-select every automatable finding
      setPicked(new Set((d.findings as Finding[]).filter((f) => isAutomatable(f.id)).map((f) => f.id)));
    } finally {
      setBusy(false);
    }
  }

  async function previewFixes() {
    setBusy(true);
    try {
      const r = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, apply: [...picked] }),
      });
      const d = await r.json();
      setPreview(d.source);
      setFindings(d.findings);
      setSummary(d.summary);
    } finally {
      setBusy(false);
    }
  }

  async function saveAsNew() {
    if (!preview) return;
    setBusy(true);
    try {
      const r = await fetch("/api/scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: preview,
          derivedFrom: selected || "untitled.pine",
          suffix: "fixes",
        }),
      });
      const d = await r.json();
      setSavedName(d.name);
      // refresh library so the new file appears in the dropdown
      const list = await fetch("/api/scripts").then((x) => x.json());
      setScripts(list.scripts);
    } finally {
      setBusy(false);
    }
  }

  const togglePick = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const automatableCount = useMemo(
    () => (findings ?? []).filter((f) => isAutomatable(f.id)).length,
    [findings],
  );

  return (
    <main className="min-h-screen md:min-h-[calc(100vh-3.5rem)] px-4 py-5 md:p-8 max-w-5xl mx-auto">
      <h1 className="text-xl md:text-2xl font-semibold mb-2 flex items-center gap-2"><FlaskConical size={20} aria-hidden className="text-neutral-400" />PineScript review</h1>
      <p className="text-sm text-neutral-500 mb-6">
        Pick a script from the library or paste your own. Run the analyzer, choose which fixes to
        apply, preview the result, and save as a new version.
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <label className="text-sm">
          <span className="text-neutral-400 mr-2">Library:</span>
          <select
            className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm"
            value={selected}
            onChange={(e) => loadScript(e.target.value)}
          >
            {scripts.length === 0 && <option value="">(no scripts found)</option>}
            {scripts.map((s) => (
              <option key={s.name} value={s.name}>{s.name} · {s.bytes}b</option>
            ))}
          </select>
        </label>
        <button
          onClick={() => { setSelected(""); setSource(""); setFindings(null); setPreview(null); setSavedName(null); }}
          className="text-xs underline text-neutral-400"
        >
          Paste new
        </button>
      </div>

      <textarea
        className="w-full h-64 bg-neutral-900 border border-neutral-700 rounded p-3 font-mono text-xs"
        placeholder="// @version=5&#10;strategy(...)"
        value={source}
        onChange={(e) => { setSource(e.target.value); setPreview(null); setSavedName(null); }}
      />

      <div className="mt-3 flex gap-2 items-center">
        <button onClick={analyze} disabled={busy || !source.trim()}
                className="bg-blue-600 disabled:opacity-50 text-white rounded px-3 py-1 text-sm">
          {busy ? "Working…" : "Analyse"}
        </button>
        {findings !== null && (
          <button
            onClick={previewFixes}
            disabled={busy || picked.size === 0}
            className="bg-blue-600 disabled:opacity-50 text-white rounded px-3 py-1 text-sm"
          >
            Apply {picked.size} fix{picked.size === 1 ? "" : "es"}
          </button>
        )}
        {summary && <span className="text-xs text-neutral-400">{summary}</span>}
        {findings !== null && automatableCount > 0 && (
          <span className="text-xs text-neutral-500">· {automatableCount} auto-fixable</span>
        )}
      </div>

      {findings && (
        <ul className="mt-6 space-y-3">
          {findings.map((f) => {
            const auto = isAutomatable(f.id);
            return (
              <li key={f.id + (f.line ?? "")} className={`border rounded p-3 ${SEVERITY_COLOR[f.severity]}`}>
                <div className="flex gap-2 items-baseline text-xs uppercase tracking-wide">
                  <input
                    type="checkbox"
                    disabled={!auto}
                    checked={picked.has(f.id)}
                    onChange={() => togglePick(f.id)}
                    className="mr-1"
                    title={auto ? "auto-fixable" : "no automated fix — apply manually"}
                  />
                  <span>{f.severity}</span>
                  <span className="text-neutral-500">·</span>
                  <span>{f.category}</span>
                  {f.line && (<><span className="text-neutral-500">·</span><span>line {f.line}</span></>)}
                  {!auto && <span className="text-neutral-500 ml-2 italic">(manual)</span>}
                  <span className="text-neutral-600 ml-auto font-mono">{f.id}</span>
                </div>
                <p className="text-sm text-neutral-200 mt-2">{f.message}</p>
                {f.excerpt && (
                  <pre className="mt-2 text-xs text-neutral-400 bg-black/40 rounded p-2 overflow-x-auto">{f.excerpt}</pre>
                )}
                {f.fix && (
                  <div className="mt-2 text-xs">
                    <div className="text-neutral-500 mb-1">Suggested fix:</div>
                    <pre className="text-neutral-200 bg-black/40 rounded p-2 overflow-x-auto whitespace-pre-wrap">{f.fix}</pre>
                  </div>
                )}
              </li>
            );
          })}
          {findings.length === 0 && (
            <li className="text-sm text-neutral-500">No issues detected.</li>
          )}
        </ul>
      )}

      {preview && (
        <section className="mt-8 border-t border-neutral-800 pt-6">
          <div className="flex items-center gap-3 mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Preview</h2>
            <button onClick={saveAsNew} disabled={busy} className="bg-blue-600 text-white rounded px-3 py-1 text-sm">
              Save as new version
            </button>
            {savedName && <span className="text-xs text-neutral-400">Saved as {savedName}</span>}
          </div>
          <pre className="bg-black/60 border border-neutral-800 rounded p-3 text-xs font-mono overflow-x-auto max-h-[60vh]">{preview}</pre>
        </section>
      )}
    </main>
  );
}
