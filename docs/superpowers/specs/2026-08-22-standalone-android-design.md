# Standalone Android build — design

**Status:** approved, ready for planning · **Date:** 2026-08-22 · **Author:** Roy

Turn the Capacitor wrapper into a real offline Android application, without
giving up the locally hosted web app. One repository, two build targets, one
copy of every screen.

Companion to `docs/strategy/2026-08-22-delta-exit.md`, which sets the product
scope and the Phase 0 gate. This document decides the architecture only; where
the two disagree on structure, this one wins, and the divergence is recorded in
§10.

---

## 1. Goal

Today `capacitor.config.ts` points the Android shell at
`http://192.168.2.5:3001`. The app is a window onto a running server: no
server, no app. It cannot be handed to anyone, and it does not work on a train.

After this work there are two artefacts built from one repository.

- **`apps/web`** — the app exactly as it stands. Server, Prisma, session
  middleware, alerts, Home Assistant, the risk-metric indicator, the
  backtester, the script analyser. No feature is removed.
- **`apps/mobile`** — a standalone APK that bundles its own UI and stores its
  own data. Portfolio, per-asset pages, ledger, insights, Delta import,
  export, privacy mode. No server, no account, no login. The only outbound
  requests are price and asset-metadata lookups.

Non-goal: the two never sync. A portfolio on the phone and a portfolio on the
server are unrelated. The bridge between them is the JSON export, which
already exists.

## 2. Scope

| In `apps/mobile` for v1 | Deliberately absent |
|---|---|
| Portfolio list, holdings, value chart | Alerts and scheduled evaluation |
| Per-asset pages with transaction history | Home Assistant webhook |
| Ledger — cost basis, realised profit, fees | Risk-metric indicator and `/chart` |
| Insights | Backtester |
| Delta CSV import | PineScript analyser |
| Ghostfolio CSV export and JSON backup | Accounts, login, passkeys, sessions |
| Privacy mode | Push notifications |
| Crypto prices, no key required | Any sync between phone and server |
| Equity prices via a user-supplied free key | |

Everything in the right-hand column stays in `apps/web` and keeps working
there. Nothing is deleted from the project.

## 3. Repository layout

```
packages/core/       today's src/lib, minus db.ts and webauthn.ts
                     indicator/ portfolio delta-csv insights performance
                     display export fx cash ranges chart-data asset-info …
                     mostly pure functions with no I/O, 193 tests; the four
                     fetching modules take a Net rather than owning one (§4.2)

packages/ui/         today's src/components, minus BackgroundAlerts and PwaSetup
                     StatTile TxForm CoinIcon ValueChart ComparisonChart
                     RangePicker SymbolPicker TabBar TopNav BiometricLock
                     PrivacyToggle ContourMark AssetInfoPanel TradingBackdrop
                     PortfolioManager useFitChart usePrivacy useStoredRange

packages/data/       the seam: DataClient, Store and Net interfaces,
                     the services that implement each operation,
                     HttpClient, LocalClient, and the contract test suite

apps/web/            Next app — every current page, api/*, middleware,
                     prisma/, PrismaStore, BackgroundAlerts, PwaSetup
apps/mobile/         Next app — subset of pages, output: "export",
                     SqliteStore, CapacitorNet, capacitor.config.ts, android/
```

npm workspaces. No new build tool; `packages/*` are TypeScript sources
consumed directly through workspace path mapping, not published artefacts.

Six of the 38 files in `src/lib` do not move, each because it imports
something that only exists on a server:

| File | Server dependency |
|---|---|
| `db.ts` | `@prisma/client` |
| `webauthn.ts` | `@simplewebauthn/server`, `next/server` |
| `auth.ts` (and its test) | `crypto` — `scrypt` password hashing |
| `pinescript/library.ts` | `node:fs/promises` |
| `notifier/` (whole directory) | `web-push`, and it is alerts infrastructure |

`auth.ts` is no loss to the mobile build, which has no password to hash: it
locks with the device, per §7.

`binance.ts` is a fifth case with a different remedy: it opens with
`import WebSocket from "ws"`, which would break a browser bundle. The import
exists only for `subscribeKlines`, which has **zero callers anywhere in the
repository**. It is dead code, and deleting it removes both the function and
the `ws` dependency rather than working around them.

That leaves 31 of 38 files moving untouched, which is the whole reason this is
a port and not a rewrite — and it is a property worth defending mechanically
rather than by intention, so `packages/core` gets a test that fails if anyone
imports a server-only module into it.

`TabBar` and `TopNav` move to `packages/ui` but stop hard-coding their
destinations. Each app passes its own list, because the mobile app has fewer
places to go.

## 4. The seam

The naive framing — "swap `fetch('/api/…')` for a storage call" — is wrong,
and getting this right is the core of the design.

Roughly half the endpoints are not storage reads. `valuation`, `series`,
`changes`, `insights`, `snapshot` and `benchmark` each combine a database
read, one or more live price fetches, currency conversion, and pure
computation. `valuation` alone reads a portfolio and the settings row, fetches
crypto spot prices, equity quotes, previous closes and an ECB rate, then calls
`computeHoldings` and `valueHoldings`. That logic has to *move somewhere
shared*, not be reimplemented behind a storage call.

So there are **two interfaces, with two implementations each**.

```
UI  ──▶  DataClient   ┌─ HttpClient    fetch("/api/…")                [web]
                      └─ LocalClient   calls services directly        [mobile]

services  ──▶  Store  ┌─ PrismaStore   Prisma + SQLite on the server  [web]
          ──▶  Net    └─ SqliteStore   @capacitor-community/sqlite    [mobile]
                         WebNet (global fetch) │ CapacitorNet (CapacitorHttp)
```

### 4.1 `Store`

Record-level persistence, nothing else. No business logic, no computation.

```ts
interface Store {
  portfolios: {
    list(): Promise<Portfolio[]>;
    get(id: string): Promise<PortfolioWithTransactions | null>;
    create(name: string): Promise<Portfolio>;
    rename(id: string, name: string): Promise<Portfolio>;
    remove(id: string): Promise<void>;
    count(): Promise<number>;
  };
  transactions: {
    add(portfolioId: string, tx: NewTransaction): Promise<Transaction>;
    addMany(portfolioId: string, txs: NewTransaction[]): Promise<number>;
    update(id: string, patch: TransactionPatch): Promise<Transaction>;
    remove(id: string): Promise<void>;
    removeMany(ids: string[]): Promise<number>;
    removeAllIn(portfolioId: string): Promise<void>;
    countByPortfolio(): Promise<Record<string, number>>;
  };
  settings: {
    get(): Promise<Settings>;
    save(patch: SettingsPatch): Promise<Settings>;
  };
}
```

> **As built (Phase 2).** The signatures above are the shipped ones in
> `packages/data/src/ports/store.ts`; the first draft of this section named them
> `create`/`update`/`delete`/`createMany`/`deleteFor`. Four differences are worth
> the note:
>
> - `create`/`rename` take the field rather than a patch object, because a
>   portfolio has exactly one mutable field and a `PortfolioPatch` type would
>   have had one member.
> - `remove` rather than `delete`: `delete` is a reserved word, so a
>   `store.portfolios.delete` shorthand method is awkward to write in an object
>   literal and impossible to reference bare.
> - `transactions.listFor` was never needed — every caller already holds the
>   portfolio, whose `get` returns its transactions — and was dropped rather
>   than shipped unused.
> - Two methods the draft did not have earn their place as *aggregates the
>   backing store can do far better than the caller*: `countByPortfolio()`,
>   which replaced an N+1 over the portfolio list, and `removeMany(ids)`, which
>   is one `deleteMany` on Prisma instead of a delete per row.

The `id: 1` singleton disappears into `settings.get()`. It is correct on both
targets — one settings row per server, one per install — and the twenty call
sites that spell it out today collapse to one.

### 4.2 `Net`

```ts
interface Net {
  json<T>(url: string, init?: RequestInit): Promise<T>;
  text(url: string, init?: RequestInit): Promise<string>;
}
```

`WebNet` wraps global `fetch`. `CapacitorNet` wraps `CapacitorHttp`, which
issues requests natively and is therefore not subject to CORS. This is
load-bearing rather than convenient: Yahoo's quote endpoint requires a
cookie-and-crumb handshake and sends no CORS headers, so a browser cannot call
it and a pure PWA cannot ship this feature at all. The native shell is the
reason zero-infrastructure is possible.

Every outbound call in `packages/core` — `binance.ts`, `equity.ts`, `fx.ts`,
`asset-info.ts` — takes `Net` as a parameter instead of reaching for global
`fetch`. This is the single most invasive change to `packages/core` and the
main reason those files are not a pure move.

> **Superseded by Phase 2.** Transport does not live in `packages/core` taking a
> `Net`; it lives in `packages/data/src/sources/` (`binance.ts`, `fx.ts`,
> `equity.ts`, `asset-info.ts`), and `packages/core` is now *pure* — it has no
> outbound calls at all, and `packages/core/src/boundary.test.ts` fails the
> build if one reappears.
>
> The reason is that by the time the services were converted, only four
> server-only consumers of core's transport were left. Threading a `Net`
> through core in place would have meant invasive surgery on code that will
> never run on a device, to reach four call sites — where moving the four
> files across gave the same portability with a smaller diff and a stronger
> guarantee, since "core is pure" is a rule a test can state, and "core takes a
> `Net` everywhere" is a habit.
>
> `Net` also ships a third method the draft above omits, `request(url, init):
> Promise<NetResponse>`, exposing `ok`/`status` for the seven call sites that
> treat a non-2xx as a value rather than an error. Without it those sites would
> have had to catch, which also swallows the JSON-parse and transport failures
> that should propagate.

#### Known gap: `Net` cannot express the cookie-and-crumb handshake

The feasibility argument above rests on `CapacitorHttp` being able to perform
Yahoo's handshake. `Net`, as built, cannot ask for it: `NetResponse` exposes
`ok`, `status`, `text()` and `json()` — **no response headers** — so a caller
cannot read the `Set-Cookie` that the crumb request depends on. This is not an
oversight to patch by adding a header getter, either: `Set-Cookie` is
unreadable from browser `fetch` regardless of what the interface offers, so a
header-reading contract is one only a Node `WebNet` could honestly keep, and
`CapacitorNet` would satisfy it in name only.

Consequently the equity asset-info path was **not** converted in Phase 2. It
remains server-only, in `apps/web/src/lib/equity-info.ts`, reached directly by
`GET /api/asset/[symbol]` when `assetType=equity`. Equity *quotes* went through
fine; it is only the quoteSummary profile lookup that needs the handshake.

**Decided remedy, for Phase 3 or 4:** give `Net` **cookie-jar semantics** rather
than header reading. Requests issued through one `Net` instance share a cookie
jar, so a caller performs the handshake by making the two requests in order and
never touches a header. Both implementations can satisfy that honestly — a Node
`WebNet` with an explicit jar, a `CapacitorNet` on the native HTTP stack's own
cookie store — which is exactly the property the header contract lacks.

**Until that lands, §4.2's feasibility claim is argued, not demonstrated.** The
native shell is *expected* to make the handshake work; nothing in the tree yet
proves a `Net` implementation can do it. The Phase 3 or 4 task that adds the
cookie jar should port `equity-info.ts` behind it, and that port is what turns
the argument into evidence.

### 4.3 `services`

One function per operation, each taking its dependencies explicitly:

```ts
export async function valuation(store: Store, net: Net, id: string): Promise<Valuation>
export async function importDelta(store: Store, id: string, csv: string): Promise<ImportReport>
```

A web route handler becomes a wrapper with no logic of its own:

```ts
export const dynamic = "force-dynamic";
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return NextResponse.json(await valuation(prismaStore, webNet, id));
}
```

> **As built.** The two implementations are not free variables; the route asks
> `deps()` (`apps/web/src/lib/deps.ts`) for `{ store, net }`, which is the one
> module on the server that knows `PrismaStore` and `WebNet` exist. Phase 4
> supplies its own `deps()` against the same interfaces. Handlers do keep one
> job beyond "no logic of its own": mapping a `NotFoundError` to a 404, and
> response *shaping* — a display sort order, a legacy `id: 1`, an ISO date
> string. Those are the wire format, which is a route's business and not a
> service's.

### 4.4 `DataClient`

What the UI sees. One method per operation, named for the operation rather
than for a URL.

```ts
interface DataClient {
  listPortfolios(): Promise<PortfolioSummary[]>;
  createPortfolio(input: NewPortfolio): Promise<Portfolio>;
  getPortfolio(id: string): Promise<Portfolio>;
  renamePortfolio(id: string, name: string): Promise<Portfolio>;
  deletePortfolio(id: string): Promise<void>;

  valuation(id: string): Promise<Valuation>;
  series(id: string, range: RangeKey): Promise<Series>;
  changes(id: string): Promise<Changes>;
  insights(id: string): Promise<Insights>;
  snapshot(id: string): Promise<Snapshot>;
  benchmark(id: string, symbol: string, range: RangeKey): Promise<Series>;

  listTransactions(id: string): Promise<DisplayTx[]>;
  addTransaction(id: string, tx: NewTx): Promise<Transaction>;
  updateTransaction(txId: string, patch: TxPatch): Promise<Transaction>;
  deleteTransaction(txId: string): Promise<void>;

  importDelta(id: string, csv: string): Promise<ImportReport>;
  exportCsv(id: string): Promise<string>;
  exportJson(id: string): Promise<string>;
  restore(json: string): Promise<Portfolio>;

  getSettings(): Promise<Settings>;
  saveSettings(patch: SettingsPatch): Promise<Settings>;

  symbols(query: string): Promise<SymbolHit[]>;
  assetInfo(symbol: string): Promise<AssetInfo>;
  history(symbol: string, range: RangeKey): Promise<Candle[]>;
  iconUrl(symbol: string, type: AssetType): string;
}
```

`HttpClient` calls the existing routes. `LocalClient` calls the services with
`SqliteStore` and `CapacitorNet`. The UI reaches its client through one React
context provider, supplied at the app root — `apps/web` provides `HttpClient`,
`apps/mobile` provides `LocalClient`. No screen imports either implementation.

`iconUrl` returns a string rather than a promise because `CoinIcon` needs a
value for an `<img src>`. See §7.

**The invariant:** both implementations return identical DTOs for identical
inputs. This is what makes one copy of each screen possible, and it is
enforced mechanically — see §8.

## 5. Device storage

`@capacitor-community/sqlite`, with the schema transcribed from
`prisma/schema.prisma` minus the five models the mobile app has no use for:
`Alert`, `AlertEvent`, `BacktestRun`, `WebAuthnCredential`, `PushSubscription`.
`Portfolio`, `Transaction` and `Settings` remain.

Migrations are hand-owned: a `user_version` pragma and an ordered array of
migration functions, applied on open. Prisma was doing this; now it does not.
That is the real cost of choosing SQLite over documents on disk, and it is
accepted deliberately for schema parity with the web build and for headroom if
a ledger ever outgrows whole-file rewrites.

The transcription is mechanical because the query surface is narrow. Across
all 39 route handlers there is no `groupBy`, no `aggregate`, no `$queryRaw`, no
`$transaction`, and exactly one relational `include` — a portfolio with its
transactions. Every route loads whole records and computes in JavaScript. The
ORM is being used as a document store, so `SqliteStore` is a transcription and
not a query-rewriting exercise.

Prisma's `BigInt` timestamps stay `number` at the `Store` boundary, as they
already do at the API boundary today.

## 6. Two blockers, and their fixes

Both were found by reading the code and both would stop a mobile build dead.

**`/portfolio/[symbol]` cannot be statically exported.** Under
`output: "export"` a dynamic segment requires `generateStaticParams`, and the
set of symbols is user data that does not exist at build time. On mobile the
route becomes `/portfolio/asset?symbol=BTC`: one statically exported page
reading a query parameter. The page is already `"use client"` and already
consumes the param, so this is a routing change, not a rewrite. `apps/web`
keeps the path-segment URL. The two apps therefore differ in their route files
while sharing the page body from `packages/ui`.

**`middleware.ts` does not run in a static export.** No loss — it enforces the
session cookie, and the mobile app has no session. It stays in `apps/web`.

Neither app can contain the other's routes, which is precisely why the
monorepo split is the mechanism rather than build-time file surgery: each app
directory holds only what it can serve, and the compiler says so.

## 7. Lock, and the icon question

Device lock through `@aparajita/capacitor-biometric-auth`, already a
dependency and already wrapped by the `BiometricLock` component. No password,
no passkeys, no `SESSION_SECRET`, no `/login` or `/setup` route on mobile.
Falling back to the device PIN is the plugin's own behaviour and is the right
one — a lock this app cannot itself reset.

`CoinIcon` currently routes every logo through `/api/icon`, and the comment
above it states the reason: "the phone never talks to an icon CDN, so nothing
outside learns what is held." Removing the server removes that proxy, and with
it the guarantee.

**Decision: bundle icons in the APK, fall back to initials.** A build-time
asset list of roughly the top 200 crypto and equity logos ships inside the
app; anything unknown gets the existing coloured-initials fallback, which is
already implemented and already looks deliberate. The alternative — calling
the CDN directly from the device — would quietly break a promise written into
the code, in an app whose entire pitch is that the portfolio does not leave
the phone. `iconUrl` returns a bundled asset path on mobile and `/api/icon` on
web, which is why it is a synchronous string on the interface.

## 8. Testing

`packages/core` keeps its 193 tests unchanged. They are pure-function tests
and the move does not touch them; if any test needs editing during phase 1,
that is a signal the move went wrong.

**New: a `DataClient` contract suite** in `packages/data`. One set of
behavioural tests written against the interface, executed twice — once against
`LocalClient` backed by an in-memory SQLite, once against `HttpClient` backed
by a test server over `PrismaStore`. Same assertions, same fixtures, both
implementations.

This suite is the mitigation for R5 in the strategy document. Branch drift
stops being a discipline problem and becomes a failing test.

`SqliteStore` additionally gets migration tests: open at each historical
`user_version`, migrate forward, assert the resulting schema and that no data
was lost.

## 9. Sequencing

Phase 0 comes from the strategy document, is unchanged, and remains a gate:
**five or more real Delta exports from other people, under 1% unmapped rows,
no per-user special-casing.** The parser has only ever seen its author's
export. If it does not generalise, everything below is wasted motion, and a
week spent finding out is cheap against a month of restructuring.

| Phase | Work | State at the end |
|---|---|---|
| 1 | Workspaces; extract `packages/core` and `packages/ui`; web becomes `apps/web` | Web app works; 193 tests green; no behaviour change |
| 2 | Define `Store` and `Net`; move route-handler logic into `services/`; routes become wrappers; `PrismaStore` and `WebNet` | Web app works; behaviour unchanged |
| 3 | Define `DataClient`; write `HttpClient`; convert all 66 UI fetch sites; contract suite runs against `HttpClient` | Web app works; behaviour unchanged |
| 4 | `apps/mobile`: static export, `SqliteStore`, `CapacitorNet`, `LocalClient`, device lock, `?symbol=` routing, bundled icons | First real APK; contract suite runs against both |
| 5 | Import, export and first-run polish | Shippable |
| 6 | GitHub Releases, then F-Droid | Released |

The property being bought: **phases 1–3 are the bulk of the work and every one
of them ends with the web app running and the tests green.** There is never a
broken tree waiting on a mobile build to come good. By phase 4 the mobile app
is mostly new files rather than edits to old ones, which is the cheapest kind
of work to get wrong and retry.

Phase 4 is also the first point at which anything visible happens, which is a
genuine cost and was accepted knowingly. Pulling it earlier would mean
building the mobile app against a seam that does not exist yet, and then
building the seam twice.

## 10. Divergence from the strategy document

`docs/strategy/2026-08-22-delta-exit.md` §5 proposes two branches, personal
and public. This design supersedes that with one repository and two build
targets.

The reason: §7 of that document rates branch drift (R5) as low impact and high
likelihood. The likelihood is right and the impact is understated. Two
branches of a *library* diverge slowly, because the interface holds them
together. Two branches of a *user interface* diverge on contact — a spacing
fix, a copy change, a new `StatTile` prop, and within a month the two apps are
different products with a shared history. The BRAND.md audit exists precisely
because UI drifts when nobody is enforcing it.

One copy of each screen makes the drift impossible rather than discouraged,
and the contract suite makes the data layer's parity a test rather than a
promise. The cost is phase 1, which is a restructure with nothing to show for
it.

Product scope, the Phase 0 gate, the risk register and the open decisions in
that document are unaffected and remain in force.

## 11. Open decisions carried forward

Unchanged from the strategy document, still needed, none of them technical.
The first one blocks the rest.

- **Licence.** There is no `LICENSE` file. Without one nobody may legally use
  or fork this, which contradicts the entire premise of shipping it. This
  should be settled before phase 1, not before phase 6.
- **Support policy.** Stated on day one, not after the first complaint.
- **Name.** Does the public app keep Contour?
- **Public repository, or public builds only?**
- **Does the mobile build ever get the strategy tools?** Recommendation
  remains no.
