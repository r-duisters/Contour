"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart, CandlestickSeries, LineSeries, createSeriesMarkers,
  type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type Time,
} from "lightweight-charts";
import { run } from "@/lib/indicator";
import type { Bar } from "@/lib/types";
import { CandlestickChart } from "lucide-react";
import PageLabel from "@/components/PageLabel";
import SymbolPicker from "@/components/SymbolPicker";

const BUY_LIMIT = 0.25;
const SELL_LIMIT = 0.80;

export default function ChartPage() {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [bars, setBars] = useState<Bar[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "live" | "error">("idle");

  const priceContainer = useRef<HTMLDivElement>(null);
  const riskContainer = useRef<HTMLDivElement>(null);
  const priceChart = useRef<IChartApi | null>(null);
  const riskChart = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const riskRef = useRef<ISeriesApi<"Line"> | null>(null);
  const buyLineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const sellLineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  // create both charts once
  useEffect(() => {
    if (!priceContainer.current || !riskContainer.current) return;
    const common = {
      layout: { background: { color: "#0a0a0a" }, textColor: "#d4d4d4" },
      grid: { vertLines: { color: "#1f1f1f" }, horzLines: { color: "#1f1f1f" } },
      autoSize: true,
      timeScale: { timeVisible: true, secondsVisible: false },
      // Vertical swipes must scroll the page on touch devices; horizontal
      // drag still pans and pinch still zooms the chart.
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
    } as const;
    const top = createChart(priceContainer.current, common);
    const bot = createChart(riskContainer.current, common);
    priceChart.current = top;
    riskChart.current = bot;
    candleRef.current = top.addSeries(CandlestickSeries);
    markersRef.current = createSeriesMarkers(candleRef.current);
    riskRef.current = bot.addSeries(LineSeries, { color: "#e5e5e5", lineWidth: 2 });
    // The app's own green and red, not near-misses of them.
    buyLineRef.current = bot.addSeries(LineSeries, { color: "#22c55e", lineWidth: 1, lineStyle: 2 });
    sellLineRef.current = bot.addSeries(LineSeries, { color: "#ef4444", lineWidth: 1, lineStyle: 2 });

    // Sync time-scales: when one chart pans/zooms, mirror it on the other.
    const syncTo = (src: IChartApi, dst: IChartApi) => {
      src.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range) dst.timeScale().setVisibleLogicalRange(range);
      });
    };
    syncTo(top, bot);
    syncTo(bot, top);

    return () => { top.remove(); bot.remove(); priceChart.current = null; riskChart.current = null; };
  }, []);

  // load history when symbol changes
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    // Risk metric needs 1460 daily bars of history to warm up. Fetch as much as Binance returns.
    fetch(`/api/candles?symbol=${symbol}&interval=1d&limit=1000`)
      .then((r) => r.json())
      .then(async (data: { bars: Bar[] }) => {
        if (cancelled) return;
        let all = data.bars;
        // try to extend back another 1000 bars for warm-up
        if (all.length > 0) {
          const end = all[0]!.t - 1;
          const more = await fetch(`/api/candles?symbol=${symbol}&interval=1d&limit=1000&endTime=${end}`)
            .then((r) => r.ok ? r.json() : { bars: [] })
            .catch(() => ({ bars: [] }));
          all = [...(more.bars ?? []), ...all];
        }
        setBars(all);
        setStatus("live");
      })
      .catch(() => !cancelled && setStatus("error"));
    return () => { cancelled = true; };
  }, [symbol]);

  const { signals, series } = useMemo(() => run(bars), [bars]);

  useEffect(() => {
    if (!candleRef.current || !riskRef.current || !buyLineRef.current || !sellLineRef.current) return;
    const tSec = (t: number) => Math.floor(t / 1000) as Time;
    candleRef.current.setData(
      bars.map((b) => ({ time: tSec(b.t), open: b.o, high: b.h, low: b.l, close: b.c })),
    );
    const riskPoints = bars
      .map((b, i) => ({ time: tSec(b.t), value: series.riskMetric[i]! }))
      .filter((p) => Number.isFinite(p.value));
    riskRef.current.setData(riskPoints);
    buyLineRef.current.setData(bars.map((b) => ({ time: tSec(b.t), value: BUY_LIMIT })));
    sellLineRef.current.setData(bars.map((b) => ({ time: tSec(b.t), value: SELL_LIMIT })));

    markersRef.current?.setMarkers(
      signals.map((s) => ({
        time: tSec(s.barTime),
        position: s.kind === "long" ? "belowBar" : "aboveBar",
        color: s.kind === "long" ? "#22c55e" : "#ef4444",
        shape: s.kind === "long" ? "arrowUp" : "arrowDown",
        text: s.tag ?? s.kind,
      })),
    );
  }, [bars, signals, series]);

  // Poll the last bar every 60s (daily bars don't change often).
  useEffect(() => {
    const id = window.setInterval(() => {
      fetch(`/api/candles?symbol=${symbol}&interval=1d&limit=2`)
        .then((r) => r.json())
        .then((data: { bars: Bar[] }) => setBars((prev) => mergeTail(prev, data.bars)))
        .catch(() => {});
    }, 60_000);
    return () => window.clearInterval(id);
  }, [symbol]);

  const latestRisk = useMemo(() => {
    for (let i = series.riskMetric.length - 1; i >= 0; i--) {
      if (Number.isFinite(series.riskMetric[i])) return series.riskMetric[i]!;
    }
    return null;
  }, [series.riskMetric]);

  return (
    <main className="min-h-screen md:min-h-[calc(100vh-3.5rem)] flex flex-col">
      {/* The bar is full-bleed so its rule spans the window, but its contents
          sit in the same 5xl column as every other page — otherwise the Chart
          eyebrow starts at the window edge while the other three start at the
          centred column. The panes below deliberately keep the whole width:
          1460 daily bars need the pixels. */}
      <header className="border-b border-neutral-800">
        <div className="p-3 md:p-4 max-w-5xl mx-auto flex gap-2 items-center">
        <PageLabel icon={CandlestickChart}>Chart</PageLabel>
        <SymbolPicker value={symbol} onChange={setSymbol} />
        {/* The status is the only thing here that changes on its own, so it
            sits apart from the two controls rather than between them. */}
        <span className="ml-auto text-xs text-neutral-500 text-right">
          1d · {status}
          <span className="hidden sm:inline"> · {bars.length} bars · {signals.length} signals</span>
          {latestRisk !== null && (
            <> · risk: <span className={latestRisk < BUY_LIMIT ? "text-green-500" : latestRisk > SELL_LIMIT ? "text-red-500" : "text-neutral-300"}>
              {latestRisk.toFixed(3)}
            </span></>
          )}
        </span>
        </div>
      </header>
      <div ref={priceContainer} className="h-[45vh] min-h-[260px] md:h-auto md:flex-1 md:min-h-[300px]" />
      <div ref={riskContainer} className="h-[30vh] min-h-[180px] md:h-auto md:flex-1 md:min-h-[200px] border-t border-neutral-800" />
    </main>
  );
}

function mergeTail(prev: Bar[], tail: Bar[]): Bar[] {
  if (prev.length === 0) return tail;
  const out = prev.slice();
  for (const b of tail) {
    const last = out[out.length - 1]!;
    if (b.t === last.t) out[out.length - 1] = b;
    else if (b.t > last.t) out.push(b);
  }
  return out;
}
