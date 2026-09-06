"use client";

import { useCallback, useEffect, useState } from "react";
import type { RangeKey } from "@/lib/ranges";
import { readCachedSeries, writeCachedSeries, type CachedSeries } from "@/core/series-cache";

/**
 * The last line the chart drew for this portfolio and range, on screen before
 * the network answers. `useCachedValuation`'s sibling, for the same BRAND.md
 * rule; read after mount rather than during render for the same hydration
 * reason.
 *
 * The state remembers *which* portfolio and range it answers, and a mismatch
 * derives null rather than being cleared by a second setState: the previous
 * range's line under a newly selected button would be a mislabelled chart,
 * which is worse than a blank one — and deriving it keeps the effect from
 * setting state synchronously, the shape the lint budget refuses to grow for.
 */
export function useCachedSeries(portfolioId: string | null, range: RangeKey): {
  cached: CachedSeries | null;
  remember: (
    portfolioId: string,
    range: RangeKey,
    series: CachedSeries["series"],
    change: CachedSeries["change"],
  ) => void;
} {
  const [held, setHeld] = useState<{ id: string; range: RangeKey; hit: CachedSeries | null } | null>(null);

  useEffect(() => {
    if (!portfolioId) return;
    let cancelled = false;
    // A microtask, so the read lands just after this render settles instead
    // of scheduling a cascading one from inside the effect.
    queueMicrotask(() => {
      if (cancelled) return;
      setHeld({ id: portfolioId, range, hit: readCachedSeries(localStorage, portfolioId, range) });
    });
    return () => { cancelled = true; };
  }, [portfolioId, range]);

  // Parameters rather than the rendered id and range, for `useCachedValuation`'s
  // reason: the writer knows what it fetched, and a stale closure must not file
  // a fresh answer under the wrong key.
  const remember = useCallback((
    id: string, r: RangeKey, series: CachedSeries["series"], change: CachedSeries["change"],
  ) => {
    writeCachedSeries(localStorage, id, r, series, change, Date.now());
  }, []);

  const cached = held && held.id === portfolioId && held.range === range ? held.hit : null;
  return { cached, remember };
}
