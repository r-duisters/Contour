"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type {
  IChartApi, ISeriesApi, MouseEventParams, SeriesType,
} from "lightweight-charts";

export type Readout = {
  /** ms timestamp of the point under the crosshair. */
  t: number;
  /** One value per series handed in; null where that series has no point there. */
  values: (number | null)[];
};

/**
 * What the chart is pointing at, or null when it is pointing at nothing.
 *
 * Two charts in this app hide both axes — a price column cost more width than
 * the reading was worth on a 390px screen — so the library has nowhere to
 * print the value its crosshair is already tracking. This hands that value
 * back to React, which does have somewhere to put it.
 *
 * On a phone the crosshair only appears in *tracking mode*, which the library
 * enters on a long press; see the `trackingMode` note in `chart-theme.ts`.
 *
 * The values come from `seriesData`, which is the original data item rather
 * than a screen coordinate — so the figure is one that was actually plotted,
 * never an interpolation of the pixel under the finger.
 */
export function useChartReadout(
  chart: RefObject<IChartApi | null>,
  series: RefObject<ISeriesApi<SeriesType> | null>[],
): Readout | null {
  const [at, setAt] = useState<Readout | null>(null);

  // The array is rebuilt every render while the refs inside it are stable, so
  // it is kept in a ref and read at event time. Putting it in the dependency
  // list instead would resubscribe on every render.
  const seriesRef = useRef(series);
  useEffect(() => { seriesRef.current = series; });

  useEffect(() => {
    const c = chart.current;
    if (!c) return;

    const handler = (param: MouseEventParams) => {
      if (param.time === undefined || !param.point) return setAt(null);
      const values = seriesRef.current.map((s) => {
        const api = s.current;
        if (!api) return null;
        const point = param.seriesData.get(api) as { value?: number } | undefined;
        return typeof point?.value === "number" ? point.value : null;
      });
      // Off the end of every line: the crosshair is over the plot but there is
      // nothing under it to report.
      if (values.every((v) => v === null)) return setAt(null);
      setAt({ t: (param.time as number) * 1000, values });
    };

    c.subscribeCrosshairMove(handler);
    return () => {
      // React runs cleanups in the order the effects were declared, and the
      // effect that creates the chart is declared first — so by the time this
      // runs, `c.remove()` has already happened and unsubscribing throws.
      try { c.unsubscribeCrosshairMove(handler); } catch { /* already removed */ }
    };
  }, [chart]);

  return at;
}
