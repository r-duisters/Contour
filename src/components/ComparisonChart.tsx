"use client";

import { useEffect, useRef } from "react";
import { createChart, LineSeries, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";
import { useFitChart } from "@/components/useFitChart";

export type IndexPoint = { t: number; index: number };

/**
 * Your return against an index, both rebased to 100 at the start of the
 * period. Rebasing is what makes them comparable: the portfolio line is a
 * time-weighted return, so deposits do not lift it, and the index line is a
 * price series that never had deposits to begin with.
 */
export default function ComparisonChart({
  you, bench, benchLabel,
}: {
  you: IndexPoint[] | null;
  bench: IndexPoint[] | null;
  benchLabel: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const mine = useRef<ISeriesApi<"Line"> | null>(null);
  const theirs = useRef<ISeriesApi<"Line"> | null>(null);

  useEffect(() => {
    if (!container.current) return;
    const c = createChart(container.current, {
      layout: { background: { color: "#0a0a0a" }, textColor: "#d4d4d4" },
      grid: { vertLines: { color: "#171717" }, horzLines: { color: "#171717" } },
      autoSize: true,
      timeScale: { timeVisible: false, fixLeftEdge: true, fixRightEdge: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    });
    chart.current = c;
    mine.current = c.addSeries(LineSeries, { color: "#3b82f6", lineWidth: 2 });
    theirs.current = c.addSeries(LineSeries, { color: "#eab308", lineWidth: 2 });
    return () => { c.remove(); chart.current = null; mine.current = null; theirs.current = null; };
  }, []);

  useEffect(() => {
    const toData = (points: IndexPoint[]) =>
      points.map((p) => ({ time: Math.floor(p.t / 1000) as Time, value: p.index }));
    if (you) mine.current?.setData(toData(you));
    if (bench) theirs.current?.setData(toData(bench));
  }, [you, bench]);

  useFitChart(chart, container, [you, bench]);

  const last = (points: IndexPoint[] | null) =>
    points && points.length ? points[points.length - 1]!.index - 100 : null;
  const yours = last(you);
  const other = last(bench);

  return (
    <div>
      <div className="relative">
        <div ref={container} className="h-56 md:h-72 border border-neutral-800 rounded" />
        {you === null && (
          <span className="absolute inset-0 flex items-center justify-center text-xs text-neutral-500">
            building comparison…
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-4 mt-2 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-0.5 bg-blue-500 inline-block" />
          <span className="text-neutral-400">You</span>
          {yours !== null && (
            <span className={yours >= 0 ? "text-green-500" : "text-red-500"}>
              {yours >= 0 ? "+" : ""}{yours.toFixed(1)}%
            </span>
          )}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-0.5 bg-yellow-500 inline-block" />
          <span className="text-neutral-400">{benchLabel}</span>
          {other !== null && (
            <span className={other >= 0 ? "text-green-500" : "text-red-500"}>
              {other >= 0 ? "+" : ""}{other.toFixed(1)}%
            </span>
          )}
        </span>
        {yours !== null && other !== null && (
          <span className="text-neutral-500">
            {yours >= other
              ? `ahead by ${(yours - other).toFixed(1)} points`
              : `behind by ${(other - yours).toFixed(1)} points`}
          </span>
        )}
      </div>
    </div>
  );
}
