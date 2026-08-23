# Phase 3 — The DataClient, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the UI's direct `fetch("/api/…")` calls with a `DataClient` interface, so that in Phase 4 the same screens can be served by a local implementation that calls the Phase 2 services directly, with no server.

**Architecture:** `packages/data` gains a `DataClient` interface and an `HttpClient` implementation that calls today's routes. One React context provides it; every in-scope screen and shared component consumes it and never names an implementation. `apps/web` supplies `HttpClient` at its root. Behaviour does not change — the same requests go over the wire, issued from one place instead of thirty-six.

**Tech Stack:** Next.js 16.2.6 (App Router), React 19, TypeScript 5, Vitest 3, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-22-standalone-android-design.md` — §4.4 defines `DataClient`.

## Global Constraints

- **Every task ends green.** `npx vitest run` passes with a count that only rises — currently **363 across 32 files**. `npm run typecheck` silent, `npm run build` succeeds.
- **Behaviour does not change.** Same requests, same order, same error handling. The screens must look and behave identically.
- **No screen or shared component may name an implementation.** They take `DataClient` from context. A component that imports `HttpClient` has defeated the phase.
- **`packages/data` stays portable** — no Prisma, no `next/*`, no `node:*`, no global `fetch` outside `HttpClient`'s injected `Net`. `boundary.test.ts` and `layer.test.ts` enforce it.
- **`packages/ui` is shared with the mobile build.** Nothing in it may assume a server exists.
- Prisma pinned to v6; `npm run lint` stays at exactly **21** pre-existing errors.
- Build first, then restart the server. Never rebuild underneath a running one.
- Comments explain *why*, not *what*. `BRAND.md` governs anything user-facing; nothing here should change what a user sees.

## Scope

**In — 36 call sites across 8 files:**

| File | Sites |
|---|---|
| `packages/ui/src/PortfolioManager.tsx` | 6 |
| `packages/ui/src/AssetInfoPanel.tsx` | 1 |
| `packages/ui/src/SymbolPicker.tsx` | 1 |
| `apps/web/src/app/portfolio/page.tsx` | 6 |
| `apps/web/src/app/portfolio/[symbol]/page.tsx` | 8 |
| `apps/web/src/app/insights/page.tsx` | 7 |
| `apps/web/src/app/ledger/page.tsx` | 4 |
| `apps/web/src/app/settings/page.tsx` | 3 of 12 (`/api/settings` only) |

**Out, and staying on raw `fetch`:** `alerts`, `analyze`, `backtest`, `chart`, `login/LoginForm`, `BackgroundAlerts`, and the nine auth/push calls in `settings/page.tsx` (`/api/logout`, `/api/push/*`, `/api/settings/password`, `/api/webauthn/*`).

Those screens do not exist in the mobile build (spec §2), so routing them through `DataClient` would widen the interface with methods one implementation could never satisfy. The three `packages/ui` components are the opposite case and the highest priority in the phase: they are shared, they call `/api` directly today, and the mobile build cannot work until they stop.

## File Structure

```
packages/data/src/
  client/
    data-client.ts        the DataClient interface + its DTOs
    http-client.ts        HttpClient — calls /api/*, takes a Net
    context.tsx           DataClientProvider + useDataClient()
    client-contract.ts    the suite every implementation must pass
    http-client.test.ts   runs the contract against HttpClient over FakeNet

apps/web/src/app/
  providers.tsx           mounts DataClientProvider with HttpClient
```

`context.tsx` is the one `.tsx` in `packages/data`. It is a client component and must carry `"use client"`.

---

### Task 1: The interface, the client, and the provider

Nothing is converted. This builds what the other tasks consume, and the contract that keeps two implementations honest.

**Files:**
- Create: `packages/data/src/client/{data-client.ts,http-client.ts,context.tsx,client-contract.ts,http-client.test.ts}`
- Create: `apps/web/src/app/providers.tsx`
- Modify: `apps/web/src/app/layout.tsx` (mount the provider)
- Modify: `packages/data/src/index.ts` (export the client surface)

**Interfaces:**
- Consumes: `Net` and `FakeNet` from Phase 2.
- Produces, and every later task depends on these exact names:
  - `DataClient` — the interface, methods listed in Step 2.
  - `HttpClient(net: Net, baseUrl?: string): DataClient`.
  - `DataClientProvider({ client, children })` and `useDataClient(): DataClient`.
  - `runDataClientContract(name: string, makeClient: () => DataClient)`.

- [ ] **Step 1: Inventory the 36 call sites first**

Before designing anything, read all eight in-scope files and record in your report, for each call site: the URL, the method, the request body shape, the response shape the caller destructures, and **how it handles failure** — `.catch(() => null)`, a thrown error, a silent ignore. The interface has to serve all of them.

Pay attention to `PortfolioManager.tsx:56` and `:90`, which post a file body rather than JSON. Those two decide whether the interface takes `File`, `string`, or something else — and whichever you choose, a device implementation must be able to satisfy it.

- [ ] **Step 2: Define `DataClient`**

One method per operation, named for the operation rather than the URL. Derive the exact list from your Step 1 inventory; it should cover portfolios, transactions, valuation, series, changes, insights, snapshot, benchmark, history, symbols, asset info, settings, import, export and restore.

Two rules on shape:

**Normalise "record missing" at this boundary.** Phase 2 left four different behaviours in place, each faithful to its route: `getPortfolio` throws `NotFoundError`, `simulateSameFlows` returns `null`, `clearPortfolio` returns `0`, and three write paths let a raw store error become a 500. That was correct then — the routes had to keep working. It is not correct for an interface with two implementations. Pick one convention, state it in the interface's doc comment, and make `HttpClient` honour it. Do this **now**, while there is one implementation, not after there are two.

**Return DTOs, not `Response`.** No caller should see a status code. Errors are typed and thrown.

- [ ] **Step 3: Write the contract suite, and watch it fail**

`client-contract.ts` exports `runDataClientContract(name, makeClient)`. It asserts behaviour every implementation must share: what each method returns for a known fixture, that a missing record produces the agreed failure, and that a network failure surfaces as a typed error rather than `undefined`.

Run: `npx vitest run packages/data/src/client`
Expected: FAIL — `HttpClient` does not exist.

- [ ] **Step 4: Implement `HttpClient`**

It takes a `Net`, so it is testable against `FakeNet` and — this is the point — a device could in principle point it at a server. Every method maps to exactly the request the current UI makes: same path, same method, same body encoding. Do not "improve" a request while moving it.

Run: `npx vitest run packages/data/src/client`
Expected: PASS.

- [ ] **Step 5: The provider**

`context.tsx` with `"use client"`, a `createContext`, `DataClientProvider`, and `useDataClient()` that **throws a clear error when used outside a provider** — a hook returning `undefined` in a screen is a confusing failure at exactly the moment someone forgets to mount it.

`apps/web/src/app/providers.tsx` constructs `HttpClient(webNet)` once at module scope and mounts the provider. Wire it into `layout.tsx` inside the existing tree.

- [ ] **Step 6: Verify and commit**

```bash
npx vitest run          # above 363, no suite lost
npm run typecheck       # silent
npm run build           # succeeds
```

Then build, restart, and confirm the app still loads and shows real data — the provider is mounted but nothing consumes it yet, so nothing should differ.

```bash
git add -A
git commit -m "Give the UI one way to ask for data

Every screen currently issues its own fetch, which is why the mobile build
has nowhere to intervene. DataClient is that seam: HttpClient calls the same
routes over the same Net, and Phase 4's LocalClient will call the services
directly instead.

The contract suite exists so the second implementation has a definition of
correct rather than an example, the same way the Store contract does."
```

---

### Task 2: Convert the shared components

The highest-priority conversion in the phase. `packages/ui` is shared with the mobile build, and these three components call `/api` directly, so the mobile build cannot work until they stop.

**Files:**
- Modify: `packages/ui/src/PortfolioManager.tsx` (6 sites), `AssetInfoPanel.tsx` (1), `SymbolPicker.tsx` (1)
- Modify: `packages/core/src/boundary.test.ts` or `packages/data/src/layer.test.ts` — see Step 4

**Interfaces:**
- Consumes: `useDataClient` from Task 1.
- Produces: three components that name no URL and no implementation.

- [ ] **Step 1: Convert `SymbolPicker` first**

One call site, `fetch("/api/symbols")`. It is the smallest, so it proves the pattern before the six-site component.

- [ ] **Step 2: Convert `AssetInfoPanel`**

One site, but it encodes a symbol and passes an `assetType` query parameter. Confirm the client method takes both and that the encoding still happens exactly once — a double-encoded symbol is a 404 nobody notices until a ticker has a dot in it, and your equity tickers do.

- [ ] **Step 3: Convert `PortfolioManager`**

Six sites: list, create, delete, import, clear and restore. Two post file bodies. Keep every `.catch(() => null)` and every error path exactly as it is; this component is the one that deletes things, and its failure handling is load-bearing.

- [ ] **Step 4: Guard it**

Add a test that fails if any file under `packages/ui/src` calls global `fetch`. Put it wherever the existing portability guards live so the rules stay together, and follow their established shape.

This is the mechanical version of "packages/ui is shared and must not assume a server". Prove it bites: temporarily add a `fetch(` call to a component, watch it fail naming the file, remove it.

- [ ] **Step 5: Verify by hand — the harness cannot see this**

`scripts/parity.mjs` compares API responses. It cannot tell you whether a *screen* still works. Load the app and exercise all three components:

- the symbol picker populates and filters
- an asset page shows its info panel
- the portfolio manager lists portfolios, and — against a **scratch portfolio only** — create, import a small CSV, clear, and delete

Record what you did and what you saw. Never exercise the destructive paths against the owner's real portfolio.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Stop the shared components reaching for a server

These three live in packages/ui, which the Android build compiles into an
APK with no server behind it. Every /api call in here was a screen that
would have failed silently on a device.

The new guard is the point: it fails if anything in packages/ui calls fetch
again, so this cannot quietly come back."
```

---

### Task 3: Convert the portfolio screens

Fourteen call sites across the two busiest screens.

**Files:**
- Modify: `apps/web/src/app/portfolio/page.tsx` (6 sites), `apps/web/src/app/portfolio/[symbol]/page.tsx` (8 sites)

**Interfaces:**
- Consumes: `useDataClient`, and the shared components from Task 2.

- [ ] **Step 1: Record the request order before you change it**

Both screens fire several requests per render, some in parallel and some sequenced by a `useEffect` dependency. Note in your report which are parallel and which are sequential, because collapsing a `Promise.all` into awaits — or the reverse — changes perceived load time even when every response is identical.

- [ ] **Step 2: Convert `portfolio/page.tsx`**

Six sites: portfolios, valuation, series, changes, transactions, and a transaction write. Keep the loading and stale states exactly as they are.

- [ ] **Step 3: Convert `portfolio/[symbol]/page.tsx`**

Eight sites. This screen also owns transaction add and delete. Preserve every error path.

- [ ] **Step 4: Verify by hand**

Load both screens against the real portfolio, read-only: the value chart renders across at least two ranges, holdings list with prices, per-asset page opens, transaction list paginates if it does today. Use a **scratch portfolio** for any write.

Then run `node scripts/parity.mjs compare` — it will not exercise the screens, but it confirms you did not disturb the routes underneath.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Point the portfolio screens at the client

Fourteen call sites, the two screens a Delta user opens first. The request
order is preserved deliberately: several of these run in parallel, and
serialising them would change how the page feels without changing a single
response."
```

---

### Task 4: Convert insights and ledger

Eleven call sites.

**Files:**
- Modify: `apps/web/src/app/insights/page.tsx` (7 sites), `apps/web/src/app/ledger/page.tsx` (4 sites)

- [ ] **Step 1: Convert `insights/page.tsx`**

Seven sites, including the benchmark comparison. Note that `insights/page.tsx` keeps its own hand-written `BENCHMARKS` list while `packages/data/src/services/series.ts` exports one that has no importer — a duplication recorded in Phase 2 and left alone. **Leave it alone again**; consolidating it is a behaviour question about which benchmarks are offered, not a plumbing change, and it does not belong in a conversion task. Note it in your report.

- [ ] **Step 2: Convert `ledger/page.tsx`**

Four sites: cost basis, realised profit, fees and the January valuation.

- [ ] **Step 3: Verify by hand**

Both screens against the real portfolio, read-only. The insights benchmark selector must still switch benchmarks and redraw. The ledger's figures must match what they showed before — screenshot or note two of them before and after.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Point insights and the ledger at the client

Eleven call sites. The duplicated BENCHMARKS list stays duplicated: which
benchmarks the app offers is a product question, and this is a plumbing
change."
```

---

### Task 5: Convert the three settings calls, and close the setup gap

Only three of `settings/page.tsx`'s twelve fetches are in scope. The other nine are auth and push, which the mobile build does not have.

**Files:**
- Modify: `apps/web/src/app/settings/page.tsx` (3 of 12 sites)
- Modify: `apps/web/src/app/api/setup/route.ts`, `packages/data/src/ports/store.ts`, both store implementations, `store-contract.ts`

- [ ] **Step 1: Convert only the `/api/settings` calls**

Leave `/api/logout`, `/api/push/*`, `/api/settings/password` and `/api/webauthn/*` on raw `fetch`. Add a comment at the top of the file saying which calls go through the client and why the rest do not — the next reader will otherwise assume the file was half-converted by accident.

- [ ] **Step 2: Close the `/api/setup` port gap**

`apps/web/src/app/api/setup/route.ts` reads and writes the settings row through Prisma directly to manage `passwordHash`. Phase 2's final review called this the mirror image of the `settings.exists()` fix — reads went through the port, writes did not — and named it the first thing Phase 3 should close.

`passwordHash` is deliberately absent from `Store.Settings`, and it must stay absent: it is server-only and the mobile build has no password. So this is **not** a matter of adding the field.

Read the route, decide the smallest honest port addition that lets it stop touching Prisma — or conclude that it should keep direct access because it is a permanently-inline auth route, which is a legitimate answer. **Report your reasoning either way before implementing.** If you add a port method, pin it in the contract.

- [ ] **Step 3: Verify by hand**

Change a setting through the UI and change it back, confirming both took effect. Confirm the passkey list still renders and the Home Assistant test ping still fires — those are the unconverted paths in the same file, and a broken import would take them down with the converted ones.

If you changed `/api/setup`, verify the first-run flow still works. Do that against a **temporary database**, never the owner's — their install is already set up and cannot exercise first-run without being broken.

- [ ] **Step 4: Commit**

---

### Task 6: Close the phase

**Files:**
- Create: a guard test asserting no in-scope UI file calls global `fetch`
- Modify: `CLAUDE.md`, the spec

- [ ] **Step 1: Sweep**

Count remaining `fetch(` calls in `apps/web/src/app` and `packages/ui/src`. Every survivor must be on the out-of-scope list. Record the count and name each one.

- [ ] **Step 2: Guard the in-scope set**

A test that fails if any of the eight converted files reaches for global `fetch` again. Name the out-of-scope files explicitly in an allowlist with a comment saying why each is exempt — an unexplained allowlist becomes a dumping ground.

Prove it bites.

- [ ] **Step 3: Run the contract against a second implementation, even a trivial one**

The contract suite currently runs against `HttpClient` alone, which proves nothing about portability. Write a minimal stub implementation backed by `MemoryStore` — it need not be `LocalClient`, and Phase 4 will replace it — and run the same suite against it.

If the contract cannot be satisfied by anything other than `HttpClient`, the interface is shaped around HTTP and Phase 4 will discover that the expensive way. Better to find out here. Report what you learned; if you find the interface is HTTP-shaped, **say so plainly** rather than bending the stub to fit.

- [ ] **Step 4: Document**

`CLAUDE.md`: what `DataClient` is, that screens take it from context and never name an implementation, which screens are deliberately not converted and why, and that Phase 4 supplies `LocalClient` over `SqliteStore` and `CapacitorNet`.

Reconcile the spec's §4.4 against what was built, as Phase 2 did for §4.1 and §4.2.

- [ ] **Step 5: Final verification**

All gates, plus a full pass through every converted screen by hand.

---

## Phase 3 exit criteria

- [ ] `npx vitest run` green, above 363, no suite lost
- [ ] `npm run typecheck` silent; `npm run build` succeeds
- [ ] `node scripts/parity.mjs compare` clean, DIFFs argued
- [ ] No file in `packages/ui/src` calls global `fetch`
- [ ] No in-scope screen names an implementation or a URL
- [ ] The `DataClient` contract passes against **two** implementations
- [ ] Every converted screen verified by hand against real data
- [ ] `npm run lint` reports no new errors beyond the 21

## What Phase 3 deliberately does not do

No `LocalClient`, no `SqliteStore`, no `CapacitorNet`, no `apps/mobile`. The out-of-scope screens keep their `fetch` calls permanently. Phase 4 gets its own plan once this lands.
