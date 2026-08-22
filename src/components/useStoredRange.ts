"use client";

import { useCallback, useEffect, useState } from "react";
import { readKey } from "@/lib/storage-keys";

/**
 * A chart period that survives leaving the page.
 *
 * The stored value is read after mount, not during render: the server has no
 * localStorage, and rendering a different period than the HTML said would be
 * a hydration mismatch. `ready` lets callers hold their fetch until the real
 * period is known, so switching pages costs one request rather than two.
 */
export function useStoredRange<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[],
): [T, (next: T) => void, boolean] {
  const [range, setRange] = useState<T>(fallback);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = readKey(key) as T | null;
    if (stored && allowed.includes(stored)) setRange(stored);
    setReady(true);
    // `allowed` is a module-level constant at every call site.
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = useCallback((next: T) => {
    setRange(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      // remembering is a convenience, not a requirement
    }
  }, [key]);

  return [range, update, ready];
}
