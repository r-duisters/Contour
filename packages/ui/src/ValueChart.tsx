"use client";

import { useEffect, useMemo, useRef } from "react";
import { shapePoints, thinKeepingExtremes } from "@/lib/chart-data";
import { useFitChart } from "@/components/useFitChart";
import { useChartReadout } from "./useChartReadout";
import { usePrivacy } from "@/components/usePrivacy";
import { money } from "@/lib/display";
import {
  AreaSeries, createChart, LineStyle, LineType,
  type IChartApi, type IPriceLine, type ISeriesApi, type Time,
} from "lightweight-charts";
import { chartTheme, directionColors, roseOverPeriod } from "./chart-theme";

/**
 * The time scale is a canvas lightweight-charts lays along the bottom of the
 * same container; the plot is what is left above it. Measured, not guessed.
 */
const AXIS_PX = 28;

/**
 * Share of the plot reserved above the high and below the low. Because it is
 * the same at both ends, the high sits at `EDGE` of the plot's height and the
 * low at `1 - EDGE` — fixed fractions, so the labels follow their rules
 * through a timeframe change or a resize without a single coordinate read.
 */
const EDGE = 0.1;

/** Portfolio value over the selected period. */
export default function ValueChart({ series }: {
  series: { t: number; value: number }[] | null;
}) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const area = useRef<ISeriesApi<"Area"> | null>(null);
  const priceLines = useRef<IPriceLine[]>([]);
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
    let lo = series[0]!, hi = series[0]!;
    for (const p of series) { if (p.value < lo.value) lo = p; if (p.value > hi.value) hi = p; }
    // A flat line has no meaningful band to label.
    return hi.value > lo.value ? { lo, hi } : null;
  }, [series]);

  useEffect(() => {
    if (!container.current) return;
    const c = createChart(container.current, {
      ...chartTheme(),
      autoSize: true,
      // No price axis: the value is printed above the chart, and on a 390px
      // screen the column cost more width than the reading was worth.
      //
      // The margins are pinned rather than left to the library's defaults
      // (0.2 above, 0.1 below) because the two labels are placed from them.
      // Equal margins put the high and the low at known fractions of the
      // plot, which is what lets the text sit on its rule without measuring
      // anything — see AXIS_PX below.
      rightPriceScale: { visible: false, scaleMargins: { top: EDGE, bottom: EDGE } },
      // Nothing to scroll to beyond the data, so the window cannot drift off it.
      timeScale: { timeVisible: false, fixLeftEdge: true, fixRightEdge: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    });
    chart.current = c;
    area.current = c.addSeries(AreaSeries, {
      // Recoloured below whenever the data changes; this is only the first paint.
      ...directionColors(true),
      lineWidth: 2,
      // Daily closes are jagged enough that the corners read as noise.
      lineType: LineType.Curved,
      // The library marks the last value by default. That figure is already
      // the headline above the chart, and a third horizontal line competed
      // with the two that carry the range.
      priceLineVisible: false,
    });
    return () => { c.remove(); chart.current = null; area.current = null; };
  }, []);

  useEffect(() => {
    if (!area.current || !series) return;
    const width = container.current?.clientWidth ?? 360;
    const raw = series.map((p) => ({ t: p.t, v: p.value }));
    const points = thinKeepingExtremes(raw, shapePoints(width));
    area.current.setData(points.map((p) => ({ time: Math.floor(p.t / 1000) as Time, value: p.v })));
    // Green if the window ended above where it opened, red if below — read off
    // the drawn points, so the colour agrees with the line rather than with a
    // figure computed somewhere else.
    area.current.applyOptions(directionColors(roseOverPeriod(points.map((p) => p.v))));
  }, [series]);

  /**
   * A rule at each end of the range, so a figure means a level rather than
   * floating in a corner. Dotted, which is the style the library's last-value
   * line used before it was turned off, and grey rather than blue: the accent
   * belongs to the series, and two blue dotted rules beside a blue line would
   * read as three of the same thing.
   */
  useEffect(() => {
    const s = area.current;
    if (!s) return;
    for (const line of priceLines.current) s.removePriceLine(line);
    priceLines.current = [];
    if (!extent) return;
    for (const price of [extent.hi.value, extent.lo.value]) {
      priceLines.current.push(s.createPriceLine({
        price,
        color: "#404040",
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        // The price axis is hidden, so the library has nowhere to draw a
        // label; the figures beside the rules are ours.
        axisLabelVisible: false,
      }));
    }
  }, [extent, series]);

  useFitChart(chart, container, series);

  /**
   * What the finger is on. Press and hold — see `chart-theme.ts` — and this
   * says what that point was worth and when, which is the only way to read a
   * level off a chart with no price axis.
   */
  const at = useChartReadout(chart, [area]);
  const reading = at && at.values[0] !== null ? { t: at.t, value: at.values[0]! } : null;

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
          in the grey the guide reserves for footnotes. Both now sit at
          neutral-500, the tone the Markets cards use for the same kind of
          label — a step dimmer than they were, so the line keeps the eye. */}
      {extent && !hidden && (
        <>
          {/* Placed from the same margins the price scale uses, so each label
              tracks its rule through every timeframe. Positioning these from
              priceToCoordinate looked equivalent and was not: the read had to
              land after the fit, and on a range change it did not, so the two
              figures drifted off their lines. */}
          <span
            style={{ top: `calc((100% - ${AXIS_PX}px) * ${EDGE})` }}
            className="pointer-events-none absolute z-10 right-2 -translate-y-full -mt-0.5 text-xs tabular-nums text-neutral-500"
          >
            {money(extent.hi.value)}
          </span>
          <span
            style={{ top: `calc((100% - ${AXIS_PX}px) * ${1 - EDGE})` }}
            className="pointer-events-none absolute z-10 right-2 mt-0.5 text-xs tabular-nums text-neutral-500"
          >
            {money(extent.lo.value)}
          </span>
        </>
      )}
      {/* Top-left, so it never lands on the high and low labels pinned to the
          right edge — which is also why those are left showing rather than
          hidden while reading: nothing collides, and blanking them on every
          touch would flicker the whole panel.

          Masked with the same guard as the rest: a value read off the chart is
          exactly the figure privacy mode exists to hide. */}
      {reading && !hidden && (
        <div className="pointer-events-none absolute z-10 left-2 top-2 text-xs">
          <div className="tabular-nums text-neutral-200">{money(reading.value)}</div>
          <div className="text-neutral-500">
            {new Date(reading.t).toLocaleDateString(undefined, {
              day: "numeric", month: "short", year: "numeric",
            })}
          </div>
        </div>
      )}
      {series === null && (
        <span className="absolute inset-0 flex items-center justify-center text-xs text-neutral-500">
          building value history…
        </span>
      )}
    </div>
  );
}
