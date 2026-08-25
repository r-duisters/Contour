# Standalone Android build (Phase 4) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An APK that holds its own data and works with no server running — the
portfolio, the asset pages, the ledger, insights, import and export, on a phone,
on a train.

**Architecture:** A second Next app, `apps/mobile`, built with
`output: "export"` and wrapped by the existing Capacitor shell. It renders the
same screens from `packages/ui` and reaches the same services in
`packages/data`, wired to two new adapters: `SqliteStore` over
`@capacitor-community/sqlite` and `CapacitorNet` over `CapacitorHttp`. The
provider at its root supplies a `LocalClient` instead of `HttpClient`, and that
is the only file in either app that names an implementation.

**Tech Stack:** Next 16 (static export), React 19, Capacitor 8,
`@capacitor-community/sqlite`, `@aparajita/capacitor-biometric-auth`,
TypeScript, Vitest.

**Specs:** `docs/superpowers/specs/2026-08-22-standalone-android-design.md`, and
`docs/superpowers/specs/2026-08-25-alerts-design.md` for Tasks 10–12
(§3 layout, §4.4 `DataClient`, §5 device storage, §6 blockers, §7 lock and
icons, §8 testing, §9 sequencing). Read the **"As built (Phase 3)"** note inside
§4.4 before Task 4 — it lists nine places the shipped interface departs from the
draft, and the draft signatures in §4.4 are *not* what to implement.

## What is already true

Phases 1–3 are merged. This is the first phase that produces something visible,
and it was sequenced last on purpose: by now the mobile app is mostly new files
rather than edits to old ones.

- **The seam exists at both ends.** `Store` and `Net`
  (`packages/data/src/ports/`), the services that take them as arguments, and
  `DataClient` with `HttpClient` over the routes. A screen takes a client from
  React context and names no URL.
- **A second implementation already passes the contract.**
  `stub-client.test.ts` builds a client from the services over `MemoryStore` and
  runs `client-contract.ts` unchanged. `LocalClient` replaces that stub and must
  pass the same suite. This is the single most valuable thing Phase 3 left
  behind: parity is a failing test, not a discipline.
- **`MemoryStore` and `PrismaStore` both pass `store-contract.ts`.**
  `SqliteStore` is the third implementation of an interface that already has two
  and a contract to hold them together.
- **The guards are in place.** `packages/core/src/boundary.test.ts` (no
  server-only imports, no global `fetch` in `packages/ui`, no new `/api/`
  literal), `packages/data/src/layer.test.ts` (services stay pure of HTTP and
  persistence), `apps/web/src/screen-boundary.test.ts` (screens do not name
  routes).
- **`providers.tsx` says so in its own comment:** *"Phase 4's APK swaps this
  file, and only this file, for a `LocalClient` over SQLite. That is the point."*

## Global Constraints

- **The web app must work, and its tests stay green, after every task.** The
  rule every phase has run under. `apps/web` is not modified by this plan except
  where a task says so explicitly, and each such change is listed in its Files
  block.
- **`packages/core` and `packages/data` must not gain a Capacitor import.** The
  adapters live in `apps/mobile`, exactly as `PrismaStore` and `WebNet` live in
  `apps/web`. `boundary.test.ts` does not know the word "Capacitor" yet — Task 1
  teaches it.
- **One copy of every screen.** A page body belongs in `packages/ui`; an app's
  `app/` directory holds only routing. Two copies of a screen is the drift this
  whole architecture exists to prevent (spec §10).
- **No sync, ever.** A portfolio on the phone and one on the server are
  unrelated. The bridge is the JSON export.
- `npm run typecheck` — never bare `npx tsc --noEmit`.
- `npm run lint` must stay at exactly **21** pre-existing errors — and Task 1
  changes what that command covers, so re-baseline once, there, and nowhere else.
- Tests: `npx vitest run` from the repository root. **587 tests / 46 files** pass
  on the tip this plan starts from.
- **Never commit `apps/web/prisma/dev.db` or a dated copy** (`.gitignore` covers
  `**/prisma/dev.db.*`), and never commit an APK or a keystore.

## Two preconditions that are not technical

**Phase 0 is a gate the spec says must precede Phase 1, and it has never been
run.** Five or more real Delta exports from people who are not the author, under
1% unmapped rows, no per-user special-casing. The parser has only ever seen one
person's export.

**Ruling: Phase 4 proceeds without it.** Phase 0 gates *handing this to
strangers*, not building a standalone APK for its author, and Phases 1–3 already
went ahead on that reading. The gate stays open and stays recorded — it blocks
Phase 6 (releases), not this. Cost if wrong: nothing built here is wasted, since
the import path is shared with `apps/web`; what is at risk is only the claim
"bring your history, it just works", which this plan does not make.

**There is still no `LICENSE` file.** Without one nobody may legally use or fork
this. It does not block a personal APK and it absolutely blocks a release. Task
10 refuses to produce a distributable artefact until it exists.

---

### Task 1: `apps/mobile` exists and builds

**Files:**
- Create: `apps/mobile/package.json`, `apps/mobile/tsconfig.json`,
  `apps/mobile/next.config.ts`, `apps/mobile/src/app/layout.tsx`,
  `apps/mobile/src/app/globals.css`, `apps/mobile/src/app/page.tsx`
- Modify: `package.json` (the lint loop's hardcoded workspace list)
- Modify: `packages/core/src/boundary.test.ts` (teach it the new app)
- Modify: `capacitor.config.ts` (`webDir`, and drop `server.url`)

**Interfaces:**
- Produces: the `@contour/mobile` workspace and the path aliases
  `@/data/*`, `@/core/*`, `@/ui/*` resolving from `apps/mobile`. Every later
  task imports through them.

- [ ] **Step 1: The workspace**

`apps/mobile/package.json`:

```json
{
  "name": "@contour/mobile",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "next build",
    "dev": "next dev -p 3100",
    "lint": "eslint .",
    "sync": "npm run build && cap sync android"
  }
}
```

`apps/mobile/tsconfig.json` mirrors `apps/web`'s, minus the `@/lib/*` and
`@/components/*` fallback arrays — those exist because `apps/web` has its own
`src/lib` and `src/components`, and `apps/mobile` deliberately has neither:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "paths": {
      "@/data/*": ["../../packages/data/src/*"],
      "@/core/*": ["../../packages/core/src/*"],
      "@/ui/*": ["../../packages/ui/src/*"],
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"]
}
```

Copy `apps/web`'s `next-env.d.ts` reference approach and let `next build`
generate the file.

- [ ] **Step 2: Static export, and Tailwind seeing the shared components**

`apps/mobile/next.config.ts`:

```ts
import type { NextConfig } from "next";

/**
 * `output: "export"` is what makes an APK possible: the build emits static
 * HTML, JS and CSS that Capacitor serves from the app's own assets, with no
 * Node process anywhere. Everything that needs a server — route handlers,
 * middleware, `force-dynamic` — stays in `apps/web` and cannot be imported
 * here, which is the point of two app directories rather than one with
 * build-time file surgery (spec §6).
 *
 * `images.unoptimized` because the optimiser is a server.
 */
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
```

`apps/mobile/src/app/globals.css` must carry its own `@source` directive —
Tailwind v4 only scans what it is told about, and `apps/web`'s directive does
not apply here:

```css
@import "tailwindcss";
@source "../../../../packages/ui/src";
```

Copy the theme block, the CSS custom properties and the `more-up` keyframes
from `apps/web/src/app/globals.css` verbatim. **Do not restate the palette by
hand** — `BRAND.md` is the authority and a second hand-typed copy is the drift
it warns about. If the file is large, extract the shared part to
`packages/ui/src/theme.css` and have both apps `@import` it; that is a
refactor worth doing here rather than later.

- [ ] **Step 3: A root layout and one page**

`layout.tsx` mirrors `apps/web`'s, minus `PwaSetup`, `BackgroundAlerts` and the
session-aware bits. `page.tsx` renders a heading and nothing else for now — the
point of this task is that the toolchain works, not that the app does.

- [ ] **Step 4: Fix the lint loop before it silently skips this app**

`package.json` currently reads:

```
"lint": "fail=0; for w in @contour/core @contour/ui @contour/data @contour/web; do ..."
```

That hardcoded list is recorded in `docs/carried-forward.md` as a known trap:
a new workspace is skipped in silence. Replace the literal list with one derived
from the workspaces themselves, so the next app cannot go unlinted either:

```json
"lint": "fail=0; for w in $(node -p \"require('./package.json').workspaces.map(g=>g).join(' ')\" >/dev/null; npm query .workspace --json | node -e \"const w=JSON.parse(require('fs').readFileSync(0));process.stdout.write(w.map(x=>x.name).join(' '))\"); do npm run lint --workspace $w --if-present || fail=1; done; exit $fail"
```

If that proves fragile in this npm version, a plain `--workspaces` is **not**
the fallback — it stops at the first failing workspace, which is the bug the
loop exists to work around. Fall back to an explicit list that includes
`@contour/mobile`, and leave the carried-forward note in place.

- [ ] **Step 5: Extend the portability guard**

In `packages/core/src/boundary.test.ts`, add `@capacitor/*` and
`@capacitor-community/*` to the forbidden-import list for `packages/core`,
`packages/ui` and `packages/data`, with the reason written beside it:

```ts
// The adapters live in an app, not in a package — `SqliteStore` and
// `CapacitorNet` are to `apps/mobile` what `PrismaStore` and `WebNet` are to
// `apps/web`. A Capacitor import here would make the packages unbuildable in
// a browser and on a server, which is the property this file exists to keep.
```

- [ ] **Step 6: Point Capacitor at the bundle instead of a server**

```ts
webDir: "apps/mobile/out",
// `server.url` is gone. The shell served a running web app while the local-
// first build did not exist; loading one now would defeat the whole phase.
```

Keep `appId`, `appName`, `android.backgroundColor` and the `BackgroundRunner`
block exactly as they are. **Do not delete `BackgroundRunner` in this task** even
though mobile v1 has no alerts — it is wired to the existing shell and removing
it is a separate decision with its own verification.

- [ ] **Step 7: Verify**

```bash
npm install
npm run build --workspace @contour/mobile
ls apps/mobile/out/index.html
npm run typecheck && npx vitest run && npm run lint
```

Expected: an `out/` directory with static HTML; typecheck clean; 587 tests pass;
lint reports a number. **Re-baseline the lint count here and only here** — the
loop now covers a fifth workspace. Record the new number in `CLAUDE.md` beside
the existing note, with what changed. If `@contour/mobile` contributes any
errors of its own, fix them; the 21 that are allowed are pre-existing ones in
`packages/ui` and `apps/web`.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile package.json capacitor.config.ts packages/core/src/boundary.test.ts CLAUDE.md
git commit -m "Give the mobile build an app of its own"
```

---

### Task 2: `SqliteStore`

**Files:**
- Create: `apps/mobile/src/lib/store/sqlite-store.ts`
- Create: `apps/mobile/src/lib/store/schema.ts`
- Create: `apps/mobile/src/lib/store/sqlite-store.test.ts`
- Modify: `package.json` (add `@capacitor-community/sqlite`)

**Interfaces:**
- Consumes: `Store`, `Transaction`, `Portfolio`, `Settings`,
  `DEFAULT_SETTINGS` from `packages/data/src/ports/store.ts`.
- Produces: `SqliteStore(db: SQLiteDBConnection): Store` and
  `migrate(db): Promise<void>`. Task 4 wires both.

**Why this is the highest-risk task in the plan** and worth doing second: it is
the only one that owns durable user data, and a migration bug is not
recoverable from a test suite. It is also more mechanical than it sounds —
across all route handlers there is no `groupBy`, no `aggregate`, no
`$queryRaw`, no `$transaction` and exactly one relational `include`. Prisma is
being used as a document store, so this is a transcription.

- [ ] **Step 1: Write the failing contract run**

`apps/mobile/src/lib/store/sqlite-store.test.ts`:

```ts
import { describe } from "vitest";
import { runStoreContract } from "@/data/testing/store-contract";
import { SqliteStore } from "./sqlite-store";
import { openTestDb } from "./test-db";

/**
 * The third implementation of `Store`, held to the same suite as `MemoryStore`
 * and `PrismaStore`. That the suite is unchanged is the whole assertion: a
 * device store that needed its own expectations would not be the same port.
 */
describe("SqliteStore", () => {
  runStoreContract("SqliteStore", async () => SqliteStore(await openTestDb()));
});
```

`openTestDb` opens an in-memory database through the plugin's web/electron
implementation (`jeep-sqlite` / the wasm build) and runs `migrate`. If that
proves unavailable under Vitest, the fallback is `better-sqlite3` in the test
only, wrapped to present the same three methods `SqliteStore` uses — say so in
the file header, because a store tested against a different driver than it
ships on is a real limitation and must not be discovered later.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run apps/mobile/src/lib/store`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: The schema, transcribed**

`schema.ts` holds an ordered array of migrations and a `user_version` pragma.
Three tables only — `Portfolio`, `Transaction`, `Settings`. `Alert`,
`AlertEvent`, `BacktestRun`, `WebAuthnCredential` and `PushSubscription` have
no mobile use and are deliberately absent (spec §5).

```ts
/**
 * Migrations are hand-owned now. Prisma was doing this; on a device it is not
 * there, and that is the accepted cost of schema parity with the web build.
 *
 * The rules, and they are not negotiable once an APK is in someone's hands:
 * append only, never edit a shipped entry, and every entry is idempotent
 * enough to survive being interrupted. `user_version` is the only record of
 * where a database got to.
 */
export const MIGRATIONS: ((db: DB) => Promise<void>)[] = [
  async (db) => {
    await db.execute(`
      CREATE TABLE Portfolio (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
      CREATE TABLE "Transaction" (
        id TEXT PRIMARY KEY NOT NULL,
        portfolioId TEXT NOT NULL REFERENCES Portfolio(id) ON DELETE CASCADE,
        symbol TEXT NOT NULL,
        assetType TEXT NOT NULL DEFAULT 'crypto',
        side TEXT NOT NULL,
        quantity REAL NOT NULL,
        price REAL NOT NULL,
        fee REAL NOT NULL DEFAULT 0,
        nativeCurrency TEXT,
        nativePrice REAL,
        nativeFee REAL,
        time INTEGER NOT NULL,
        note TEXT,
        createdAt INTEGER NOT NULL
      );
      CREATE INDEX Transaction_portfolioId_time ON "Transaction"(portfolioId, time);
      CREATE TABLE Settings (
        id INTEGER PRIMARY KEY NOT NULL,
        displayCurrency TEXT NOT NULL DEFAULT 'USD',
        equityProvider TEXT NOT NULL DEFAULT 'yahoo',
        equityApiKey TEXT,
        haUrl TEXT,
        haWebhookId TEXT,
        mqttBrokerUrl TEXT,
        mqttTopicPrefix TEXT
      );
    `);
  },
];
```

`Transaction` is quoted because it is a SQLite keyword in some contexts —
quote it consistently everywhere or not at all, and the tests will find it if
not. Timestamps are `INTEGER` milliseconds: Prisma's `BigInt` already becomes
`number` at the `Store` boundary, so both implementations hand back the same
type.

**Two columns depend on the cash-and-income epic (#23).** `sourceSymbol` on
`Transaction`, and `side` accepting `income`. If #23 has merged, include
`sourceSymbol TEXT` in migration 0 rather than appending a second migration —
nothing has shipped yet, so there is no database in the world to migrate. If it
has not, leave it out and let #23 add migration 1. Check `schema.prisma` and
match it exactly; the store contract will fail if the two disagree.

- [ ] **Step 4: The store**

Transcribe `apps/web/src/lib/store/prisma-store.ts` method for method. Two
things it does that must be preserved:

- **Row order is pinned with an explicit `id` tie-break**, not left to rowid.
  `PrismaStore`'s header explains why: `Transaction.id` is a cuid whose lexical
  order is creation order, so `ORDER BY time ASC, id ASC` makes a same-`time`
  pair come back in the same order on both stores. The contract checks this.
- **`settings.exists()`** is a real query (`SELECT 1 FROM Settings WHERE id = 1`),
  not `get()` compared against defaults. It is the distinction `get()`
  deliberately throws away, and it is what tells a virgin install from a
  configured one.

`transactions.addMany` must run in a single SQL transaction — a Delta import is
hundreds of rows and a half-applied import is worse than a failed one. This is
the one place the device store does something `PrismaStore` gets for free.

- [ ] **Step 5: Migration tests**

Beyond the contract suite, per spec §8:

```ts
it("opens an empty database, migrates forward, and reports its version", async () => { ... });
it("is a no-op on an already-current database", async () => { ... });
it("loses no rows migrating from each historical user_version", async () => { ... });
```

The third is trivial today with one migration and is the whole point of writing
it now: it costs nothing while there is one, and it is the test nobody adds
later when there are four.

- [ ] **Step 6: Run**

Run: `npx vitest run apps/mobile/src/lib/store`
Expected: the full store contract passes, same suite as `MemoryStore` and
`PrismaStore`.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/lib/store package.json package-lock.json
git commit -m "Store a portfolio on the device"
```

---

### Task 3: `CapacitorNet`

**Files:**
- Create: `apps/mobile/src/lib/net/capacitor-net.ts`
- Create: `apps/mobile/src/lib/net/capacitor-net.test.ts`

**Interfaces:**
- Consumes: `Net`, `NetError`, `NetResponse` from
  `packages/data/src/ports/net.ts`.
- Produces: `CapacitorNet(): Net`. Task 4 wires it.

**Why not just `fetch`:** a WebView's `fetch` is subject to CORS, and Binance,
Yahoo, CoinGecko and the ECB do not send permissive headers to a
`capacitor://localhost` origin. `CapacitorHttp` issues the request natively and
sidesteps the origin entirely. This is not an optimisation; without it every
price request fails.

- [ ] **Step 1: Write the failing test**

The contract to hold is `WebNet`'s, and it is already written down in
`packages/data/src/testing/fake-net.test.ts`, whose header says *"FakeNet has to
match WebNet here or the parity is worthless."* Same reasoning applies a third
time:

```ts
describe("CapacitorNet", () => {
  it("throws on a non-2xx from json(), carrying the status", async () => { ... });
  it("throws kind 'unreachable' when nothing answered", async () => { ... });
  it("throws kind 'refused' when something answered and said no", async () => { ... });
  it("returns the status from request() without throwing", async () => { ... });
  it("strips the query string from an error message", async () => { ... });
});
```

That last one is not cosmetic. `WebNet.safeUrl` exists because provider
credentials travel as query parameters — `equityApiKey` among them — and two
routes hand `e.message` back to the caller. A device build that logs the full
URL puts the user's own API key in a message. Copy the behaviour, and copy the
comment that says why.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run apps/mobile/src/lib/net`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Mirror `apps/web/src/lib/net/web-net.ts` exactly in structure: `attempt` →
`NetError("unreachable")` when the request never completed; `checked` → throw
`NetError(..., "refused", status)` including up to 500 characters of the body;
`request()` as the escape hatch that returns the status.

`CapacitorHttp.request` resolves for any status, so the split that `fetch` gives
for free has to be made by hand — a rejection is transport, a non-2xx `status`
is refusal. Get that inversion wrong and every 404 becomes "unreachable", which
is precisely the distinction Phase 3 added `kind` to carry.

- [ ] **Step 4: Run, then commit**

```bash
npx vitest run apps/mobile/src/lib/net && npm run typecheck
git add apps/mobile/src/lib/net
git commit -m "Reach the price feeds from inside the APK"
```

---

### Task 4: `LocalClient`, and the contract it must pass

**Files:**
- Create: `apps/mobile/src/lib/local-client.ts`
- Create: `apps/mobile/src/lib/local-client.test.ts`
- Create: `apps/mobile/src/lib/deps.ts`
- Create: `apps/mobile/src/app/providers.tsx`
- Delete: `packages/data/src/client/stub-client.test.ts`
- Modify: `packages/data/src/client/client-contract.ts` (capability flags only)

**Interfaces:**
- Consumes: `DataClient` and `ClientCapabilities` from
  `packages/data/src/client/`; `SqliteStore` (Task 2); `CapacitorNet` (Task 3).
- Produces: `LocalClient(store: Store, net: Net): DataClient`.

**Read `data-client.ts`'s header first.** It is the authority, not spec §4.4 —
the draft interface there has nine documented departures, including three
methods that do not exist (`renamePortfolio`, `listTransactions`,
`updateTransaction`) and different names for six that do.

- [ ] **Step 1: Point the contract at `LocalClient`**

`stub-client.test.ts` exists as a placeholder whose own header says
*"Phase 4's `LocalClient` replaces it and must pass the same suite."* Replace it:

```ts
import { describe } from "vitest";
import { runDataClientContract } from "@/data/client/client-contract";
import { MemoryStore } from "@/data/testing/memory-store";
import { FakeNet } from "@/data/testing/fake-net";
import { LocalClient } from "./local-client";

/**
 * The real second implementation. It runs here over `MemoryStore` and a
 * `FakeNet` rather than over SQLite and CapacitorHttp, because what the
 * contract checks is that the *client* agrees with `HttpClient` — the store
 * below it has its own contract suite (Task 2), and the net below it has its
 * own parity tests (Task 3).
 */
describe("LocalClient", () => {
  runDataClientContract(
    "LocalClient",
    () => LocalClient(new MemoryStore(), new FakeNet(FIXTURES)),
    { testNotifications: false, alerts: false },
  );
});
```

Do **not** delete `stub-client.test.ts` until this passes — its header records
what the exercise taught, and that text moves into the new file rather than
being lost.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run apps/mobile/src/lib/local-client.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Every method calls the matching service directly with the injected store and
net. It is the thinnest of the three layers — `HttpClient` has to know envelopes
and status codes; `LocalClient` knows neither, because the services already
throw `NotFoundError` and `RequestFailedError`.

Three rules from `data-client.ts`'s header, each with a trap:

- **`getSettings` returns `null` on a virgin install.** Use
  `store.settings.exists()`. An implementation that returns defaults shows a
  fresh device a settings form full of values nobody chose — this is exactly
  what `exists()` was added to the port for.
- **`clearImported` answers `0` for an unknown portfolio**, matching
  `HttpClient`. Agreeing beats being right; the header says so explicitly.
- **`deletePortfolio` and `deleteTransaction` throw `RequestFailedError`, not
  `NotFoundError`, for an id that is gone.** The routes answer 500 there, and
  the two implementations must be wrong in the same way.

**Omit `sendTestNotification`, `listAlerts` and `createAlert` entirely.** Not
throwing stubs — absent. The capability flags in Step 1 assert their absence in
both directions, so a stub that resolves would fail the suite.

- [ ] **Step 4: Wire the app**

`apps/mobile/src/lib/deps.ts` mirrors `apps/web`'s, opening the database once
and running `migrate` before anything reads it. `apps/mobile/src/app/providers.tsx`
mirrors `apps/web`'s and is the only file in the app that names an
implementation:

```tsx
const client = LocalClient(SqliteStore(db), CapacitorNet());
```

The database open is asynchronous and the web version is not, so the provider
needs a loading state before the first client exists. Render the app's own
splash, not a bare `Loading…` — design-audit finding #1 removed those once.

- [ ] **Step 5: Run the whole suite**

Run: `npx vitest run && npm run typecheck`
Expected: the contract passes against `HttpClient` **and** `LocalClient`. This
is the moment the architecture is proven; everything after it is screens and
packaging.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib apps/mobile/src/app/providers.tsx packages/data/src/client
git rm packages/data/src/client/stub-client.test.ts
git commit -m "Answer a screen's question without a server"
```

---

### Task 5: The screens, and the routing blocker

**Files:**
- Create: `apps/mobile/src/app/portfolio/page.tsx`,
  `apps/mobile/src/app/portfolio/asset/page.tsx`,
  `apps/mobile/src/app/ledger/page.tsx`,
  `apps/mobile/src/app/insights/page.tsx`,
  `apps/mobile/src/app/markets/page.tsx`,
  `apps/mobile/src/app/settings/page.tsx`, `apps/mobile/src/app/more/page.tsx`
- Move: the page bodies of the above out of `apps/web/src/app/*/page.tsx` into
  `packages/ui/src/screens/`
- Modify: `apps/web/src/app/*/page.tsx` (become routing shells)
- Modify: `packages/ui/src/TabBar.tsx`, `packages/ui/src/MoreMenu.tsx`
  (destinations become a prop)

**Interfaces:**
- Produces: `packages/ui/src/screens/*.tsx`, each a default-exported component
  taking only what routing gives it (`{ symbol, assetType }` for the asset
  screen, nothing for the rest).

**The blocker, from spec §6:** under `output: "export"` a dynamic segment
requires `generateStaticParams`, and the set of symbols is user data that does
not exist at build time. `/portfolio/[symbol]` therefore becomes
`/portfolio/asset?symbol=BTC&type=crypto` on mobile. `apps/web` keeps its
path-segment URL. The page body is already `"use client"` and already reads
`?type=`, so this is a routing change, not a rewrite.

**Ruling: Markets is in.** Spec §2's scope table predates the Markets tab and
does not mention it. But `getMarkets` and `getIndex` are *required* members of
`DataClient` — Task 4 must implement them regardless — and the board is
network-only with no store behind it, so the screen costs a routing file. Cost
if wrong: one screen to remove.

- [ ] **Step 1: Move one screen and prove the shape works**

Start with `/insights` — it has no dynamic segment, no query parameter and no
sub-routes, so it isolates the extraction from the routing problem.

`packages/ui/src/screens/InsightsScreen.tsx` gets the entire body of
`apps/web/src/app/insights/page.tsx`. Both apps' `page.tsx` become:

```tsx
"use client";
import InsightsScreen from "@/ui/screens/InsightsScreen";
export default function Page() { return <InsightsScreen />; }
```

- [ ] **Step 2: Verify the web app is unchanged**

Run: `npm run build --workspace @contour/web && npx vitest run`
Then open `/insights` in the browser and confirm it renders identically. **A
moved screen that looks different is a moved screen that was edited** — the
diff should be a file rename plus two three-line wrappers.

- [ ] **Step 3: The remaining screens, one commit each**

Portfolio, ledger, markets, settings, more. Same shape. `settings` on mobile
renders a **subset**: display currency, equity provider and key, privacy,
export. No password, no passkeys, no Home Assistant, no push — and it
feature-detects rather than branching on a platform flag, exactly as it does
today for `sendTestNotification`.

- [ ] **Step 4: The asset screen and its two routings**

`packages/ui/src/screens/AssetScreen.tsx` takes
`{ symbol: string; assetType: "crypto" | "equity" | null }` as props and reads
no route at all. Then:

- `apps/web/src/app/portfolio/[symbol]/page.tsx` — reads the path segment and
  `?type=`, passes both down.
- `apps/mobile/src/app/portfolio/asset/page.tsx` — reads `?symbol=` and
  `?type=`, passes both down.

Every link to an asset page must now be built by a helper, because the two apps
spell the URL differently:

```ts
/** Where an asset's own page lives — a path segment on the web, a query on a device. */
export function assetHref(symbol: string, assetType: string | null): string
```

Put it in `packages/ui`, take the shape from a prop or context supplied by each
app's provider, and grep for every existing `/portfolio/${` to find the call
sites. A missed one is a dead link that only appears in the APK.

- [ ] **Step 5: Destinations become a prop**

`TabBar` and `MoreMenu` hard-code their destinations. The mobile app has fewer
places to go — no chart, no backtest, no analyze, no alerts, no login. Each app
passes its own list (spec §3). Keep the component's markup identical; only the
data changes.

- [ ] **Step 6: Verify both apps**

```bash
npm run build --workspace @contour/web
npm run build --workspace @contour/mobile
npx vitest run && npm run typecheck && npm run lint
```

Expected: both build, tests green, lint at the Task 1 baseline. Then walk every
screen in a browser at `localhost:3100` (the mobile dev server) and confirm each
renders with `LocalClient` behind it.

- [ ] **Step 7: Commit** (one per screen, not one for all of them)

---

### Task 6: Export on a device

**Files:**
- Modify: `packages/data/src/client/data-client.ts` (`exportFile`)
- Modify: `packages/data/src/client/http-client.ts`,
  `apps/mobile/src/lib/local-client.ts`
- Modify: `packages/data/src/ports/net.ts` (expose one response header)
- Modify: `packages/ui/src/PortfolioManager.tsx` (three anchors become buttons)
- Modify: `packages/core/src/boundary.test.ts` (remove three allowlist entries)
- Modify: `packages/data/src/client/client-contract.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ExportFormat = "json" | "csv" | "ghostfolio";
  /** The file's bytes and the name to save it under. */
  exportFile(portfolioId: string, format: ExportFormat): Promise<ExportFile>;
  ```

`data-client.ts` records why this was deferred: *"`ExportFile` is
`{ body, filename }` and the filename travels in a `Content-Disposition` header
that `Net` exposes on neither side. Phase 4 should add the method together with
whatever saves a file on a device, and probably alongside a `Net` that can read
a response header."* That is this task.

- [ ] **Step 1: Write the failing contract case**

```ts
    it("hands back a file with a name, in every format", async () => {
      const client = makeClient();
      const p = await client.createPortfolio("export me");
      for (const format of ["json", "csv", "ghostfolio"] as const) {
        const file = await client.exportFile(p.id, format);
        expect(file.filename).toMatch(/\.(json|csv)$/);
        expect(file.body.length).toBeGreaterThan(0);
      }
    });
```

Required, not optional: both platforms can produce bytes. What differs is what
happens to them afterwards, and that is the screen's problem, not the client's.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run packages/data/src/client apps/mobile/src/lib`
Expected: FAIL for both implementations.

- [ ] **Step 3: Let `Net` read one header**

Add to `NetResponse`:

```ts
  /**
   * One response header, by name, or null. Deliberately not the whole header
   * map: `Set-Cookie` is unreadable in browser `fetch` (spec §4.2), so a
   * general header contract is one only a Node implementation could keep, and
   * an interface both platforms cannot honour is worse than a narrow one.
   * Added for `Content-Disposition`, which is where a download's filename
   * lives.
   */
  header(name: string): string | null;
```

Implement in `WebNet`, `CapacitorNet` and `FakeNet`. `fake-net.test.ts` gets a
case, since its whole job is matching `WebNet`.

- [ ] **Step 4: Both clients**

`HttpClient` requests the export route and reads the filename from the header,
falling back to a name derived from the portfolio and format if it is absent —
a missing header must not produce a file called `undefined`.
`LocalClient` calls `exportJson`/`exportCsv` from
`packages/data/src/services/transfer.ts` directly and already has
`{ body, filename }` in hand.

- [ ] **Step 5: The three anchors become buttons**

An `<a download>` cannot work on a device and the CSP in some contexts blocks
script-driven saves too, so the screen asks the client for bytes and then hands
them to the platform:

- Web: `Blob` + object URL + a programmatic click, then revoke.
- Mobile: `@capacitor/filesystem` writes to `Directory.Cache`, then
  `@capacitor/share` offers it. Writing to `Documents` without the share sheet
  produces a file the user cannot find.

Put the platform half behind one function supplied per app — the screen must
not branch on which app it is in.

- [ ] **Step 6: Remove the debt from the guard**

Delete the three `PortfolioManager.tsx` entries from `ALLOWED_API_LITERALS`.
The test that "keeps every allowlisted /api/ URL real, explained, and still
there" fails on a stale entry, so this step is not optional — the guard will
say so.

- [ ] **Step 7: Verify and commit**

Export all three formats from both apps and diff the bytes against the same
export taken from the current build. **They must be identical** — this task
changes the delivery, not the content.

```bash
git commit -m "Hand a portfolio back as a file, on either platform"
```

---

### Task 7: Icons without a proxy

**Files:**
- Create: `packages/ui/src/icon-source.ts`
- Create: `apps/mobile/public/icons/` (generated) and its build script
- Modify: `packages/ui/src/CoinIcon.tsx`
- Modify: `packages/core/src/boundary.test.ts` (remove the last allowlist entry)

**The decision is already made** (spec §7): bundle roughly the top 200 crypto
and equity logos in the APK, fall back to the existing coloured initials.
`CoinIcon`'s own comment claims a privacy property — *"the phone never talks to
an icon CDN, so nothing outside learns what is held"* — and calling the CDN
directly from a device would quietly break a promise written into the code, in
an app whose entire pitch is that the portfolio does not leave the phone.

- [ ] **Step 1: `iconSource` as a supplied function**

```ts
/**
 * Where a logo comes from. A string, not a promise: `CoinIcon` needs a value
 * for an `<img src>` and cannot await one during render.
 */
export type IconSource = (symbol: string, assetType: AssetType) => string | null;
```

Each app supplies one through the same provider that supplies the client:
`apps/web` returns `/api/icon?...`, `apps/mobile` returns `/icons/btc.png` or
`null`. `null` means initials, which is already implemented and already looks
deliberate.

- [ ] **Step 2: Generate the bundle**

A script under `scripts/` that reads a list of tickers, fetches each logo once,
resizes to 64px, and writes `apps/mobile/public/icons/<ticker>.png`. Commit the
**list and the script**; whether the images themselves are committed or built on
demand is a size question — measure the directory first and say which was chosen
and why.

- [ ] **Step 3: Remove the last allowlist entry, verify, commit**

With this and Task 6 done, `ALLOWED_API_LITERALS` is empty and `packages/ui`
names no route at all. Leave the empty structure and its header comment in
place — the mechanism is what stops the next one appearing.

---

### Task 8: Lock, first run, and what the device cannot do

**Files:**
- Create: `apps/mobile/src/app/lock/page.tsx` (or a layout-level gate)
- Modify: `apps/mobile/src/app/layout.tsx`
- Modify: `packages/ui/src/screens/SettingsScreen.tsx`

**Interfaces:**
- Consumes: `BiometricLock` from `packages/ui`, already written and already a
  dependency (`@aparajita/capacitor-biometric-auth` is installed).

- [ ] **Step 1: Gate the app on the device lock**

No password, no passkeys, no `SESSION_SECRET`, no `/login`, no `/setup`.
Falling back to the device PIN is the plugin's own behaviour and is the right
one — a lock this app cannot itself reset.

- [ ] **Step 2: First run**

A device with no database is not an error state. On first open: create the
database, run `migrate`, and offer two paths — start empty, or import a Delta
CSV. Use `EmptyState`, which owns the empty tier; four of its sentences already
say what to do.

- [ ] **Step 3: Say plainly what is absent**

The mobile More page lists what this build does not do: no alerts, no Home
Assistant, no push, no risk metric, no backtester, no analyser, no sync. Spec
§7 of the strategy document (R3) says to state this in the README rather than
let someone discover it; the same argument applies in the app.

- [ ] **Step 4: Verify and commit**

---

### Task 9: Close the contract's known gaps

**Files:**
- Modify: `packages/data/src/client/client-contract.ts`

`data-client.ts`'s Phase 3 note names two limits and says Phase 4 should close
them. Doing it here, after `LocalClient` exists, is the first point at which
either can actually be checked.

- [ ] **Step 1: Derive the feed-backed expectations**

Five reads — `getSeries`, `getChanges`, `getSnapshot`, `getBenchmark`,
`getHistory` — are asserted against exact arrays the fixture states rather than
inputs it derives them from. For those the suite checks DTO shape and error
mapping, **not arithmetic**. Rewrite each expectation as a computation over the
fixture's own inputs, so a client that returns a plausible but wrong series
fails.

- [ ] **Step 2: The offline case**

A `LocalClient` whose price feed is offline resolves with stale local figures
rather than throwing — the services degrade on purpose. No case covers it, and
it is the single most likely state a phone is in. Add one: a `FakeNet` that
refuses every request, and assert that holdings still come back with quantities
and cost basis, prices `null`, and nothing silently zero.

**"Never a silent zero" is R2's stated mitigation** in the strategy document —
a broken source must degrade honestly, `"no price"` and excluded from totals.
This is the test that makes it true rather than intended.

- [ ] **Step 3: Run against both implementations, commit**

---

### Task 10: One source for the twenty-four-hour figure

**Ships independently of everything above.** It is a correctness fix to code
already in production, it benefits `apps/web` today, and nothing in Tasks 1–9
depends on it. Do it first, or out of band; it is folded in here only so the
alert work that needs it is not separated from it.

**Files:**
- Modify: `packages/data/src/services/pricing.ts` (`fetchCrypto24hAgo`)
- Modify: `packages/data/src/sources/binance.ts` (new batched fetch)
- Modify: `packages/data/src/services/series.ts` (`history`, the 1d `changePct`)
- Modify: `apps/web/src/app/api/cron/evaluate/route.ts`
- Modify: `apps/web/public/runner/alerts.js`
- Test: `packages/data/src/services/pricing.test.ts`

**Interfaces:**
- Produces: `fetchDailyStats(net, pairs): Promise<Record<string, { last: number; open24h: number }>>`
  in `sources/binance.ts`. Tasks 12 and 13 consume it.

**Why.** Three places compute "the last 24 hours" and two of them are wrong in
the same way. `fetchCrypto24hAgo` reads 25 hourly klines and takes the oldest
bar's close — but that close is the price at the *top of the hour* 24 hours
ago, so the window is anywhere from 24 to 25 hours long depending on when you
ask. Binance publishes an exact rolling figure and it does not agree with ours.
Measured 2026-08-25 at 12:35 UTC on ETHUSDT:

| basis | window | reads |
|---|---|---|
| `ticker/24hr` `openPrice` | exactly 24h, to the second | **−1.088%** |
| 25 hourly klines, oldest close | 24–25h, hour-aligned | **−1.672%** |

**0.58 percentage points**, which is twice the Binance-versus-CoinGecko gap the
spec worried about. It is also far cheaper: `ticker/24hr?type=MINI` batches
every symbol into one request at ~293 bytes each, against 4,439 bytes per
symbol for klines — **15× less data** for the twenty-three crypto symbols in
the live ledger, and one request instead of twenty-three.

- [ ] **Step 1: Write the failing test**

```ts
it("reads Binance's own rolling 24h window, not an hour-aligned approximation", async () => {
  invalidate();
  const net = FakeNet({
    "https://api.binance.com/api/v3/ticker/24hr":
      [{ symbol: "ETHUSDT", openPrice: "2497.70", lastPrice: "2470.53" }],
  });

  const stats = await fetchDailyStats(net, ["ETHUSDT"]);

  expect(stats["ETHUSDT"]).toEqual({ open24h: 2497.7, last: 2470.53 });
});

it("asks for the MINI form, which is what makes one request affordable", async () => {
  invalidate();
  const net = FakeNet({ "https://api.binance.com/api/v3/ticker/24hr": [] });
  await fetchDailyStats(net, ["BTCUSDT", "ETHUSDT"]);
  const url = net.calls[0]!.url;
  expect(url).toContain("type=MINI");
  // One request for both symbols, not one each.
  expect(net.calls).toHaveLength(1);
});
```

- [ ] **Step 2: Run and watch it fail** — `npx vitest run packages/data`, module missing.

- [ ] **Step 3: Implement `fetchDailyStats`**

```ts
/**
 * Last price and the price exactly twenty-four hours ago, per pair, in one
 * request.
 *
 * `openPrice` is Binance's own rolling-window open, accurate to the second.
 * The klines approach this replaced took the close of the bar 24 hours ago,
 * which is hour-aligned — so its window was 24 to 25 hours long depending on
 * when it was asked, and read 0.58 points differently on ETHUSDT at 12:35 UTC
 * on 2026-08-25.
 *
 * `type=MINI` drops the fields nobody here reads: ~293 bytes per symbol
 * against 4,439 for a 25-bar klines call, and one request rather than one per
 * symbol.
 */
export async function fetchDailyStats(
  net: Net,
  pairs: string[],
): Promise<Record<string, { last: number; open24h: number }>>
```

- [ ] **Step 4: Point all four callers at it**

`fetchCrypto24hAgo` becomes a thin wrapper (or is deleted and its callers
updated). `history`'s 1d `changePct` takes the same figure, so the number under
the chart matches the number in the header — they agree today only because both
were wrong identically, and this keeps them agreeing while making them right.
The klines call stays for *drawing* the line; only the percentage moves.

- [ ] **Step 5: Verify against a copy, then commit**

Check ETH's header and chart figures against Binance's own published 24h change
on the exchange. They should now match to the second decimal, which they do not
today.

---

### Task 11: Alerts that fire when the app opens

**Files:**
- Create: `packages/core/src/alert-rules.ts` (expansion and dedupe, pure)
- Create: `packages/core/src/alert-rules.test.ts`
- Modify: `apps/web/src/components/BackgroundAlerts.tsx` → foreground evaluation
- Modify: `apps/web/public/runner/alerts.js`

**Interfaces:**
- Consumes: `fetchDailyStats` (Task 10), `evaluatePriceTarget` and
  `evaluatePctMove` from `packages/core/src/alerts.ts`, unchanged.
- Produces: `expandRules(alerts, heldSymbols)` and `shouldNotify(sent, key, day)`.

**The reliable path is opening the app**, and it carries the feature. The
background attempt stays, unpromised.

- [ ] **Step 1: Write the failing tests**

```ts
describe("expandRules", () => {
  it("expands a portfolio-scoped rule into one check per held symbol", () => {
    // Today this rule is silently dropped: BackgroundAlerts filters on
    // `a.symbol &&`, and a portfolio-scoped alert has symbol null. It has
    // never fired for anyone.
    const rules = expandRules(
      [{ id: "a", kind: "pct_move", symbol: null, portfolioId: "p", params: { threshold: 5 } }],
      ["BTC", "ETH"],
    );
    expect(rules.map((r) => r.symbol)).toEqual(["BTCUSDT", "ETHUSDT"]);
    expect(rules.every((r) => r.id.startsWith("a:"))).toBe(true);
  });

  it("leaves indicator rules out — they need 1,460 bars of warm-up", () => {
    expect(expandRules([{ id: "i", kind: "indicator", symbol: "BTCUSDT", params: {} }], [])).toEqual([]);
  });

  it("prices a coin by its pair, never by the bare asset", () => {
    // The rename made a stored symbol an asset; Binance still wants the pair.
    expect(expandRules([{ id: "t", kind: "price_target", symbol: "ETH",
      params: { direction: "above", price: 1 } }], []).map((r) => r.symbol)).toEqual(["ETHUSDT"]);
  });
});

describe("shouldNotify", () => {
  it("notifies once per rule per UTC day, so a standing condition stays quiet", () => {
    const sent = {};
    expect(shouldNotify(sent, "m:a:up", 20_000)).toBe(true);
    sent["m:a:up"] = 20_000;
    expect(shouldNotify(sent, "m:a:up", 20_000)).toBe(false);
    expect(shouldNotify(sent, "m:a:up", 20_001)).toBe(true);
  });

  it("separates the directions, so a fall after a rise still notifies", () => {
    const sent = { "m:a:up": 20_000 };
    expect(shouldNotify(sent, "m:a:down", 20_000)).toBe(true);
  });
});
```

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Implement the pure half** in `packages/core/src/alert-rules.ts`.
  Both functions are pure so they can be tested without a device — there is no
  component test stack in this repository and the native path cannot be
  exercised anywhere but a handset.

- [ ] **Step 4: Evaluate on foreground.** `BackgroundAlerts` stops being a
  courier for the runner and becomes the evaluator: on mount and on every
  return to foreground, expand the rules, one `fetchDailyStats` call, evaluate,
  post a local notification per hit, record the dedupe marks. It keeps handing
  rules to the runner as well, but no longer depends on it.

- [ ] **Step 5: The runner uses the same batched call.** Replace its per-symbol
  klines loop with one `ticker/24hr?type=MINI` request. The duplication with
  `packages/core` is unavoidable — that runtime has no imports — and the
  comment on both sides must say so.

- [ ] **Step 6: Verify by hand.** Set a target that must fire, force-quit,
  reopen. The notification should arrive within a second of the app opening.

---

### Task 12: Say what it cannot do

**Files:**
- Modify: `apps/web/src/app/alerts/page.tsx`
- Create: `packages/ui/src/LastChecked.tsx`
- Modify: `packages/core/src/storage-keys.ts`

**This task is the reason the spec exists.** The failure being designed against
is not a missed notification — it is a month of silence that looked like "no
alerts triggered". Silence must become visible.

- [ ] **Step 1: Record and show when a check last ran**

The evaluator writes a timestamp on every check, foreground or background,
under a new key in `storage-keys.ts`. The alerts screen renders it: *"Last
checked 3 hours ago"*, or *"Not checked since yesterday"* in the app's warning
colour, per `BRAND.md`'s rule that amber means degraded data.

- [ ] **Step 2: Copy that does not overclaim**

No interval appears anywhere in the UI, because none can be kept. The alerts
screen states: checked every time you open the app, and sometimes in the
background when Android allows. And the honest limit, in the app rather than
only in a spec — **a target hit and reverted overnight can be missed.**

Per `BRAND.md`: sentence case, no exclamation marks, and the control says what
happens rather than what the system calls it.

- [ ] **Step 3: A help screen, not a permission**

Explain how to exempt the app from battery optimisation in Android's own
Settings, framed as improving the odds rather than guaranteeing anything.
**Declare no permission and fire no intent** — Play prohibits apps from
requesting exemption unless their core function requires it, and a portfolio
tracker does not qualify. Documentation is not a permission and is not
restricted.

- [ ] **Step 4: Verify overnight on a handset.** Leave a rule that must fire,
  face-down and off-charge, for eight hours. Record what arrived, when, and
  what the last-checked line said in the morning. This is the only test that
  measures the thing in question.

---

### Task 13: An APK, on a real phone

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `docs/carried-forward.md`
- Modify: `capacitor.config.ts` if the `BackgroundRunner` block is removed

- [ ] **Step 1: Build**

```bash
npm run build --workspace @contour/mobile
npx cap sync android
cd android && ./gradlew assembleDebug
```

- [ ] **Step 2: Install and use it with the network off**

The whole point, and the one check no test performs. On a device, in aeroplane
mode:

- The portfolio opens and shows quantities, cost basis and realised P&L
- Prices are absent and say so — **no zeros, nothing excluded silently**
- The ledger lists every transaction
- Import a Delta CSV; the figures match what the web app shows for the same file
- Export a backup and open it
- Force-quit and reopen: the data is still there

Then with the network on: prices arrive, Markets loads, an asset page draws.

- [ ] **Step 3: Press the back button**

`docs/carried-forward.md` records that the Android back fix — an
`OnBackPressedCallback` in `MainActivity` — has never been tested by a human on
a device, only in a desktop browser. This is that moment. Ten seconds.

- [ ] **Step 4: Check the two known gaps behave**

- **Equity asset info fails on device** — Yahoo's cookie-and-crumb handshake
  needs a response header `Net` does not expose (spec §4.2), and ETF screeners
  answer 401 without a crumb. Confirm the failure is *honest*: a stated absence,
  not an empty panel. If it is not, that is a bug in this plan's Task 9 work.
- **Insights issues 13 requests on first paint.** On a device half is local and
  instant, half waits on mobile data. Measure it. If it is bad, say so and file
  it; do not fix it here.

- [ ] **Step 5: Documentation**

`CLAUDE.md` gains `apps/mobile` in the architecture tree and a note that the
lint loop now covers five workspaces. `README.md` states what the mobile build
does not do. `docs/carried-forward.md` moves the Phase 4 entries to "Resolved"
and keeps the ones this plan did not close — the Yahoo crumb, the Insights
request count, `cached()` never evicting.

- [ ] **Step 6: `cached()` on a long-lived process**

`packages/core/src/cache.ts` is an unbounded `Map` with time-bucketed keys.
Harmless on a server that restarts; a device process lives for weeks. Either
bound it here or file it with a measurement of how fast it actually grows —
**but do not leave it unmentioned**, because this is the phase that changes the
assumption it was written under.

- [ ] **Step 7: No release without a licence**

Do not publish an APK anywhere, or tag a release, while there is no `LICENSE`
file. A debug build on the author's own phone is fine and is what this task
produces.

---

## Self-review

**Spec coverage.**

| Spec section | Task |
|---|---|
| §3 layout — `apps/mobile`, workspaces | 1 |
| §3 — `TabBar`/`TopNav` take their destinations | 5 |
| §4.1/§5 — `SqliteStore`, hand-owned migrations, three tables | 2 |
| §4.2 — `CapacitorNet` | 3 |
| §4.4 — `LocalClient`, one provider per app | 4 |
| §6 — `/portfolio/asset?symbol=` | 5 |
| §6 — middleware stays on web | 1 (by omission, stated) |
| §7 — device lock, no password | 8 |
| §7 — bundled icons, initials fallback | 7 |
| §8 — contract against both implementations | 4, 9 |
| §8 — migration tests | 2 |
| §9 Phase 4 row — first real APK | 13 |
| Alerts §3.2 — opening the app is the reliable path | 11 |
| Alerts §3.4 — one source for the 24-hour figure | 10 |
| Alerts §3.6 — portfolio-scoped rules expand on the device | 11 |
| Alerts §5 — a visible last-checked time, copy that does not overclaim | 12 |
| Alerts §2 — a help screen, and no exemption permission | 12 |
| §4.4 note — `exportFile` and a header-reading `Net` | 6 |
| §4.4 note — the five derived-fixture reads, the offline case | 9 |

**Three rulings this plan makes, all flagged inline with their cost:** Phase 0
stays open and does not block this work; Markets is in mobile v1 because
`getMarkets` is a required client method regardless; and `BackgroundRunner`
stays in `capacitor.config.ts` for now rather than being removed as a drive-by.

**Ordering.** Tasks 2, 3 and 4 are the architecture and each ends with a
contract suite passing — that is where the risk is, and it is front-loaded.
Task 5 is the largest by file count and the least risky, because a moved screen
either renders or does not. Tasks 6 and 7 each retire allowlist entries that
have been carrying "Phase 4 must decide this" since Phase 3.

**What none of this catches.** Whether the app is *pleasant* on a phone. Every
verification here is a figure or a passing test; the one in Task 13 Step 2 is a
person using it in aeroplane mode, and that is the only step that can find out
the answer is no.
