# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Brand and layout

`docs/carried-forward.md` lists what is known about and not done: verified
bugs, the capability gaps Phase 4 inherits, deferred review findings, and the
decisions waiting on a person. Read it before planning a phase — the per-phase
ledgers that used to hold this are deleted when their phase merges.

`BRAND.md` is the guide for anything user-facing: the app's name, voice,
colour, layout rules, established components and the anti-patterns already
removed once. Read it before writing UI or copy.

BRAND.md is the single authority for design: name, voice, colour, type,
numbers, charts, the established components, timeframes, privacy mode and the
anti-patterns already removed once. `.superdesign/design-system.md` defers to
it and adds only what a design agent needs (product context, per-screen
questions, canvas working notes) — pass both as `--context-file` on every
Superdesign command.

## What this is

A Next.js (App Router, TypeScript) **self-hosted portfolio tracker** for crypto and equities, for one
user on their own machine. The screens are portfolio (holdings, valuation, history), ledger
(transactions), insights (benchmarks, what made the money, concentration) and settings, with
import from a Delta-by-eToro CSV export and export back out again. It is passkey- or
password-locked, installs as a PWA, and pushes notifications.

Alongside that it keeps the tool it grew out of: a port of **one specific PineScript**, Oakley Wood's
"Risk Metric Strategy" for Bitcoin, with a live candlestick chart and risk-metric pane, historical
backtesting, a PineScript analyzer, and alerts that fire into **Home Assistant** via a webhook (HA
fans out — mobile push, Telegram, etc.). That part is one section of the app now, not the whole of it.

Market data: **Binance** public REST + WebSocket for crypto (no API key required), Yahoo /
Twelve Data / Alpha Vantage for equities, and Frankfurter/ECB for fiat rates.
Persistence: **SQLite via Prisma 6**.

Where it is going: the logic is being moved out of the server so the same code can run inside an
Android APK with no server behind it. Phase 2 built that seam — see **The data seam** below. The
plan is `docs/superpowers/specs/2026-08-22-standalone-android-design.md`.

## The indicator

`riskMetric = mean(riskOne, riskTwo, riskThree)` ∈ ~[0, 1], with three sub-metrics defined in
`packages/core/src/indicator/index.ts`:

| Sub-metric | Formula | Normaliser (function of bar's open-time-in-ms) |
|---|---|---|
| `riskOne` | `(close − sma(close, 1460)) / stdev(close, 1460) / maxRiskOne` | `−38.12·ln(t) + 1078.5` |
| `riskTwo` | `(ln(close / w20_sma) + minRiskTwo) / maxRiskTwo` | `min = −3.719·ln(t) + 105`, `max = −6e-12·t + 10.93` |
| `riskThree` | `sma(close, 50) / sma(close_weekly, 50) / maxRiskThree` | `−12.55·ln(t) + 355.15` |

The hard-coded time curves are kept verbatim from the Pine source — values will only match
TradingView if `t` stays as **bar open time in milliseconds**.

Weekly closes come from `dailyToWeekly()` in `packages/core/src/indicator/resample.ts` (Monday anchor, matching
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
| Dev server | `npm run dev` (delegates to the `apps/web` workspace, default port 3000) |
| Type-check | `npm run typecheck` (root `tsconfig.json` for the packages, then `-p apps/web` for the app) |
| Production build | `npm run build` |
| Lint | `npm run lint` (loops over all three workspaces — see below) |
| Tests (Vitest) | `npx vitest` from the repository root (e.g. `npx vitest run packages/core/src/indicator`) |
| Prisma migration | `npx prisma migrate dev --name <change>` (run from `apps/web`, where `.env` lives) |
| Regenerate Prisma client | `npx prisma generate` (repository root — see below) |
| Inspect DB | `npx prisma studio` (run from `apps/web`) |
| Manually evaluate alerts | `curl http://localhost:3000/api/cron/evaluate` |

Prisma is pinned to **v6** (not v7) so the classic `datasource { url = env(...) }` setup works.
Don't run `npm i prisma@latest` without re-doing the Prisma 7 adapter migration.

The root `package.json` carries a `prisma.schema` pointer at `apps/web/prisma/schema.prisma`, so
`npx prisma generate` finds the schema from the repository root with no `--schema` flag. `migrate`
and `studio` also resolve the schema that way, but they additionally need `DATABASE_URL` (and the
other secrets) from `apps/web/.env`, which only loads when the CLI's cwd is `apps/web` — run those
two from there. A fresh clone needs `npx prisma generate` at least once before the app will start.

`npm run lint` is a loop over `@contour/core`, `@contour/ui` and `@contour/web` with a sticky
failure flag, not `--workspaces` — npm's `--workspaces` flag stops at the first failing workspace,
which was silently skipping `apps/web`. **It currently exits non-zero**: 21 pre-existing lint errors
(7 in `packages/ui`, 14 in `apps/web`) predate this restructuring and were deliberately left alone
rather than fixed as a drive-by. Don't mistake that non-zero exit for something the restructuring
broke.

## Architecture

```
packages/core/src/       Pure logic — no I/O, no framework. Runs in the browser, on the
                          server, and inside the Android APK.
  types.ts                Bar, Signal, Timeframe
                          (No transport lives here. Binance, Frankfurter/ECB, the equity
                          providers and CoinGecko are all in packages/data/src/sources/,
                          behind the injected Net; boundary.test.ts enforces it.)
  indicator/
    primitives.ts           sma, ema, rma, stdev, highest, lowest, crossover, crossunder, change, nz
    resample.ts             dailyToWeekly, projectWeeklyOntoDaily
    index.ts                run(bars) → { signals, series } — Risk Metric Strategy port
    risk-metric.test.ts     Vitest specs (primitives + resampler + warm-up behaviour)
  backtest.ts              simulate(bars, signals, { initialCapital, compounding })
                          DCA-aware: signals carry sizeFraction; multiple partial buys/sells.
  pinescript/
    analyze.ts               analyzePineScript(source) → Finding[] (rule-based linter)
    apply.ts                 applyImprovements(source, ids) → rewritten source + applied/skipped
    *.test.ts                Vitest specs (rules + transforms, 23 tests)
  boundary.test.ts         Fails the build if anything above imports Prisma, `node:fs`,
                          `web-push`, `ws` or `next/server`, or calls the global `fetch`
                          — see Workspaces below.
  portfolio.ts, delta-csv.ts, insights.ts, performance.ts, display.ts, display-tx.ts,
  export.ts, fx.ts, cash.ts, ranges.ts, chart-data.ts, asset-info.ts, asset-names.ts,
  alerts.ts, equity.ts, cache.ts, session.ts, storage-keys.ts
                          Portfolio maths, the Delta-by-eToro CSV importer, benchmark and
                          contributor insights, and the other pure logic shared by every screen.

packages/data/src/        The data seam (Phase 2) and the UI's data client (Phase 3) —
                          portable, and depends on packages/core. See "The data seam"
                          and "How a screen asks for data" below.
  ports/
    store.ts                Store — everything persisted (portfolios, transactions, settings)
    net.ts                  Net — everything fetched
  services/               valuation, series, portfolios, transactions, transfer, pricing,
                          lookup, settings, markets. Each takes a Store and/or a Net and does no
                          I/O of its own; the route handlers are thin wrappers over these.
    (guarded by ../layer.test.ts — fails if a service imports @/lib/* or
     next/*, reaches Prisma, or calls global fetch.)
  client/
    data-client.ts          DataClient — everything a screen is allowed to ask for, plus
                          the rules every implementation obeys. Read this one first.
    http-client.ts          HttpClient — calls today's routes over an injected Net.
    context.tsx             DataClientProvider / useDataClient.
    client-contract.ts      One suite, run against every implementation.
    stub-client.test.ts     The second implementation: the services over a MemoryStore,
                          held to the same suite. Not shipped — see the file's header
                          for what running it taught us.
  sources/                binance, fx (Frankfurter/ECB), equity, asset-info, markets
                          (CoinGecko + Yahoo screeners) — the only
                          transport in packages/core and packages/data, all of it behind
                          the injected Net. Nothing in packages/ui calls global fetch any
                          more; boundary.test.ts enforces that.
  testing/                MemoryStore, FakeNet, and store-contract.ts — one contract suite
                          run against both MemoryStore and the app's PrismaStore.
  errors.ts               NotFoundError, which routes map to a 404, and
                          RequestFailedError, which a screen shows to a person.

packages/ui/src/          Shared React components (18) plus useFitChart, usePrivacy and
                          useStoredRange. Depends on packages/core, not on apps/web.
                          The components that need data take a DataClient from context;
                          none names a route. Four /api/ URLs survive in markup rather
                          than in fetch calls (CoinIcon's <img src>, PortfolioManager's
                          three export anchors) — pinned by name in boundary.test.ts as
                          Phase 4 debt.

apps/web/src/             The Next server app.
  app/
    page.tsx                Redirects to /portfolio — the app's home is the portfolio,
                          and the tab bar and More page already list every destination.
                          Tab bar (TabBar.tsx): portfolio, markets, insights, and a
                          More button that opens MoreMenu over the page.
    portfolio/page.tsx      Holdings, valuation, day change and the history chart
    portfolio/[symbol]/     One asset. The half about the asset — price, chart,
                          background panel — renders whether or not it is held,
                          which is what Markets links into; the tiles and the
                          transaction table need a holding. Takes ?type= for the
                          asset kind, since without a holding there is nothing
                          to read it off.
    insights/page.tsx       Benchmarks, what made the money, concentration, activity
    markets/page.tsx        An index strip (two cards drawn, the rest behind "More"),
                          then the ranked table — ten rows, sortable, ten more per
                          tap out of the fifty the board carries — then the day's
                          winners and losers
    markets/[index]/        One exchange: its figures from the index's own chart
                          metadata, where it sits in its 52-week range, and its
                          major members. Membership is a fixed list — Yahoo's
                          components module needs the crumb (spec §4.2) — and the
                          page says so. A crypto card links to the asset page
                          instead; a coin is not an exchange
    chart/page.tsx          Live candlestick chart with indicator overlay. Takes
                          ?symbol=, which a crypto holding's sparkline links to.
                          Off BTCUSDT the risk line is drawn but its ladder is
                          not — the curves are fitted to Bitcoin. Reached from
                          More, not from a tab.
    more/page.tsx           "Portfolio data" — the import, the exports, the Android
                          build, the TradingView credit. The destinations that
                          used to live here are `MoreMenu`, opened from either nav
                          Reached from More:
    ledger/page.tsx         Every transaction, with Delta CSV import and export
    settings/page.tsx       Display currency, equity provider, HA URL + webhook, passkeys
    alerts/page.tsx         CRUD for alerts + "Evaluate now"
    backtest/page.tsx       Run backtest, view stats and trades
    analyze/page.tsx        Library selector + analyzer + apply-fixes + save-as
                          Unauthenticated:
    login/page.tsx          Password or passkey
    setup/page.tsx          First run — sets the password
    providers.tsx           Mounts DataClientProvider with HttpClient over WebNet. The one
                          place in apps/web that names an implementation.
    globals.css             Tailwind entry point; its `@source` directive names
                          packages/ui/src so Tailwind scans the shared components too.
    api/                  Twenty-three route groups. The converted ones are wrappers over
                          packages/data/src/services — see "The data seam" below; the
                          rest are listed there as deliberately server-only.
      portfolios/             CRUD, plus [id]/{valuation,series,changes,insights,
                          snapshot,export,import,transactions} and restore
      transactions/[id]/      PATCH/DELETE one transaction
      symbols/ asset/ history/ benchmark/
                          Symbol search, per-asset background, price history, benchmarks
      settings/               GET/PUT settings; POST sends a test signal to HA + Web Push
      markets/                The movers board, and [index] for one exchange —
                          wrappers over services/markets
      login/ logout/ setup/ webauthn/ push/
                          Auth, first-run and notification subscriptions — server-only
      candles/ backtest/ risk/ analyze/ scripts/ scripts/[name]/ cron/evaluate/
                          The strategy tooling and the alert evaluator — server-only
      icon/ app/download/     Cached asset icons; the built APK — server-only
  components/              BackgroundAlerts, PwaSetup — the only components that stayed
                          app-local instead of moving to packages/ui.
  lib/
    db.ts                    Prisma client singleton (avoids HMR connection leaks)
    auth.ts, webauthn.ts     Session and passkey auth — server-only, can't live in packages/core.
    repo-root.ts             Resolves repository-level paths (samples/, android/, the icon
                          cache) from this module's own location, not `process.cwd()` —
                          the server's cwd is apps/web, but those directories stayed at the
                          repository root. Any new root-relative path must go through it.
    notifier/
      index.ts                 Notifier interface + NotifierPayload
      home-assistant.ts        HomeAssistantNotifier — POSTs to ${HA_URL}/api/webhook/{id}
    pinescript/
      library.ts               List/read/write samples/*.pine (filesystem-backed)

apps/web/prisma/
  schema.prisma            Alert, AlertEvent, BacktestRun, Settings
  migrations/               Auto-generated
  dev.db                    Local SQLite file (gitignored)

samples/                  Bundled PineScripts; new versions are written here as
                          <stem>.fixes.pine (auto-incremented on conflict). Stayed at the
                          repository root — see repo-root.ts above.
android/, scripts/, capacitor.config.ts
                          The Capacitor shell. Also stayed at the repository root.
```

## Workspaces

Three workspaces, and the rule that keeps them apart:

- `packages/core` — pure logic. Runs in a browser, on a server, and inside an
  Android APK. `packages/core/src/boundary.test.ts` fails the build if
  anything here imports Prisma, `node:fs`, `web-push`, `ws` or `next/server`.
  When that test fails, the fix is to move the file to `apps/web`, never to
  add the module to the allowed list.
- `packages/ui` — shared React components. Tailwind only sees them because
  `apps/web/src/app/globals.css` names them in an `@source` directive; a
  second app needs its own.
- `apps/web` — the Next server app: pages, API routes, Prisma, middleware,
  and the four modules that cannot leave a server.

`packages/*` are consumed through tsconfig path aliases, not node resolution.
There is no build step and no `main` field, and `@/lib/*` and `@/components/*`
still resolve exactly as they always did.

## The data seam

Phase 2 moved the logic out of the route handlers into a portable service layer so the same code can
answer an HTTP request today and run inside an APK with no server in Phase 4. The rule is short:
**a service takes its outside world as arguments.**

**Two ports, in `packages/data/src/ports/`.**

- `Store` (`store.ts`) — everything persisted: portfolios, transactions, settings. Methods, not
  tables: `portfolios.list/get/create/rename/remove/count`, `transactions.add/addMany/update/remove/
  removeMany/removeAllIn/countByPortfolio`, `settings.get/save/exists`.
- `Net` (`net.ts`) — everything fetched. `net.json(url)` for the common case, `net.request(url)` when
  a caller needs to tell a non-2xx apart from a transport failure.

They are injected because the implementations differ per platform and nothing else does. The server
wires them once in `apps/web/src/lib/deps.ts` (`PrismaStore` + `WebNet`); tests wire `MemoryStore` +
`FakeNet` from `packages/data/src/testing/`; Phase 4 wires `SqliteStore` + `CapacitorNet`. The
service in between cannot tell which it got, which is the whole point.

**Services are pure of HTTP and persistence.** No `prisma`, no `next/*`, no global `fetch`, and no
`@/lib/*` — that alias is a fallback array under `apps/web`'s tsconfig and reaches the server-only
`apps/web/src/lib`, so portable code uses the unambiguous `@/core/*`.
`packages/data/src/layer.test.ts` fails if one of those appears, naming the rule that
broke. `packages/core/src/boundary.test.ts` guards the packages more broadly; the overlap is
deliberate, since the failure worth catching is a service quietly reaching for `prisma` because the
route it was extracted from used to.

**Route handlers are wrappers, and must stay that way.** Parse the request, call the service, map
errors to statuses, respond. Response *shaping* (a display order, a legacy `id: 1`, an ISO string) is
a route's job — a service has no route to please. Business logic is not. If a handler grows past
about forty lines, the excess almost certainly belongs in a service.

Shaping is not a licence to read the database. `GET /api/settings` has to tell a virgin install from
a configured one, and reached for `prisma.settings.findUnique` to do it; that is a *persistence read
used to make a decision*, and it became `settings.exists()` on the port. The test is whether Phase
3's `DataClient` could answer the same question — if it could not, the route is deciding something
the seam cannot carry, and the mobile build will silently differ.

**Deliberately left inline, permanently:** the alerts routes, the strategy tooling (`backtest`,
`candles`, `risk`, `analyze`, `scripts`, `cron/evaluate`), auth (`login`, `webauthn/*`, `setup`),
push, the icon and APK-download routes, and `POST /api/settings` — all server-only integrations the
mobile build will never call, and moving them would drag Home Assistant, web-push and the filesystem
into a package that has to run inside an APK with none of them available. One partial exception:
`GET /api/asset/[symbol]` is converted for crypto but still calls the server-only
`apps/web/src/lib/equity-info.ts` for equities, because Yahoo's cookie-and-crumb handshake needs a
response header that `Net` does not expose. That gap and its remedy are written up in spec §4.2.

**The parity harness** is how "this conversion changed no behaviour" becomes checkable:

```bash
npm run build && npm run start -- -p 3001 &
node scripts/parity.mjs capture .parity-baseline.json /api/portfolios /api/settings ...
# convert, rebuild, restart
node scripts/parity.mjs compare .parity-baseline.json
```

**What it cannot catch**, and this matters more than the green tick: a constant proportional shift
under a tolerance. The `rel` bounds are per-leaf and relative, so an error scaling every number by
the same small factor passes every one of them — a systematic 1% error across all 365 points of
`series[]` looks exactly like ordinary price drift at each point. That is the most likely way a
currency conversion or a fee treatment goes wrong. It also only issues GETs, so write paths have no
coverage at all. A green `compare` is necessary, not sufficient: on anything touching valuation or
series maths, check two or three absolute figures by hand against the previous build.

Capture and compare on the **same UTC day**. Every windowed endpoint (`series`, `history`,
`benchmark`) is anchored to "now", so a baseline from yesterday shifts the whole array one position
and reports a DIFF on all of them for no reason at all. If a compare lights up across exactly those
routes, check the baseline's `capturedAt` before reading anything into it.

`/api/asset/<symbol>` is the one endpoint that drifts no matter what: its market cap, volume and
From-ATH figures are formatted strings, so no tolerance is expressible, and they refresh hourly.
A DIFF confined to those, the sentiment score and the news list is the expected state; the harness
header says what to check before waving it through.

**What comes next.** Phase 3 replaced the UI's `fetch("/api/…")` call sites with a `DataClient` —
see the next section. Phase 4 adds `SqliteStore` and `CapacitorNet`, writes `LocalClient` over the
services, and builds the APK against the same three interfaces.

## How a screen asks for data

Phase 3 finished the seam at the other end. Phase 2 moved the logic behind `Store` and `Net`;
Phase 3 stopped the screens naming routes. **A screen takes a `DataClient` from React context and
calls a method. It never names an implementation, a URL or a status code.**

`packages/data/src/client/data-client.ts` is the interface, and its header comment is the
authority — the rules below are the summary, not the source.

- **One implementation today.** `HttpClient` (`http-client.ts`) calls the existing routes over an
  injected `Net`. It is the last file in the tree that knows about response envelopes
  (`{ portfolios }`, `{ settings }`) and status codes. `apps/web/src/app/providers.tsx` mounts it,
  and is the only place in `apps/web` that says its name.
- **A second implementation is tested, not shipped.** `stub-client.test.ts` builds a client from the
  services over a `MemoryStore` and runs `client-contract.ts` against it unchanged. A contract that
  only ever runs against `HttpClient` proves that `HttpClient` agrees with itself; this is what
  proves the interface is not HTTP-shaped. Its header records what the exercise found. Phase 4's
  `LocalClient` replaces it and must pass the same suite.
- **Errors are typed.** A method that names a record throws `NotFoundError`; everything else throws
  `RequestFailedError`, which carries `kind: "unreachable" | "refused"` so a screen can tell "no one
  answered" from "someone answered and said no". Nothing resolves to `undefined` to mean failure.
- **A capability one platform cannot have is absent, not throwing.** `sendTestNotification` is
  optional (`method?()`) because Home Assistant and Web Push do not exist inside an APK; the settings
  screen feature-detects it and does not draw the button when it is missing. Any future web-only
  capability follows the same rule, and the default answer is still that it does not belong on this
  interface at all. The full argument is in `data-client.ts`.

**Deliberately unconverted, permanently.** These screens keep raw `fetch`, and
`apps/web/src/screen-boundary.test.ts` allows them by name with a written reason:

| Screen | Why |
|---|---|
| `chart`, `backtest`, `analyze`, `alerts` | The strategy tooling. Server-side Binance proxying, the filesystem under `samples/`, and Home Assistant dispatch — the mobile build renders none of it. |
| `login/LoginForm.tsx` | Session auth and passkeys. A device build has no login screen to convert. |
| `settings` (nine of its twelve requests) | `/api/logout`, `/api/settings/password`, `/api/webauthn/*`, `/api/push/*` — browser-and-server mechanisms rather than data. The settings row itself does go through the client. |
| `components/BackgroundAlerts.tsx` | Polls the same server-only alerts route. |

The allowlist is per file, and `settings` is allowed only its four named route prefixes, so a tenth
request cannot arrive under cover of the same exemption. A `fetch` whose URL is computed counts as
unnamed and only a whole-file exemption covers it. Adding an entry means writing why — that is the
whole mechanism, and the point at which most would-be entries turn out not to have a reason.

`packages/core/src/boundary.test.ts` carries the matching rule for the shared components: no global
`fetch` in `packages/ui` at all, and no *new* `/api/` string literal either. Four such literals
survive — `CoinIcon`'s `<img src>` and `PortfolioManager`'s three export anchors — because each
needs a mechanism Phase 4 has to design (a device-capable icon strategy; a way to save a file, and a
`DataClient` method to feed it). They are listed literally, with what each needs, so the debt is
visible and cannot grow.

## The load-bearing contract

`packages/core/src/indicator/index.ts` exports **`run(bars: Bar[]): { signals, series }`** — a pure function
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
