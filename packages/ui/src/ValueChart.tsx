"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { thin, targetPoints } from "@/lib/chart-data";
import { useFitChart } from "@/components/useFitChart";
import { usePrivacy } from "@/components/usePrivacy";
import { money } from "@/lib/display";
import {
  AreaSeries, createChart, LineStyle, LineType,
  type IChartApi, type IPriceLine, type ISeriesApi, type Time,
} from "lightweight-charts";

/** Portfolio value over the selected period. */
export default function ValueChart({ series }: {
  series: { t: number; value: number }[] | null;
}) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const area = useRef<ISeriesApi<"Area"> | null>(null);
  const priceLines = useRef<IPriceLine[]>([]);
  // Where the two rules landed, in pixels down from the top of the container.
  const [levels, setLevels] = useState<{ hi: number; lo: number } | null>(null);
  // Reading privacy here rather than as a prop: these labels are the only
  // amounts the chart prints, so the component that draws them owns the guard.
  const hidden = usePrivacy();

  /**
   * The period's high and low. With no price axis there is nothing to read a
   * level off, and a shape without a scale can flatter or alarm — a 2% wobble
   * and a 40% drawdown draw the same curve. Two labels restore the scale for
   * the cost of two lines of text.
   */
  const extent = useMemo(() => {
    if (!series || series.length === 0) return null;
    let lo = Infinity, hi = -Infinity;
    for (const p of series) { if (p.value < lo) lo = p.value; if (p.value > hi) hi = p.value; }
    // A flat line has no meaningful band to label.
    return Number.isFinite(lo) && Number.isFinite(hi) && hi > lo ? { lo, hi } : null;
  }, [series]);

  useEffect(() => {
    if (!container.current) return;
    const c = createChart(container.current, {
      layout: { background: { color: "#0a0a0a" }, textColor: "#d4d4d4" },
      grid: { vertLines: { color: "#1f1f1f" }, horzLines: { color: "#1f1f1f" } },
      autoSize: true,
      // No price axis: the value is printed above the chart, and on a 390px
      // screen the column cost more width than the reading was worth.
      rightPriceScale: { visible: false },
      // Nothing to scroll to beyond the data, so the window cannot drift off it.
      timeScale: { timeVisible: false, fixLeftEdge: true, fixRightEdge: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    });
    chart.current = c;
    area.current = c.addSeries(AreaSeries, {
      lineColor: "#3b82f6",
      topColor: "rgba(59, 130, 246, 0.3)",
      bottomColor: "rgba(59, 130, 246, 0.0)",
      lineWidth: 2,
      // Daily closes are jagged enough that the corners read as noise.
      lineType: LineType.Curved,
    });
    return () => { c.remove(); chart.current = null; area.current = null; };
  }, []);

  useEffect(() => {
    if (!area.current || !series) return;
    const width = container.current?.clientWidth ?? 360;
    const points = thin(series.map((p) => ({ t: p.t, v: p.value })), targetPoints(width));
    area.current.setData(points.map((p) => ({ time: Math.floor(p.t / 1000) as Time, value: p.v })));
  }, [series]);

  /**
   * A rule at each end of the range, so a figure means a level rather than
   * floating in a corner. Quieter than the series and solid, where the
   * library's own last-value line is dashed — three horizontal lines only read
   * as three different things if they do not all look alike.
   */
  useEffect(() => {
    const s = area.current;
    if (!s) return;
    for (const line of priceLines.current) s.removePriceLine(line);
    priceLines.current = [];
    if (!extent) return;
    for (const price of [extent.hi, extent.lo]) {
      priceLines.current.push(s.createPriceLine({
        price,
        color: "#404040",
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        // The price axis is hidden, so the library has nowhere to draw a
        // label; the figures beside the rules are ours.
        axisLabelVisible: false,
      }));
    }
  }, [extent, series]);

  /**
   * Put each figure on its own rule. The default scale margins leave 20% of
   * headroom above the high and 10% below the low, so a label pinned to the
   * container's corners would sit well clear of the line it belongs to and
   * claim a level the chart never draws.
   */
  const measure = useCallback(() => {
    const s = area.current;
    if (!s || !extent) { setLevels(null); return; }
    const hi = s.priceToCoordinate(extent.hi);
    const lo = s.priceToCoordinate(extent.lo);
    setLevels(hi !== null && lo !== null ? { hi, lo } : null);
  }, [extent]);

  useFitChart(chart, container, series);

  // After the fit, not before: fitting changes the scale, and a coordinate
  // read on the previous one puts both labels in the wrong place.
  useEffect(() => {
    const id = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(id);
  }, [measure, series]);

  // The coordinates are in pixels, so every resize invalidates them.
  useEffect(() => {
    const el = container.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  return (
    <div className="relative">
      <div ref={container} className="h-56 md:h-64 border border-neutral-800 rounded" />
      {/* `z-10` is what makes these visible at all. lightweight-charts fills
          the container with its own absolutely-positioned canvases, and with
          `auto` these sat in the same stacking context and were painted behind
          them — present in the DOM, correctly sized, and never once on screen.
          Querying for them is not evidence they render; `elementFromPoint` at
          their centre returned the canvas.

          One grey for both, because they do the same job: they were 11px in
          neutral-500 and neutral-600, two weights for one pair, with the low
          in the grey the guide reserves for footnotes. */}
      {extent && levels && !hidden && (
        <>
          {/* Sat on the rule, and nudged clear of it, so the figure reads as
              that level rather than as a caption for the whole chart. */}
          <span
            style={{ top: levels.hi }}
            className="pointer-events-none absolute z-10 right-2 -translate-y-full -mt-0.5 text-xs tabular-nums text-neutral-400"
          >
            {money(extent.hi)}
          </span>
          <span
            style={{ top: levels.lo }}
            className="pointer-events-none absolute z-10 right-2 mt-0.5 text-xs tabular-nums text-neutral-400"
          >
            {money(extent.lo)}
          </span>
        </>
      )}
      {series === null && (
        <span className="absolute inset-0 flex items-center justify-center text-xs text-neutral-500">
          building value history…
        </span>
      )}
    </div>
  );
}
