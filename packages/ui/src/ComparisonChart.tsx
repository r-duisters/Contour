"use client";

import { useEffect, useRef } from "react";
import {
  createChart, LineSeries, LineType, type IChartApi, type ISeriesApi, type Time,
} from "lightweight-charts";
import { useFitChart } from "@/components/useFitChart";
import { money } from "@/lib/display";
import { thin, targetPoints } from "@/lib/chart-data";

export type Point = { t: number; v: number };

/**
 * Two lines, you against an index, in one of two honest framings.
 *
 * "pct" plots time-weighted returns rebased to 100: deposits are stripped from
 * both sides, so it answers "were my picks better". "money" plots the real
 * portfolio value against what the same money, moved on the same days, would
 * be worth in the index — timing included, which is the question a person
 * actually asks.
 */
export default function ComparisonChart({
  you, bench, benchLabel, mode,
}: {
  you: Point[] | null;
  bench: Point[] | null;
  benchLabel: string;
  mode: "pct" | "money";
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
      // Rebased lines: what matters is the gap between them, which the legend
      // states in figures. An axis of index values would only add width.
      rightPriceScale: { visible: false },
      timeScale: { timeVisible: false, fixLeftEdge: true, fixRightEdge: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    });
    chart.current = c;
    const line = { lineWidth: 2 as const, lineType: LineType.Curved };
    mine.current = c.addSeries(LineSeries, { color: "#3b82f6", ...line });
    theirs.current = c.addSeries(LineSeries, { color: "#eab308", ...line });
    return () => { c.remove(); chart.current = null; mine.current = null; theirs.current = null; };
  }, []);

  useEffect(() => {
    // Both lines are thinned to the same budget so their shapes stay comparable.
    const budget = targetPoints(container.current?.clientWidth ?? 360);
    const toData = (points: Point[]) =>
      thin(points, budget).map((p) => ({ time: Math.floor(p.t / 1000) as Time, value: p.v }));
    if (you) mine.current?.setData(toData(you));
    if (bench) theirs.current?.setData(toData(bench));
  }, [you, bench]);

  useFitChart(chart, container, [you, bench, mode]);

  const end = (points: Point[] | null) =>
    points && points.length ? points[points.length - 1]!.v : null;
  const yours = end(you);
  const other = end(bench);
  const show = (v: number) => (mode === "money" ? money(v) : `${v - 100 >= 0 ? "+" : ""}${(v - 100).toFixed(1)}%`);
  const tone = (v: number) =>
    mode === "money" ? "text-neutral-300" : v >= 100 ? "text-green-500" : "text-red-500";

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
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-0.5 bg-blue-500 inline-block" />
          <span className="text-neutral-400">You</span>
          {yours !== null && <span className={tone(yours)}>{show(yours)}</span>}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-0.5 bg-yellow-500 inline-block" />
          <span className="text-neutral-400">{benchLabel}</span>
          {other !== null && <span className={tone(other)}>{show(other)}</span>}
        </span>
        {yours !== null && other !== null && (
          <span className={yours >= other ? "text-green-500" : "text-red-500"}>
            {mode === "money"
              ? `${yours >= other ? "ahead by" : "behind by"} ${money(Math.abs(yours - other))}`
              : `${yours >= other ? "ahead by" : "behind by"} ${Math.abs(yours - other).toFixed(1)} points`}
          </span>
        )}
      </div>
      <p className="text-[11px] text-neutral-600 mt-1.5">
        {mode === "money"
          ? "Your actual value against the same deposits, made on the same days, put into the index instead. Timing counts."
          : "Both rebased to 100, deposits removed. Measures the picks, not the timing."}
      </p>
    </div>
  );
}
