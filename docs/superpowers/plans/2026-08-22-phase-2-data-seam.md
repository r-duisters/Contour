# Phase 2 — The data seam, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the logic inside the API route handlers into a portable `services/` layer that depends on two injected ports — `Store` for persistence and `Net` for outbound HTTP — so the same functions can run on a server today and inside an Android APK in Phase 4.

**Architecture:** A new workspace, `packages/data`, holds the `Store` and `Net` interfaces and the services written against them. `apps/web` supplies the server implementations (`PrismaStore`, `WebNet`) and its route handlers shrink to one-line wrappers. Services never import Prisma, `next/*`, or global `fetch`; a boundary test enforces that mechanically. Behaviour does not change: every response body must be byte-identical to what the route returned before.

**Tech Stack:** Next.js 16.2.6 (App Router), TypeScript 5, Prisma 6 + SQLite, Vitest 3, Zod, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-22-standalone-android-design.md` — §4 defines the seam, §9 places this phase.

## Global Constraints

- **Every task ends green.** `npx vitest run` passes with a count that only ever goes up, `npm run typecheck` is silent, and `npm run build` succeeds. A dropped test is a defect, never a cleanup.
- **Behaviour does not change.** Every converted endpoint must return a byte-identical body for the same inputs. This is the single most important constraint in the phase, and Task 1 builds the tool that proves it.
- **`packages/data` stays portable.** No `@prisma/client`, no `next/*`, no `node:*`, no bare Node builtins, and **no global `fetch`** — outbound calls go through the injected `Net`. `packages/core/src/boundary.test.ts` enforces this; Task 1 extends it to cover the new package.
- **New code uses `@/data/*`.** This alias has **no fallback array** — unlike `@/lib/*`, which resolves `packages/core` before `apps/web/src/lib` and would let a service silently shadow an app module of the same name.
- **Prisma stays pinned to v6.** Do not run `npm i prisma@latest`.
- **Run vitest from the repository root.** Some tests resolve fixtures from `process.cwd()`.
- **Repository-level paths go through `apps/web/src/lib/repo-root.ts`**, never `process.cwd()`. The server's cwd is `apps/web`; `samples/` and `android/` are at the repository root.
- **`npm run lint` currently exits non-zero** — 21 errors predate Phase 1 and are deliberately unfixed. Do not fix them, and do not treat the non-zero exit as something you broke. Do not *add* to the count.
- Comments explain *why*, not *what*. `BRAND.md` governs anything user-facing; nothing in this phase is.

## Scope

**Converted in this phase** — the endpoints the mobile v1 needs, plus the ones tangled in the same duplication:

`portfolios` · `portfolios/[id]` · `valuation` · `series` · `changes` · `insights` · `snapshot` · `transactions` (create) · `transactions/[id]` · `import` · `export` · `restore` · `settings` (GET/PUT) · `symbols` · `asset/[symbol]` · `history` · `benchmark`

**Deliberately left as inline route handlers:** `alerts`, `alerts/[id]`, `cron/evaluate`, `backtest`, `risk`, `candles`, `analyze`, `scripts`, `scripts/[name]`, `login`, `logout`, `setup`, `settings/password`, `settings` POST (the Home Assistant test ping), `webauthn/*`, `push/*`, `app/download`, `icon`.

The mobile build will never call these — they are alerts, strategy tools, or server-side auth. Converting them would be churn against a benefit that does not exist. Spec §2 already scopes them out of the mobile app; this plan simply declines to pay for them.

## File Structure

```
packages/data/
  package.json                  @contour/data — no main, no build step
  src/
    ports/
      store.ts                  Store interface + the record types it moves
      net.ts                    Net interface
    testing/
      memory-store.ts           in-memory Store, for service tests
      fake-net.ts               scripted Net, for deterministic price tests
      store-contract.ts         the suite every Store implementation must pass
    services/
      pricing.ts                displayContext() — the six-way duplication
      portfolios.ts             list/get/create/rename/delete
      transactions.ts           add/update/remove
      valuation.ts              valuation + snapshot
      series.ts                 series, changes, benchmark, history
      transfer.ts               import, export, restore
      settings.ts               get/save
      lookup.ts                 symbols, assetInfo
    index.ts                    the package's public surface

apps/web/src/lib/
  store/prisma-store.ts         Store over Prisma
  net/web-net.ts                Net over global fetch
  deps.ts                       one place that builds { store, net }
```

Each service file owns one domain and is independently testable against `MemoryStore` and `FakeNet`. Nothing in `packages/data` knows what a `Request` is.

---

### Task 1: The ports, the fakes, and the parity harness

Nothing is converted in this task. It builds the interfaces the rest of the phase depends on, and — more importantly — the tool that proves conversions change nothing.

**Files:**
- Create: `packages/data/package.json`, `packages/data/src/ports/store.ts`, `packages/data/src/ports/net.ts`, `packages/data/src/index.ts`
- Create: `packages/data/src/testing/{memory-store.ts,fake-net.ts,store-contract.ts}`
- Create: `packages/data/src/testing/store-contract.test.ts` (runs the contract against `MemoryStore`)
- Create: `apps/web/src/lib/store/prisma-store.ts`, `apps/web/src/lib/net/web-net.ts`, `apps/web/src/lib/deps.ts`
- Create: `apps/web/src/lib/store/prisma-store.test.ts` (runs the same contract against `PrismaStore`)
- Create: `scripts/parity.mjs`
- Modify: `tsconfig.json`, `apps/web/tsconfig.json` (add `@/data/*`)
- Modify: `package.json` (workspace lint loop gains `@contour/data`)
- Modify: `packages/core/src/boundary.test.ts` (cover `packages/data`; forbid global `fetch`)

**Interfaces:**
- Consumes: nothing from Phase 2.
- Produces, and every later task depends on these exact names:
  - `Store` with `portfolios`, `transactions`, `settings` sub-objects (full signature in Step 2).
  - `Net` with `json<T>(url, init?)` and `text(url, init?)`.
  - `MemoryStore(seed?: StoreSeed): Store` and `FakeNet(routes: Record<string, unknown>): Net`.
  - `runStoreContract(name: string, makeStore: () => Promise<Store>)` — a Vitest suite factory.
  - `deps()` in `apps/web/src/lib/deps.ts`, returning `{ store, net }`.
  - `node scripts/parity.mjs <path...>` — captures or compares endpoint responses.

- [ ] **Step 1: Create the workspace**

`packages/data/package.json`:

```json
{
  "name": "@contour/data",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "lint": "eslint"
  }
}
```

`packages/data/eslint.config.mjs`:

```js
// Re-exported rather than shared by reference: ESLint resolves a flat config's
// ignore patterns against the config file's own directory, so each workspace
// needs its own entry point for `.next/**`-style ignores to mean anything.
export { default } from "../../eslint.config.mjs";
```

Add `@contour/data` to the lint loop in the root `package.json`, keeping the sticky-failure form:

```json
"lint": "fail=0; for w in @contour/core @contour/ui @contour/data @contour/web; do npm run lint --workspace $w --if-present || fail=1; done; exit $fail",
```

Then `npm install` and commit the lockfile delta — a new workspace that is not in the lockfile breaks `npm ci`.

- [ ] **Step 2: Define the ports**

`packages/data/src/ports/store.ts`:

```ts
/**
 * Record-level persistence, and nothing else. No computation, no currency
 * conversion, no network. Two implementations exist: Prisma on a server, and
 * SQLite on a device in Phase 4 — so anything expressible only in SQL does not
 * belong here.
 *
 * Timestamps are numbers at this boundary, never Prisma's BigInt.
 */
export type AssetType = "crypto" | "equity" | "cash";
export type Side = "buy" | "sell" | "transfer_in" | "transfer_out";

export type Transaction = {
  id: string;
  portfolioId: string;
  symbol: string;
  assetType: AssetType;
  side: Side;
  quantity: number;
  price: number;
  fee: number;
  time: number;
  venue: string | null;
  note: string | null;
};

export type Portfolio = { id: string; name: string; createdAt: number };
export type PortfolioWithTransactions = Portfolio & { transactions: Transaction[] };

export type Settings = {
  displayCurrency: "USD" | "EUR";
  equityProvider: string;
  equityApiKey: string | null;
  haUrl: string | null;
  haWebhookId: string | null;
  mqttBrokerUrl: string | null;
  mqttTopicPrefix: string | null;
};

export type NewTransaction = Omit<Transaction, "id" | "portfolioId">;
export type TransactionPatch = Partial<NewTransaction>;
export type SettingsPatch = Partial<Settings>;

export interface Store {
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
    removeAllIn(portfolioId: string): Promise<void>;
  };
  settings: {
    get(): Promise<Settings>;
    save(patch: SettingsPatch): Promise<Settings>;
  };
}
```

Three deliberate decisions in that interface, each of which a reviewer should
hold you to rather than let drift:

**`settings.get()` returns `Settings`, not `Settings | null`.** The twenty
`where: { id: 1 }` lookups in the old code each had to cope with a missing row.
Defaulting once here removes that from every caller. `passwordHash` is absent —
it is server-only and belongs to the auth routes, which are not converting.

**The method names diverge from spec §4.1**, which wrote `create` / `update` /
`delete` / `createMany`. This plan uses `create` / `rename` / `remove` and
`add` / `addMany`. `remove` avoids shadowing a reserved word, and `rename` says
what the operation actually is — a portfolio has exactly one mutable field.
This is a knowing divergence, not an oversight: Task 8 Step 5 reconciles the
spec to it. Do not silently switch back to the spec's names midway, and do not
mix the two.

**Timestamps are `number` at this boundary.** Prisma's `BigInt` stops at
`PrismaStore`. A `BigInt` leaking into a service would serialise differently and
break parity.

`packages/data/src/ports/net.ts`:

```ts
/**
 * Outbound HTTP. Injected rather than imported so the device build can supply
 * CapacitorHttp, which issues requests natively and is therefore not subject to
 * CORS — the reason a serverless mobile build is possible at all (spec §4.2).
 */
export interface Net {
  json<T>(url: string, init?: RequestInit): Promise<T>;
  text(url: string, init?: RequestInit): Promise<string>;
}
```

- [ ] **Step 3: Write the Store contract, and run it against `MemoryStore`**

`packages/data/src/testing/store-contract.ts` exports `runStoreContract(name, makeStore)`, a factory that declares one `describe` block covering, at minimum:

- `portfolios.create` then `list` returns it; `count` reflects it.
- `portfolios.get` on an unknown id returns `null`, not a throw.
- `portfolios.get` includes transactions, ordered by `time` ascending.
- `portfolios.remove` cascades: its transactions are gone afterwards.
- `transactions.add` returns the stored row with a generated `id`.
- `transactions.addMany` returns the count inserted.
- `transactions.update` applies a partial patch and leaves other fields alone.
- `transactions.remove` removes exactly one row.
- `transactions.removeAllIn` empties one portfolio and leaves another intact.
- `settings.get` on an empty store returns the documented defaults — `displayCurrency: "USD"`, `equityProvider: "yahoo"`, the rest `null`.
- `settings.save` merges a partial patch rather than replacing the row.
- Timestamps come back as `number`.

Write `MemoryStore` to satisfy it. Then `packages/data/src/testing/store-contract.test.ts`:

```ts
import { runStoreContract } from "./store-contract";
import { MemoryStore } from "./memory-store";

runStoreContract("MemoryStore", async () => MemoryStore());
```

Run: `npx vitest run packages/data` — expected: the contract passes.

- [ ] **Step 4: Write `PrismaStore` and run the same contract against it**

`apps/web/src/lib/store/prisma-store.ts` implements `Store` over `prisma` from `@/lib/db`, converting `BigInt` timestamps to `number` at the boundary.

`apps/web/src/lib/store/prisma-store.test.ts` runs `runStoreContract("PrismaStore", …)` against a **temporary SQLite file**, never `dev.db`. Create it per run under the OS temp directory, point `DATABASE_URL` at it, apply migrations with `npx prisma migrate deploy`, and delete it afterwards.

If pointing Prisma at a temp database proves impractical in this setup, **stop and report** rather than testing against `dev.db` — that file holds the owner's real portfolio.

Run: `npx vitest run apps/web/src/lib/store` — expected: the same contract passes against Prisma. Two implementations, one suite, is the mechanism that keeps the device build honest in Phase 4.

- [ ] **Step 5: Write `WebNet`, `FakeNet`, and `deps()`**

`apps/web/src/lib/net/web-net.ts` wraps global `fetch`, preserving the current error behaviour: a non-2xx must surface the way callers already expect (read the routes before deciding — several rely on `fetchPricesSafe` swallowing failures).

`packages/data/src/testing/fake-net.ts` exports `FakeNet(routes)`, matching by URL substring, returning canned payloads, recording calls for assertions, and **throwing on an unmatched URL** — a silent empty response would make a service test pass while the real call was wrong.

`apps/web/src/lib/deps.ts` exports `deps()` returning `{ store, net }`, built once at module scope.

- [ ] **Step 6: Wire the alias**

Add to the `paths` block in **both** `tsconfig.json` and `apps/web/tsconfig.json` (with `../../` prefixes in the latter):

```json
"@/data/*": ["./packages/data/src/*"],
```

Deliberately a single entry, not a fallback array: `@/lib/*` resolves `packages/core` ahead of `apps/web/src/lib`, which means an app module can be silently shadowed by a package module of the same name. The seam should not inherit that.

- [ ] **Step 7: Extend the boundary guard**

In `packages/core/src/boundary.test.ts`, add `packages/data` to `PORTABLE_PACKAGES`, and add a rule that fails on **global `fetch`** in any portable package — a bare `fetch(` call that is not a method on an injected `Net`.

Prove both bite: temporarily add `fetch("https://example.com")` to a file in `packages/data`, confirm the test fails naming it, remove it. Do the same with a `node:fs` import.

- [ ] **Step 8: Build the parity harness**

`scripts/parity.mjs` is the tool that makes "behaviour does not change" checkable rather than asserted.

```
node scripts/parity.mjs capture <file> <path...>   # GET each path, save bodies
node scripts/parity.mjs compare <file>             # re-GET each, diff against saved
```

It authenticates the way the app expects, hits `http://localhost:3001` by default, and on `compare` prints a unified diff of any body that differs and exits non-zero. Normalise nothing except values that are legitimately non-deterministic — live prices and timestamps. Print exactly which fields it is ignoring, on every run: a harness that quietly ignores a field is worse than no harness.

- [ ] **Step 9: Capture the baseline**

With the current `main` build running:

```bash
npm run build && npm run start -- -p 3001 &
node scripts/parity.mjs capture .parity-baseline.json \
  /api/portfolios /api/settings /api/symbols?q=BTC \
  "/api/portfolios/<id>/valuation" "/api/portfolios/<id>/series?range=1y" \
  "/api/portfolios/<id>/changes" "/api/portfolios/<id>/insights" \
  "/api/portfolios/<id>/snapshot" "/api/portfolios/<id>/export" \
  "/api/asset/BTCUSDT" "/api/history?symbol=BTCUSDT&range=1y" \
  "/api/benchmark?symbol=BTCUSDT&range=1y"
```

Add `.parity-baseline.json` to `.gitignore` — it contains real portfolio values.

Every later task ends by running `compare` against this file.

- [ ] **Step 10: Verify and commit**

```bash
npx vitest run          # count is up by the new suites; no suite lost
npm run typecheck       # silent
npm run build           # succeeds
```

```bash
git add -A
git commit -m "Define the ports the mobile build will implement

Store and Net exist so the logic inside the route handlers can be moved
somewhere a device can run it. Nothing is converted yet: this task is the
interfaces, the two fakes services will be tested against, and one contract
suite that both PrismaStore and MemoryStore must satisfy.

The parity harness matters as much as the ports. Every conversion after this
claims to change no behaviour, and a claim that cannot be checked is a
guess."
```

---

### Task 2: `displayContext` — collapse the six-way duplication

Six routes open with the same four steps: read settings, pick the display currency, fetch EUR/USD, and build the conversion factor. Two of them then diverge subtly, which is exactly the kind of drift one shared function prevents.

**Files:**
- Create: `packages/data/src/services/pricing.ts`, `packages/data/src/services/pricing.test.ts`
- Modify: `apps/web/src/app/api/portfolios/[id]/insights/route.ts` (first consumer)

**Interfaces:**
- Consumes: `Store`, `Net`, `MemoryStore`, `FakeNet` from Task 1.
- Produces:
  ```ts
  export type DisplayContext = {
    currency: "USD" | "EUR";
    /** Multiply a USD figure by this to get the display currency. */
    toDisplay: number;
    /** USD per 1 unit of the display currency; 1 when displaying USD. */
    displayUsd: number;
    equityProvider: string;
    equityApiKey: string | null;
  };
  export function displayContext(store: Store, net: Net): Promise<DisplayContext>;
  ```

- [ ] **Step 1: Read all six call sites before writing anything**

`benchmark`, `series`, `snapshot`, `export`, `insights`, `valuation`. Write down, in the report, exactly how each derives `currency` and `toDisplay`, and **any difference between them**. If they are not all equivalent, the differences are either bugs or intentional, and you must say which before collapsing them. Do not assume six copies are identical because they look alike.

- [ ] **Step 2: Write the failing test**

`packages/data/src/services/pricing.test.ts`, covering at least:

- Settings say `USD` → `currency: "USD"`, `toDisplay: 1`, `displayUsd: 1`, and **no network call** (assert `FakeNet` recorded none).
- Settings say `EUR` and the rate is 1.08 USD per EUR → `displayUsd: 1.08` and `toDisplay: 1 / 1.08`.
- The rate lookup fails → matches whatever the current routes do on failure. Establish that from Step 1 rather than inventing it, and state the chosen behaviour in the test's name.

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run packages/data/src/services/pricing.test.ts`
Expected: FAIL — `displayContext` is not defined.

- [ ] **Step 4: Implement**

Write `displayContext` in `packages/data/src/services/pricing.ts`. It takes `Store` and `Net`, never imports `fx` directly if that module reaches for global `fetch` — check, and thread `Net` through if so.

- [ ] **Step 5: Convert one consumer**

Rewrite `apps/web/src/app/api/portfolios/[id]/insights/route.ts` to call `displayContext(store, net)`. It is the smallest of the six, which makes it the right proof.

- [ ] **Step 6: Verify, including parity**

```bash
npx vitest run
npm run typecheck
npm run build && npm run start -- -p 3001 &
node scripts/parity.mjs compare .parity-baseline.json
```
The insights body must be identical. If it differs, the extraction was not behaviour-preserving — fix it rather than re-capturing the baseline.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Give the currency preamble one home

Six routes each read settings, picked a display currency, fetched the ECB
rate and built the same conversion factor. Two had already drifted in how
they handle a failed rate lookup, which is the argument for one function
rather than six copies.

Only insights is converted here — it is the smallest of the six, so it
proves the shape before the larger ones depend on it."
```

---

### Task 3: Portfolio and transaction CRUD

The simplest services: storage in, storage out, no pricing.

**Files:**
- Create: `packages/data/src/services/portfolios.ts` + `.test.ts`
- Create: `packages/data/src/services/transactions.ts` + `.test.ts`
- Modify: `apps/web/src/app/api/portfolios/route.ts`, `portfolios/[id]/route.ts`, `portfolios/[id]/transactions/route.ts`, `transactions/[id]/route.ts`

**Interfaces:**
- Consumes: `Store` from Task 1.
- Produces:
  ```ts
  export function listPortfolios(store: Store): Promise<Portfolio[]>;
  export function getPortfolio(store: Store, id: string): Promise<PortfolioWithTransactions>;
  export function createPortfolio(store: Store, name: string): Promise<Portfolio>;
  export function renamePortfolio(store: Store, id: string, name: string): Promise<Portfolio>;
  export function deletePortfolio(store: Store, id: string): Promise<void>;

  export function addTransaction(store: Store, portfolioId: string, tx: NewTransaction): Promise<Transaction>;
  export function updateTransaction(store: Store, id: string, patch: TransactionPatch): Promise<Transaction>;
  export function deleteTransaction(store: Store, id: string): Promise<void>;
  ```
  Plus a `NotFoundError` class exported from `packages/data/src/index.ts`, so route handlers can map it to a 404 without importing anything Next-shaped into the services.

- [ ] **Step 1: Record the current contract**

For each of the four route files, write down in the report: the status codes it returns, the exact error body shape, and its Zod schema. The services must reproduce all of it. Pay attention to what happens on an unknown id today — a 404 with a particular body — because that is what `NotFoundError` has to become.

- [ ] **Step 2: Write the failing tests**

`packages/data/src/services/portfolios.test.ts` and `transactions.test.ts`, against `MemoryStore`. Cover the happy paths, and specifically:

- `getPortfolio` on an unknown id throws `NotFoundError`, not a generic `Error`.
- `createPortfolio` with an empty name behaves exactly as the current route does — check Step 1 before asserting.
- `updateTransaction` with a partial patch leaves untouched fields alone.

- [ ] **Step 3: Run them and watch them fail**

Run: `npx vitest run packages/data/src/services`
Expected: FAIL — the service modules do not exist.

- [ ] **Step 4: Implement the services**

Keep Zod validation in the route handlers, not the services: the services take typed arguments, and parsing an HTTP body is the route's job. This keeps `packages/data` free of any assumption that its caller speaks HTTP.

- [ ] **Step 5: Convert the four routes**

Each handler becomes: parse and validate, call the service, map `NotFoundError` to the existing 404 shape, return JSON. No other logic.

- [ ] **Step 6: Verify, including parity**

```bash
npx vitest run
npm run typecheck
npm run build && npm run start -- -p 3001 &
node scripts/parity.mjs compare .parity-baseline.json
```

`GET /api/portfolios` must be identical. Also exercise the writes by hand, since the harness only issues GETs: create a portfolio, rename it, add a transaction, patch it, delete both, and confirm the status codes and bodies match what Step 1 recorded. Put the commands and output in your report.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Move portfolio and transaction CRUD behind the Store port

The four routes keep their Zod schemas and their status codes; everything
between parsing and responding now lives in a service the device build can
call directly.

NotFoundError exists so a service can say 'no such portfolio' without
importing anything Next-shaped."
```

---

### Task 4: Valuation and snapshot

The heaviest pricing logic: two routes totalling 347 lines that fetch crypto spot prices, equity quotes and previous closes, convert currencies, and value holdings.

**Files:**
- Create: `packages/data/src/services/valuation.ts` + `.test.ts`
- Modify: `apps/web/src/app/api/portfolios/[id]/valuation/route.ts`, `portfolios/[id]/snapshot/route.ts`

**Interfaces:**
- Consumes: `Store`, `Net`, `displayContext` from Task 2, `NotFoundError` from Task 3.
- Produces:
  ```ts
  export function valuation(store: Store, net: Net, id: string): Promise<Valuation>;
  export function snapshot(store: Store, net: Net, id: string): Promise<Snapshot>;
  ```
  `Valuation` is `{ holdings, totals, currency, rate }` — the exact shape the route returns today. Define it from the current code, not from memory.

- [ ] **Step 1: Pin the current output first**

Before touching anything, capture the live `valuation` and `snapshot` bodies for a real portfolio into the parity baseline if Task 1 did not already. This task changes the most intricate code in the phase; the diff of its output is the only real proof.

- [ ] **Step 2: Move the three private helpers into the service**

`valuation/route.ts` defines `fetchEquityPricesUsd`, `fetchCryptoPrevCloses` and `sum` privately. They move into `packages/data/src/services/valuation.ts`, taking `Net` instead of reaching for `fetch`. Check whether `snapshot` has near-copies of any of them — if it does, that duplication collapses here and you should say so in the report.

- [ ] **Step 3: Write the failing tests**

`packages/data/src/services/valuation.test.ts`, against `MemoryStore` + `FakeNet` with scripted prices. Cover:

- A crypto-only portfolio in USD: holdings, quantities and totals.
- A mixed crypto and equity portfolio in EUR, asserting conversion is applied once and not twice.
- A held symbol whose price lookup fails: it must be excluded from totals rather than valued at zero. **Spec §7 R2 requires a broken price source to degrade honestly** — assert the current behaviour, and if the current behaviour *is* a silent zero, stop and report it as a pre-existing bug rather than enshrining it in a test.
- A cash row: excluded from `assetRows`, per the current filter.
- An empty portfolio: totals are zero, no crash.

- [ ] **Step 4: Run them and watch them fail**

Run: `npx vitest run packages/data/src/services/valuation.test.ts`
Expected: FAIL — the service does not exist.

- [ ] **Step 5: Implement and convert both routes**

- [ ] **Step 6: Verify, including parity**

```bash
npx vitest run
npm run typecheck
npm run build && npm run start -- -p 3001 &
node scripts/parity.mjs compare .parity-baseline.json
```

Both bodies must match, allowing only the price fields the harness declares it ignores. If a *structural* difference appears — a key present or absent, an array ordered differently — that is a behaviour change and must be fixed, not normalised away.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Move valuation and snapshot behind the ports

The two heaviest handlers, and the ones the mobile build most needs: three
hundred lines of price fetching, currency conversion and holding valuation
that a device has to run with no server in front of it.

The private helpers move with them and now take a Net, which is what makes
the same code work against CapacitorHttp in Phase 4."
```

---

### Task 5: The time-series family

`series`, `changes`, `benchmark` and `history` all build a time window and walk it. They share windowing logic that currently exists as three separate private functions.

**Files:**
- Create: `packages/data/src/services/series.ts` + `.test.ts`
- Modify: `apps/web/src/app/api/portfolios/[id]/series/route.ts`, `portfolios/[id]/changes/route.ts`, `benchmark/route.ts`, `history/route.ts`

**Interfaces:**
- Consumes: `Store`, `Net`, `displayContext`, `NotFoundError`.
- Produces:
  ```ts
  export function series(store: Store, net: Net, id: string, range: RangeKey): Promise<Series>;
  export function changes(store: Store, net: Net, id: string, range: RangeKey): Promise<Changes>;
  export function benchmark(store: Store, net: Net, id: string, symbol: string, range: RangeKey): Promise<Series>;
  export function history(net: Net, symbol: string, range: RangeKey): Promise<Bar[]>;
  ```
  `RangeKey` comes from `packages/core/src/ranges.ts` and `Bar` from `packages/core/src/types.ts` — import both, do not redefine them. There is no `Candle` type in this codebase.

  `history` takes no `Store` — it reads no persisted state. Do not add one for symmetry.

- [ ] **Step 1: Compare the three windowing helpers**

`series/route.ts` has `rangeWindow(range, firstTx)`, `changes/route.ts` has `windowStart(range, firstTx)`, and `history/route.ts` has `window_(range)` plus `yahooRange(range)`. Read all four and record in the report whether they agree on boundaries for the same range key. **If they disagree, do not unify them silently** — that would change at least one endpoint's output. Report the disagreement and keep them separate unless they are genuinely equivalent.

- [ ] **Step 2: Write the failing tests**

`packages/data/src/services/series.test.ts`, against `MemoryStore` + `FakeNet`. Cover:

- Each `RangeKey` produces the expected first and last bar timestamps for a fixed portfolio.
- A range starting before the first transaction is clamped to the first transaction, matching current behaviour.
- `benchmark` compares against the same cash flows — `simulateSameFlows` in `benchmark/route.ts` is the logic to preserve; move it, do not rewrite it.
- `history` for an equity symbol versus a crypto symbol takes the correct provider path.

- [ ] **Step 3: Run them and watch them fail**

Run: `npx vitest run packages/data/src/services/series.test.ts`
Expected: FAIL — the service does not exist.

- [ ] **Step 4: Implement and convert the four routes**

- [ ] **Step 5: Verify, including parity**

Compare against the baseline for `series`, `changes`, `benchmark` and `history` across **more than one range** — a windowing bug typically shows on one range and not another. Capture `?range=1m`, `?range=1y` and `?range=all` if the baseline does not already have them.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Move the time-series endpoints behind the ports

series, changes, benchmark and history each built their own window from the
same range keys. They are now one service, and the windowing helpers that
had drifted apart are reconciled deliberately rather than by accident.

history takes no Store: it reads no persisted state, and giving it one for
symmetry would be a lie about what it does."
```

---

### Task 6: Import, export and restore

The product's front door, per spec §9 Phase 3. Getting it behind the seam now means the mobile import screen is a UI problem later, not a logic problem.

**Files:**
- Create: `packages/data/src/services/transfer.ts` + `.test.ts`
- Modify: `apps/web/src/app/api/portfolios/[id]/import/route.ts`, `portfolios/[id]/export/route.ts`, `portfolios/restore/route.ts`

**Interfaces:**
- Consumes: `Store`, `Net`, `displayContext`, `NotFoundError`, and `delta-csv` from `packages/core`.
- Produces:
  ```ts
  export function importDelta(store: Store, net: Net, id: string, csv: string): Promise<ImportReport>;
  export function clearPortfolio(store: Store, id: string): Promise<void>;
  export function exportCsv(store: Store, net: Net, id: string): Promise<string>;
  export function exportJson(store: Store, id: string): Promise<string>;
  export function restore(store: Store, json: string): Promise<Portfolio>;
  ```
  `ImportReport` must carry what was written **and what was skipped, with reasons** — the import screen shows both, and the two private helpers in the current route (`resolvePendingQuotes`, `reclassifyNonCoins`) already produce that detail.

- [ ] **Step 1: Write the failing tests**

`packages/data/src/services/transfer.test.ts`. Use a real Delta export fixture if `samples/` has one; otherwise construct a small CSV covering a buy, a sell, a transfer, a fiat row and one row the parser cannot classify. Cover:

- Every parsed row is written, and the count matches.
- Skipped rows appear in the report with their reason — assert on the reason text, not just the count.
- A round trip: `exportJson` then `restore` into a fresh portfolio yields identical transactions.
- `exportCsv` produces the Ghostfolio column order the current route produces.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run packages/data/src/services/transfer.test.ts`
Expected: FAIL — the service does not exist.

- [ ] **Step 3: Implement and convert the three routes**

The `DELETE` handler on `import/route.ts` becomes `clearPortfolio`. Keep the route's existing guard against clearing the wrong portfolio, whatever it currently is.

- [ ] **Step 4: Verify, including parity and a real round trip**

Compare `export` against the baseline. Then, **against a scratch portfolio and never the real one**: import a CSV, export it, restore it into another scratch portfolio, and confirm the two exports match. Delete both scratch portfolios afterwards. Record the commands in your report.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Move import, export and restore behind the ports

The import path is the product's front door and the one piece of this app
that a Delta user judges it by, so it belongs on the device rather than
behind a server.

The report keeps skipped rows and their reasons, not just a count: the
import screen has to show what it could not read, and a number alone does
not let anyone act on it."
```

---

### Task 7: Settings and lookups

The remainder: `settings` GET/PUT, `symbols`, `asset/[symbol]`.

**Files:**
- Create: `packages/data/src/services/settings.ts` + `.test.ts`, `packages/data/src/services/lookup.ts` + `.test.ts`
- Modify: `apps/web/src/app/api/settings/route.ts`, `symbols/route.ts`, `asset/[symbol]/route.ts`

**Interfaces:**
- Consumes: `Store`, `Net`.
- Produces:
  ```ts
  export function getSettings(store: Store): Promise<Settings>;
  export function saveSettings(store: Store, patch: SettingsPatch): Promise<Settings>;
  export function symbols(net: Net): Promise<string[]>;
  export function assetInfo(net: Net, symbol: string): Promise<AssetInfo>;
  ```
  `AssetInfo` already exists in `packages/core/src/asset-info.ts` — import it, do not
  redefine it.

  `symbols` takes **no query argument**: the route accepts no parameters and returns
  the full USDT symbol list. Do not add filtering while moving it.

- [ ] **Step 1: Note what must not move, and one thing that must move carefully**

`settings/route.ts` has three handlers. `GET` and `PUT` convert. **`POST` does not** — it sends a test ping to Home Assistant, which the mobile build does not have. Leave `POST` inline and say why in a comment.

`symbols/route.ts` holds a **module-level one-hour cache** of the ~2MB exchange-info response, and falls back to serving a stale cache when the upstream call fails. Both behaviours must survive the move — the fallback especially, since losing it turns a Binance hiccup into a broken symbol picker. Decide deliberately whether the cache lives in the service or stays in the route, and say which and why in your report. A module-level cache in the service is per-process on a device too, which is the same guarantee it has now.

`getSettings` must not return `passwordHash`. Confirm the current `GET` does not leak it either; if it does, that is a pre-existing security bug — report it rather than quietly fixing it in this task, so it gets its own visible change.

- [ ] **Step 2: Write the failing tests**

Cover: `saveSettings` merges rather than replaces; an unknown key is rejected or ignored exactly as the current route does; `symbols` returns the current shape for a query with hits and for one with none; `assetInfo` degrades the way the current route does when the upstream lookup fails.

- [ ] **Step 3: Run them and watch them fail**

Run: `npx vitest run packages/data/src/services`
Expected: FAIL — the modules do not exist.

- [ ] **Step 4: Implement and convert the three routes**

- [ ] **Step 5: Verify, including parity**

Compare `settings`, `symbols` and `asset` against the baseline. Confirm by hand that the Home Assistant test ping still works if a webhook is configured — it is the one handler in this file you did not touch, and a broken import would take it down with the others.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Move settings and the symbol lookups behind the ports

The Home Assistant test ping stays inline: it is the one handler here the
device build will never call, and moving it would put a server-only
integration into a package that has to run in an APK."
```

---

### Task 8: Close the seam and document it

Everything in scope is converted. This task proves nothing was left behind and writes down the rule.

**Files:**
- Modify: `packages/core/src/boundary.test.ts` (tighten if the sweep finds a gap)
- Create: `packages/data/src/services/services.test.ts` (the no-leak sweep)
- Modify: `CLAUDE.md` (a Phase 2 section)
- Modify: `docs/superpowers/specs/2026-08-22-standalone-android-design.md` if reality diverged from §4

**Interfaces:**
- Consumes: everything above.
- Produces: documentation, and one test that fails if a future route re-inlines logic.

- [ ] **Step 1: Sweep for logic left in converted routes**

Every converted route handler should now be short. Measure:

```bash
wc -l apps/web/src/app/api/portfolios/route.ts \
      apps/web/src/app/api/portfolios/\[id\]/*/route.ts \
      apps/web/src/app/api/{symbols,history,benchmark}/route.ts \
      apps/web/src/app/api/asset/\[symbol\]/route.ts
```

Record before-and-after line counts in the report. A converted handler still over roughly 40 lines deserves an explanation — give one, or move the remainder.

- [ ] **Step 2: Write the no-leak test**

`packages/data/src/services/services.test.ts` asserts that every file in `packages/data/src/services/` imports neither `@/lib/db` nor anything under `next/`, and that none calls global `fetch`. This overlaps the boundary test deliberately: the boundary test guards the package, this one guards the layer, and the failure messages should say which rule was broken.

- [ ] **Step 3: Run it**

Run: `npx vitest run packages/data`
Expected: PASS. Prove it bites by temporarily adding `import { prisma } from "@/lib/db";` to a service, watching it fail, and removing it.

- [ ] **Step 4: Document the seam in `CLAUDE.md`**

Add a section covering: what `Store` and `Net` are and why they are injected; that services are pure of HTTP and persistence; that route handlers are wrappers and should stay that way; which endpoints were deliberately left inline and why; and how to run the parity harness. State plainly that Phase 3 replaces the UI's `fetch("/api/…")` calls with a `DataClient`, and Phase 4 adds `SqliteStore` and `CapacitorNet`.

- [ ] **Step 5: Reconcile the spec**

Read spec §4 against what was built. Where the implementation diverged for a good reason, amend the spec and say why in the commit. Where it diverged for no good reason, fix the code. Do not leave the two disagreeing — Phase 4 is planned from §4.

- [ ] **Step 6: Final verification**

```bash
npx vitest run
npm run typecheck
npm run build
npm run start -- -p 3001 &
node scripts/parity.mjs compare .parity-baseline.json
```

All green, and parity clean across every captured endpoint.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "State the rule the seam depends on

Route handlers are wrappers now. The test in services/ fails if one grows
logic back, which is the failure mode worth guarding: nothing stops a future
handler from doing its own database read, and by the time Phase 4 notices,
the mobile build is missing a feature nobody knew was server-only."
```

---

## Phase 2 exit criteria

- [ ] `npx vitest run` green, with a strictly higher count than Phase 1's 195 and no suite removed
- [ ] `npm run typecheck` silent; `npm run build` succeeds
- [ ] `node scripts/parity.mjs compare` clean across every captured endpoint
- [ ] The Store contract passes against **both** `MemoryStore` and `PrismaStore`
- [ ] The boundary test covers `packages/data` and forbids global `fetch` in portable packages
- [ ] Every converted route handler is a wrapper: parse, call, map errors, respond
- [ ] `npm run lint` reports no *new* errors beyond the 21 pre-existing

## What Phase 2 deliberately does not do

No `DataClient`, no changes to any UI file, no `apps/mobile`, no SQLite, no Capacitor. The 66 `fetch("/api/…")` call sites in the UI are untouched — they are Phase 3. The alerts, strategy tools and auth routes keep their inline logic permanently.

Phase 3 gets its own plan once this lands.
