# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Brand and layout

`BRAND.md` is the guide for anything user-facing: the app's name, voice,
colour, layout rules, established components and the anti-patterns already
removed once. Read it before writing UI or copy.

## What this is

A Next.js (App Router, TypeScript) web app that brings **one specific PineScript** to life outside
TradingView: Oakley Wood's "Risk Metric Strategy" for Bitcoin. The app provides a live candlestick
chart with the risk-metric pane, historical backtesting, and alerts that fire into **Home Assistant**
via a webhook (HA fans out — mobile push, Telegram, etc.).

Market data: **Binance** public REST + WebSocket (no API key required), forced to **daily timeframe**
because the indicator's formulas are anchored to daily and weekly closes.
Persistence: **SQLite via Prisma 6**.

## The indicator

`riskMetric = mean(riskOne, riskTwo, riskThree)` ∈ ~[0, 1], with three sub-metrics defined in
`src/lib/indicator/index.ts`:

| Sub-metric | Formula | Normaliser (function of bar's open-time-in-ms) |
|---|---|---|
| `riskOne` | `(close − sma(close, 1460)) / stdev(close, 1460) / maxRiskOne` | `−38.12·ln(t) + 1078.5` |
| `riskTwo` | `(ln(close / w20_sma) + minRiskTwo) / maxRiskTwo` | `min = −3.719·ln(t) + 105`, `max = −6e-12·t + 10.93` |
| `riskThree` | `sma(close, 50) / sma(close_weekly, 50) / maxRiskThree` | `−12.55·ln(t) + 355.15` |

The hard-coded time curves are kept verbatim from the Pine source — values will only match
TradingView if `t` stays as **bar open time in milliseconds**.

Weekly closes come from `dailyToWeekly()` in `src/lib/indicator/resample.ts` (Monday anchor, matching
Binance's weekly klines). `projectWeeklyOntoDaily()` puts the most-recently-*closed* weekly value on
each daily bar — lookahead-safe, mirroring Pine's `request.security(..., "W", ...)`.

**Signals are latched DCA buys** (`riskMetric < 0.30 / 0.25 / 0.20 / 0.10` → size fractions
`0.30 / 0.30 / 0.40 / 0.80` of available capital) and **tiered sells** (`> 0.80 / 0.90 / 0.95` → size
fraction `0.50` of capital). A sell resets all buy latches; a buy resets the sell latches. The
`> 0.95` tier has no latch — it fires every bar above that level.

Warm-up is **1460 daily bars** before `riskMetric` becomes finite. The chart page fetches two
1000-bar pages from Binance to satisfy this on first load.

## Common commands

| Task | Command |
|---|---|
| Dev server | `npm run dev` (default port 3000) |
| Type-check | `npx tsc --noEmit` |
| Production build | `npm run build` |
| Lint | `npm run lint` |
| Tests (Vitest) | `npx vitest` (e.g. `npx vitest run src/lib/indicator`) |
| Prisma migration | `npx prisma migrate dev --name <change>` |
| Regenerate Prisma client | `npx prisma generate` |
| Inspect DB | `npx prisma studio` |
| Manually evaluate alerts | `curl http://localhost:3000/api/cron/evaluate` |

Prisma is pinned to **v6** (not v7) so the classic `datasource { url = env(...) }` setup works.
Don't run `npm i prisma@latest` without re-doing the Prisma 7 adapter migration.

## Architecture

```
src/
  app/
    page.tsx              Home — links to the four screens
    chart/page.tsx        Live candlestick chart with indicator overlay
    backtest/page.tsx     Run backtest, view stats and trades
    alerts/page.tsx       CRUD for alerts + "Evaluate now"
    settings/page.tsx     HA URL + webhook ID, with "Send test"
    analyze/page.tsx      Library selector + analyzer + apply-fixes + save-as
    api/
      candles/            GET — proxy Binance klines
      backtest/           POST — run indicator over history + simulate
      alerts/             GET/POST + [id] PATCH/DELETE
      analyze/            POST — analyze (+ optional `apply: id[]` to rewrite)
      scripts/            GET — list samples/*.pine; POST — save (auto-named)
      scripts/[name]/     GET — read one
      cron/evaluate/      GET — periodic alert evaluator (call from a cron)
      settings/           GET/PUT settings; POST sends a test signal to HA
  lib/
    types.ts              Bar, Signal, Timeframe
    binance.ts            fetchKlines, fetchKlinesRange, subscribeKlines (WS)
    indicator/
      primitives.ts       sma, ema, rma, stdev, highest, lowest, crossover, crossunder, change, nz
      resample.ts         dailyToWeekly, projectWeeklyOntoDaily
      index.ts            run(bars) → { signals, series } — Risk Metric Strategy port
      risk-metric.test.ts Vitest specs (primitives + resampler + warm-up behaviour)
    backtest.ts           simulate(bars, signals, { initialCapital, compounding })
                          DCA-aware: signals carry sizeFraction; multiple partial buys/sells.
    notifier/
      index.ts            Notifier interface + NotifierPayload
      home-assistant.ts   HomeAssistantNotifier — POSTs to ${HA_URL}/api/webhook/{id}
    pinescript/
      analyze.ts          analyzePineScript(source) → Finding[] (rule-based linter)
      apply.ts            applyImprovements(source, ids) → rewritten source + applied/skipped
      library.ts          List/read/write samples/*.pine (filesystem-backed)
      *.test.ts           Vitest specs (rules + transforms, 23 tests)
    db.ts                 Prisma client singleton (avoids HMR connection leaks)
samples/                  Bundled PineScripts; new versions are written here as
                          <stem>.fixes.pine (auto-incremented on conflict)
prisma/
  schema.prisma           Alert, AlertEvent, BacktestRun, Settings
  migrations/             Auto-generated
```

## The load-bearing contract

`lib/indicator/index.ts` exports **`run(bars: Bar[]): { signals, series }`** — a pure function
with no I/O that expects **daily** bars. The same call is used by the chart (live), the backtester
(historical), and the cron evaluator (alerts). Reusing one implementation everywhere is the entire
point of porting the script.

`Bar = { t, o, h, l, c, v }` with ms timestamps — what Binance returns and what `lightweight-charts`
consumes; no translation layers.

Verifying parity against TradingView: open the Risk Metric Strategy on BTCUSDT 1d in TradingView, note
the dates/prices of a few signal events, then check that our backtest produces the same `tag` and
similar bar timestamps. The hard-coded time curves are sensitive to the exact `time` value Pine uses —
if signals drift, suspect the weekly-resample anchoring first (Pine's "W" vs. Binance Monday-anchor).

## Alert evaluation

`/api/cron/evaluate` (GET) iterates enabled alerts, fetches recent closed bars from Binance, runs the
indicator, and dispatches new signals through the configured `Notifier`.

Dedupe lives in two places:
1. **DB unique constraint** on `(alertId, barTime, signal)` in `AlertEvent` — guarantees no duplicate dispatches even under races.
2. **`Alert.lastBarTime`** is advanced each tick so re-scans of the same history are skipped early.

Always drop the *in-progress* bar before running the indicator (`bars.slice(0, -1)`). Acting on an
unclosed bar leads to flickering signals.

Wire this route to a real schedule — Vercel Cron, a systemd timer hitting the URL, or a
Home Assistant `rest_command` automation. The route itself is stateless and idempotent.

## Home Assistant integration

The app speaks one-way to HA via a **webhook trigger** automation:

1. In HA, create an automation: trigger = Webhook (ID e.g. `trader_signal`), action = `notify.<device>`
   templating `{{ trigger.json.symbol }}`, `{{ trigger.json.signal }}`, etc.
2. In the app's Settings page, set `HA URL` and the webhook ID, then **Send test** to verify the
   automation trace fires and the notification reaches the device.

`HomeAssistantNotifier.send()` POSTs JSON `{ alertId, symbol, timeframe, signal, price, time, meta? }`
to `${HA_URL}/api/webhook/${webhookId}`. No long-lived HA token is needed — webhook endpoints are
unauthenticated by design, so keep `HA_URL` on a trusted network.

MQTT is a viable alternative (publish to `trader/signals/<symbol>`), but isn't implemented yet.

## Conventions

- **Bar timestamps are ms** internally; convert to seconds (`/1000`) only when handing to `lightweight-charts`.
- **Indicator series return `NaN` during warm-up** (matching Pine's `na`). Strip with `Number.isFinite` before plotting.
- **`BigInt` for `barTime` in Prisma**. Convert to `number` at API boundaries.
- API route bodies are validated with **Zod** at every entry point.
- `export const dynamic = "force-dynamic"` on routes that read live data or DB, to opt out of build-time evaluation.
