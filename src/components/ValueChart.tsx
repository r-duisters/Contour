"use client";

import { useEffect, useRef } from "react";
import {
  AreaSeries, createChart, type IChartApi, type ISeriesApi, type Time,
} from "lightweight-charts";

/** Portfolio value over the selected period. */
export default function ValueChart({ series }: { series: { t: number; value: number }[] | null }) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const area = useRef<ISeriesApi<"Area"> | null>(null);

  useEffect(() => {
    if (!container.current) return;
    const c = createChart(container.current, {
      layout: { background: { color: "#0a0a0a" }, textColor: "#d4d4d4" },
      grid: { vertLines: { color: "#1f1f1f" }, horzLines: { color: "#1f1f1f" } },
      autoSize: true,
      timeScale: { timeVisible: false },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    });
    chart.current = c;
    area.current = c.addSeries(AreaSeries, {
      lineColor: "#3b82f6",
      topColor: "rgba(59, 130, 246, 0.3)",
      bottomColor: "rgba(59, 130, 246, 0.0)",
      lineWidth: 2,
    });
    return () => { c.remove(); chart.current = null; area.current = null; };
  }, []);

  useEffect(() => {
    if (!area.current || !series) return;
    area.current.setData(series.map((p) => ({ time: Math.floor(p.t / 1000) as Time, value: p.value })));
    chart.current?.timeScale().fitContent();
  }, [series]);

  return (
    <div className="relative">
      <div ref={container} className="h-56 md:h-64 border border-neutral-800 rounded" />
      {series === null && (
        <span className="absolute inset-0 flex items-center justify-center text-xs text-neutral-500">
          building value history…
        </span>
      )}
    </div>
  );
}
