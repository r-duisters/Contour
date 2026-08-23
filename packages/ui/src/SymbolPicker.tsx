"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useDataClient } from "@/data/client/context";

// Shared across all picker instances in the session; the list rarely changes.
let cachedSymbols: string[] | null = null;

const POPULAR = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
  "ADAUSDT", "DOGEUSDT", "LINKUSDT", "AVAXUSDT", "LTCUSDT",
];

export default function SymbolPicker({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (symbol: string) => void;
  className?: string;
}) {
  const client = useDataClient();
  const [symbols, setSymbols] = useState<string[]>(cachedSymbols ?? []);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null); // null = not editing
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (cachedSymbols) { setSymbols(cachedSymbols); return; }
    client.listSymbols()
      .then((list) => {
        cachedSymbols = list;
        setSymbols(list);
      })
      .catch(() => {});
  }, [client]);

  // Close when tapping/clicking anywhere outside.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) { setOpen(false); setQuery(null); }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const shown = useMemo(() => {
    const q = (query ?? "").trim().toUpperCase();
    if (!q) {
      const popular = POPULAR.filter((s) => symbols.length === 0 || symbols.includes(s));
      const rest = symbols.filter((s) => !popular.includes(s));
      return [...popular, ...rest].slice(0, 50);
    }
    const starts = symbols.filter((s) => s.startsWith(q));
    const contains = symbols.filter((s) => !s.startsWith(q) && s.includes(q));
    return [...starts, ...contains].slice(0, 50);
  }, [symbols, query]);

  function pick(s: string) {
    onChange(s);
    setQuery(null);
    setOpen(false);
  }

  return (
    <div ref={wrapRef} className="relative inline-block">
      <input
        className={`${
          className ??
          "bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm uppercase w-36"
        } pr-7`}
        value={query ?? value}
        onFocus={() => { setOpen(true); setQuery(""); }}
        onChange={(e) => { setQuery(e.target.value.toUpperCase()); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && query) { pick(shown[0] ?? query); }
          if (e.key === "Escape") { setQuery(null); setOpen(false); }
        }}
        placeholder={value || "Symbol"}
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
      />
      <button
        type="button"
        aria-label="Choose symbol"
        className="absolute right-1 top-1/2 -translate-y-1/2 text-neutral-400 px-1"
        onClick={() => {
          if (open) { setOpen(false); setQuery(null); }
          else { setOpen(true); setQuery(""); }
        }}
      >
        <ChevronDown size={12} aria-hidden />
      </button>

      {open && (
        <ul className="absolute left-0 top-full mt-1 z-50 w-48 max-h-64 overflow-y-auto bg-neutral-900 border border-neutral-700 rounded shadow-lg shadow-black/50">
          {shown.map((s) => (
            <li key={s}>
              <button
                type="button"
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-neutral-800 ${
                  s === value ? "text-blue-400" : "text-neutral-200"
                }`}
                onClick={() => pick(s)}
              >
                {s}
              </button>
            </li>
          ))}
          {shown.length === 0 && (
            <li className="px-3 py-2 text-sm text-neutral-500">
              {symbols.length === 0 ? "Loading symbols…" : "No matches"}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
