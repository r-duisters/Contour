"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Valuation as ServiceValuation } from "@/data/services/valuation";
import { readCachedValuation, writeCachedValuation } from "@/core/valuation-cache";
import { KEYS, readKey } from "@/lib/storage-keys";

/**
 * Last night's numbers, on screen before the network answers.
 *
 * Read after mount rather than during render, for the reason `useStoredRange`
 * gives: the server has no `localStorage`, and rendering figures the HTML did
 * not contain is a hydration mismatch.
 *
 * `at` is what the screen shows to say the numbers are stale, and it clears
 * the moment `remember` is handed a fresh valuation — so the note is tied to
 * the data actually on screen rather than to whether a request is in flight.
 */
export function useCachedValuation<V = ServiceValuation>(portfolioId: string | null): {
  cached: V | null;
  at: number | null;
  remember: (portfolioId: string, valuation: V) => void;
} {
  // Generic over the valuation's shape because the cache does not read it —
  // it stores and returns whatever the screen already renders. Screens
  // describe the same response with types of differing precision, and forcing
  // one of them here would widen a holding until the fields it draws vanish.
  const [cached, setCached] = useState<V | null>(null);
  const [at, setAt] = useState<number | null>(null);
  // Which portfolio the state above describes, held in a ref so `remember`
  // can compare against it without being rebuilt when it changes. A caller
  // that learns its id and stores a valuation in one pass usually lists
  // `remember` as a dependency of the very effect doing the fetching; if its
  // identity moved, that effect would run a second time and fetch twice.
  const shown = useRef<string | null>(portfolioId);
  useEffect(() => { shown.current = portfolioId; }, [portfolioId]);

  useEffect(() => {
    if (!portfolioId) return;
    const hit = readCachedValuation<V>(localStorage, portfolioId);
    if (!hit) return;
    setCached(hit.valuation);
    setAt(hit.at);
  }, [portfolioId]);

  // The id is a parameter rather than the one this hook was rendered with,
  // because a caller usually learns the real id and stores the valuation in
  // the same breath — a screen that discovers its portfolio from the network
  // would otherwise write the first entry under whatever it had guessed, or,
  // on a first run with nothing to guess, write nothing at all.
  const remember = useCallback((id: string, valuation: V) => {
    writeCachedValuation(localStorage, id, valuation, Date.now());
    try { localStorage.setItem(KEYS.lastPortfolio, id); } catch { /* blocked storage */ }
    if (id !== shown.current) return;
    setCached(valuation);
    setAt(null);
  }, []);

  // Derived rather than cleared in the effect above: with no portfolio there
  // is nothing to show, and saying so here costs no extra render.
  return portfolioId ? { cached, at, remember } : { cached: null, at: null, remember };
}

/**
 * The portfolio last seen, for a screen that must guess before the list of
 * portfolios arrives. Null on a first run, which simply means no cache.
 */
export function useLastPortfolio(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => { setId(readKey(KEYS.lastPortfolio)); }, []);
  return id;
}
