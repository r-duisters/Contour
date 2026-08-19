"use client";

import { useEffect, useId, useState } from "react";

// Shared across all picker instances in the session; the list rarely changes.
let cachedSymbols: string[] | null = null;

export default function SymbolPicker({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (symbol: string) => void;
  className?: string;
}) {
  const listId = useId();
  const [symbols, setSymbols] = useState<string[]>(cachedSymbols ?? []);

  useEffect(() => {
    if (cachedSymbols) return;
    fetch("/api/symbols")
      .then((r) => (r.ok ? r.json() : { symbols: [] }))
      .then((d: { symbols?: string[] }) => {
        cachedSymbols = d.symbols ?? [];
        setSymbols(cachedSymbols);
      })
      .catch(() => {});
  }, []);

  return (
    <>
      <input
        list={listId}
        className={
          className ??
          "bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm uppercase w-32"
        }
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        placeholder="Symbol"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
      />
      <datalist id={listId}>
        {symbols.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </>
  );
}
