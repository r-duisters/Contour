"use client";

import { useEffect, type RefObject } from "react";
import type { IChartApi } from "lightweight-charts";

/**
 * Keep the whole series in view.
 *
 * fitContent measures the container, so calling it the instant data arrives
 * can fit against a box that has not been laid out yet — and any later resize
 * (rotation, the chart mounting behind a lazy import, a panel opening) leaves
 * the old zoom behind. This refits after layout and on every resize.
 */
export function useFitChart(
  chart: RefObject<IChartApi | null>,
  container: RefObject<HTMLDivElement | null>,
  data: unknown,
): void {
  useEffect(() => {
    const el = container.current;
    if (!el) return;

    let frame = 0;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (el.clientWidth > 0) chart.current?.timeScale().fitContent();
      });
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [chart, container, data]);
}
