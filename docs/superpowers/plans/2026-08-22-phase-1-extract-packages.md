# Phase 1 — Extract shared packages, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the repository into `packages/core`, `packages/ui` and `apps/web` so a second app can be added later, changing no behaviour and breaking no tests.

**Architecture:** npm workspaces. `packages/*` are TypeScript sources consumed through tsconfig path aliases, not through node module resolution — there is no build step and no `main` field. Because `@/lib/*` and `@/components/*` keep resolving after the move (via fallback arrays in `paths`), **not one import statement in the repository changes**. The only files edited are configuration, plus one dead-code deletion.

**Tech Stack:** Next.js 16.2.6 (App Router), TypeScript 5, Tailwind v4 (CSS-first — no `tailwind.config`), Prisma 6 + SQLite, Vitest 3, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-22-standalone-android-design.md`

## Global Constraints

- **Every task ends green.** `npx vitest run` reports **193 passed (18 files)** and `npx tsc --noEmit` is silent. A task that changes either number has gone wrong; fix it before committing rather than adjusting the expectation.
- **No import statement in `src/` is edited in this phase.** If you find yourself rewriting `from "@/lib/x"`, the path aliases are wrong. Fix the config.
- **No behaviour changes.** No renamed props, no copy edits, no restyling. Phase 1 is a move.
- **Prisma stays pinned to v6.** Do not run `npm i prisma@latest`.
- **Run vitest from the repository root.** Two pinescript tests read `join(process.cwd(), "samples/risk-metric.pine")`, and `samples/` stays at the root.
- **Tailwind v4 has no `content` array.** Files outside the app directory are scanned only if named by an `@source` directive in the CSS.
- **`file:./dev.db` is relative to the schema's own directory.** Moving `prisma/` without moving `dev.db` alongside it silently creates a new empty database.
- Read `BRAND.md` before touching anything user-facing. Nothing in this phase should be user-facing.

---

### Task 1: Delete the dead WebSocket path

`src/lib/binance.ts` opens with `import WebSocket from "ws"`. `ws` is a Node package with no browser build, so any client bundle importing this file fails — which is exactly what `apps/mobile` will do in Phase 4, since it calls Binance directly with no server in between.

The import exists solely for `subscribeKlines`. That function has zero callers anywhere in the repository. This is dead code, and deleting it is a better fix than isolating it.

**Files:**
- Modify: `src/lib/binance.ts` (remove line 1 and the `subscribeKlines` function)
- Modify: `package.json` (drop `ws` and `@types/ws`)
- Test: `src/lib/binance.portability.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `src/lib/binance.ts` exporting `fetchKlines`, `fetchKlinesRange`, `fetchPricesSafe` and its other current members **minus** `subscribeKlines`. Later tasks and phases may import this file into browser bundles.

- [ ] **Step 1: Confirm the function really is unused**

Run:
```bash
grep -rn "subscribeKlines" src/ scripts/ --include='*.ts' --include='*.tsx'
```
Expected: matches **only** inside `src/lib/binance.ts`. If anything else appears, stop — this task's premise is wrong; report it instead of proceeding.

- [ ] **Step 2: Write the failing test**

Create `src/lib/binance.portability.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The mobile build calls Binance from the device with no server in between,
 * so this module ends up in a browser bundle. `ws` has no browser build and
 * would break that bundle at compile time.
 */
describe("binance.ts is safe to bundle for a browser", () => {
  it("does not import ws", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/binance.ts"), "utf8");
    expect(src).not.toMatch(/from\s+"ws"/);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/lib/binance.portability.test.ts`
Expected: FAIL — `expected 'import WebSocket from "ws"…' not to match /from\s+"ws"/`

- [ ] **Step 4: Delete the import and the function**

In `src/lib/binance.ts`, remove the first line (`import WebSocket from "ws";`) and the entire `subscribeKlines` function, including its doc comment and the `WS_BASE` constant if nothing else references it.

Verify nothing else used `WS_BASE`:
```bash
grep -n "WS_BASE" src/lib/binance.ts
```
Expected: no output.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: **194 passed (19 files)** — the original 193 plus the new one.

Run: `npx tsc --noEmit`
Expected: silent.

- [ ] **Step 6: Drop the dependency**

Run:
```bash
npm uninstall ws @types/ws
npx tsc --noEmit
npx vitest run
```
Expected: silent, then **194 passed**.

- [ ] **Step 7: Commit**

```bash
git add src/lib/binance.ts src/lib/binance.portability.test.ts package.json package-lock.json
git commit -m "Delete a WebSocket subscriber nothing subscribes to

It was the only reason binance.ts imported ws, which has no browser
build — so the file could not be bundled for a device that talks to
Binance directly. Removing the caller-less function removes the
dependency rather than working around it."
```

---

### Task 2: Extract `packages/core`

Move `src/lib` to `packages/core/src`, leaving behind only what cannot run without a server. The path alias `@/lib/*` gains a fallback array so that both locations resolve and **no import changes**.

**Files:**
- Create: `tsconfig.base.json`
- Create: `packages/core/package.json`
- Create: `packages/core/src/boundary.test.ts`
- Modify: `package.json` (add `workspaces`)
- Modify: `tsconfig.json` (extend the base, add fallback paths)
- Move: `src/lib/*` → `packages/core/src/*`, except `db.ts`, `webauthn.ts`, `auth.ts`, `auth.test.ts`, `pinescript/library.ts`, `notifier/`

**Interfaces:**
- Consumes: Task 1's portable `binance.ts`.
- Produces:
  - Alias `@/lib/*` resolving to `packages/core/src/*` first, then `src/lib/*`.
  - Alias `@/core/*` resolving to `packages/core/src/*` (explicit form, for new code).
  - `packages/core/src/boundary.test.ts` exporting nothing; it is the guard later phases rely on.

- [ ] **Step 1: Create the workspace root**

Add to `package.json`, immediately after `"private": true`:

```json
  "workspaces": ["packages/*", "apps/*"],
```

Create `packages/core/package.json`:

```json
{
  "name": "@contour/core",
  "version": "0.1.0",
  "private": true
}
```

There is deliberately no `main`, no `exports` and no build script. This package is consumed through tsconfig paths, so nothing ever resolves it as a node module.

- [ ] **Step 2: Move the portable files**

```bash
mkdir -p packages/core/src
git mv src/lib/indicator packages/core/src/indicator
git mv src/lib/pinescript packages/core/src/pinescript
for f in alerts alerts.test asset-info asset-info.test asset-names \
         backtest binance binance.portability cache cash cash.test chart-data \
         chart-data.test delta-csv delta-csv.test display display.test display-tx \
         equity export export.test fx insights insights.test performance \
         performance.test portfolio portfolio.test ranges ranges.test session \
         session.test storage-keys storage-keys.test types; do
  git mv "src/lib/$f.ts" "packages/core/src/$f.ts"
done
```

`auth.ts` is absent from that list on purpose: it imports Node's bare
`"crypto"` for scrypt password hashing. It stays behind with its test.

Now put the filesystem-backed PineScript library back — the directory move
above took it along, and `node:fs/promises` cannot go to a device:

```bash
mkdir -p src/lib/pinescript
git mv packages/core/src/pinescript/library.ts src/lib/pinescript/library.ts
```

Verify what is left behind:
```bash
find src/lib -type f | sort
```
Expected exactly:
```
src/lib/auth.test.ts
src/lib/auth.ts
src/lib/db.ts
src/lib/notifier/home-assistant.ts
src/lib/notifier/index.ts
src/lib/notifier/web-push.test.ts
src/lib/notifier/web-push.ts
src/lib/pinescript/library.ts
src/lib/webauthn.ts
```

Check that nothing left in `packages/core` still imports the library you just
pulled back out:

```bash
grep -rn "pinescript/library\|from \"./library\"" packages/core/src
```
Expected: no output. If `analyze.ts` or `apply.ts` import it, stop and report —
the split is wrong and the spec needs revisiting.

- [ ] **Step 3: Point the aliases at both places**

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true
  }
}
```

Replace `tsconfig.json` with:

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/core/*": ["./packages/core/src/*"],
      "@/lib/*": ["./packages/core/src/*", "./src/lib/*"],
      "@/*": ["./src/*"]
    }
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts",
    "**/*.mts"
  ],
  "exclude": ["node_modules"]
}
```

The array under `@/lib/*` is what makes this a zero-import-edit move: TypeScript and Next both try each entry in order. `@/lib/portfolio` finds `packages/core/src/portfolio.ts`; `@/lib/db` falls through to `src/lib/db.ts`.

- [ ] **Step 4: Verify nothing broke before adding the guard**

Run: `npx tsc --noEmit`
Expected: silent. If it reports "Cannot find module '@/lib/…'", the `paths` array is wrong — do not fix it by editing imports.

Run: `npx vitest run`
Expected: **194 passed (19 files)**.

Run: `npm run build`
Expected: build completes.

- [ ] **Step 5: Write the failing boundary test**

Create `packages/core/src/boundary.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `packages/core` is bundled into an Android APK that has no server behind
 * it. Anything importing a Node builtin or a server-only package cannot go
 * there, and finding out at bundle time in Phase 4 is far more expensive than
 * finding out here. Tests are exempt: they run under Node by definition.
 */
const FORBIDDEN = [
  "@prisma/client",
  "@simplewebauthn/server",
  "web-push",
  "ws",
  "node:fs",
  "node:path",
  "node:crypto",
  "crypto",
  "next/server",
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!full.endsWith(".ts") && !full.endsWith(".tsx")) return [];
    if (full.endsWith(".test.ts") || full.endsWith(".test.tsx")) return [];
    return [full];
  });
}

describe("packages/core stays portable", () => {
  it("imports nothing that only exists on a server", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(process.cwd(), "packages/core/src"))) {
      const src = readFileSync(file, "utf8");
      for (const mod of FORBIDDEN) {
        if (src.includes(`from "${mod}"`) || src.includes(`from "${mod}/`)) {
          offenders.push(`${file.replace(process.cwd() + "/", "")} -> ${mod}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 6: Run it**

Run: `npx vitest run packages/core/src/boundary.test.ts`
Expected: PASS. Step 2 already removed every offender, so this test documents and locks in a state that already holds.

To prove the guard actually bites, temporarily add `import { readFileSync } from "node:fs";` to `packages/core/src/types.ts`, re-run, confirm it FAILS naming that file, then remove the line and confirm it passes again.

- [ ] **Step 7: Run everything**

Run: `npx vitest run`
Expected: **195 passed (20 files)**.

Run: `npx tsc --noEmit && npm run build`
Expected: silent, then a successful build.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Extract the portable half of src/lib into packages/core

Thirty-three of thirty-eight files move without an edit; the four that
stay import Prisma, SimpleWebAuthn, node:fs or web-push. A fallback
array in tsconfig paths keeps @/lib/* resolving to both places, so not
one import statement changes.

The boundary test is the point of the exercise: a server-only import
sneaking into core is a bundle failure in Phase 4 and a failing test
here."
```

---

### Task 3: Extract `packages/ui`

Same move, same technique, for components. Two components stay behind: `BackgroundAlerts` (alerts, which the mobile build does not have) and `PwaSetup` (service-worker registration, meaningless in a native shell).

The one genuine trap is Tailwind. Version 4 has no `content` array — it discovers classes by scanning from the CSS file's location, and `packages/ui` is outside that tree. Without an `@source` directive every class used only by a moved component is silently dropped from the stylesheet, and the app renders unstyled in ways no test catches.

**Files:**
- Create: `packages/ui/package.json`
- Modify: `tsconfig.json` (add `@/components/*` fallback array)
- Modify: `src/app/globals.css` (add `@source`)
- Move: `src/components/*` → `packages/ui/src/*`, except `BackgroundAlerts.tsx`, `PwaSetup.tsx`

**Interfaces:**
- Consumes: aliases from Task 2.
- Produces:
  - Alias `@/components/*` resolving to `packages/ui/src/*` first, then `src/components/*`.
  - Alias `@/ui/*` resolving to `packages/ui/src/*`.
  - `packages/ui/src/` holding 18 files: `AssetInfoPanel`, `BiometricLock`, `CoinIcon`, `ComparisonChart`, `ContourMark`, `PortfolioManager`, `PrivacyToggle`, `RangePicker`, `StatTile`, `SymbolPicker`, `TabBar`, `TopNav`, `TradingBackdrop`, `TxForm`, `ValueChart`, `useFitChart`, `usePrivacy`, `useStoredRange`.

- [ ] **Step 1: Create the package**

Create `packages/ui/package.json`:

```json
{
  "name": "@contour/ui",
  "version": "0.1.0",
  "private": true
}
```

- [ ] **Step 2: Move the components**

```bash
mkdir -p packages/ui/src
for f in AssetInfoPanel.tsx BiometricLock.tsx CoinIcon.tsx ComparisonChart.tsx \
         ContourMark.tsx PortfolioManager.tsx PrivacyToggle.tsx RangePicker.tsx \
         StatTile.tsx SymbolPicker.tsx TabBar.tsx TopNav.tsx TradingBackdrop.tsx \
         TxForm.tsx ValueChart.tsx useFitChart.ts usePrivacy.ts useStoredRange.ts; do
  git mv "src/components/$f" "packages/ui/src/$f"
done
```

Verify what is left:
```bash
find src/components -type f | sort
```
Expected exactly:
```
src/components/BackgroundAlerts.tsx
src/components/PwaSetup.tsx
```

- [ ] **Step 3: Extend the aliases**

In `tsconfig.json`, replace the `paths` block with:

```json
    "paths": {
      "@/core/*": ["./packages/core/src/*"],
      "@/ui/*": ["./packages/ui/src/*"],
      "@/lib/*": ["./packages/core/src/*", "./src/lib/*"],
      "@/components/*": ["./packages/ui/src/*", "./src/components/*"],
      "@/*": ["./src/*"]
    }
```

- [ ] **Step 4: Tell Tailwind where the components went**

At the top of `src/app/globals.css`, directly after the existing `@import "tailwindcss";`, add:

```css
/*
 * Tailwind v4 discovers classes by scanning outward from this file, and
 * packages/ui is outside that tree. Without this line every class used only
 * by a moved component is dropped from the stylesheet — the build succeeds,
 * the tests pass, and the app renders unstyled.
 */
@source "../../packages/ui/src";
```

The path is relative to `globals.css` at `src/app/`, so `../../` is the repository root. This line changes again in Task 4 when the file moves.

- [ ] **Step 5: Verify the types and tests**

Run: `npx tsc --noEmit`
Expected: silent.

Run: `npx vitest run`
Expected: **195 passed (20 files)**.

Run: `npm run build`
Expected: build completes.

- [ ] **Step 6: Verify the styles survived, because no test does**

This is the step people skip and regret. Build and serve, then look:

```bash
npm run build
npx next start -p 3001 &
sleep 8
curl -s http://localhost:3001/login | grep -c 'bg-neutral-950/70'
```
Expected: at least `1` — the login card's class is still emitted.

Then open `http://localhost:3001` in a browser and confirm the portfolio screen is
styled — a smoke check, nothing more. Kill the server when done:
```bash
kill %1
```

**`@source` cannot be isolated at this task.** The obvious test — grep the compiled
stylesheet for a class that only a moved component uses — has no discriminating power
here, because the build's cwd is still the repository root and Tailwind v4 auto-detects
sources from `process.cwd()`. `packages/ui` is already inside the scan base, so the
classes are emitted with or without the directive; a two-sided experiment at this task
confirmed the line is a no-op today. It becomes load-bearing in Task 4, when the build
moves into `apps/web` and the scan base narrows — and Task 4's Step 8 proves it there.
Add the line now anyway, so the move in Task 4 has nothing left to discover.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Extract the shared components into packages/ui

BackgroundAlerts and PwaSetup stay behind: one is alerts, which the
mobile build will not have, and the other registers a service worker,
which a native shell does not need.

The @source line is load-bearing. Tailwind v4 scans outward from the
CSS file and would otherwise drop every class used only by a moved
component — with a green build and a green test suite to go with it."
```

---

### Task 4: Move the app to `apps/web`

The last structural move, and the one with the most ways to go quietly wrong: the Prisma database path, the `.env` location, the Tailwind `@source` path, and `.gitignore` patterns anchored with a leading slash.

**Files:**
- Move: `src/`, `prisma/`, `public/`, `next.config.ts`, `postcss.config.mjs`, `middleware.ts`, `next-env.d.ts`, `.env`, `.env.example` → `apps/web/`
- Move (outside git): `prisma/dev.db` → `apps/web/prisma/dev.db`
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/eslint.config.mjs`
  (a one-line re-export of the root config — ESLint 9 does find the root config by
  searching ancestors, but resolves its `globalIgnores` patterns against the config
  file's own directory, so `.next/**` stops matching `apps/web/.next` and the linter
  walks the build output)
- Modify: root `package.json` (scripts delegate to the workspace; `prisma.schema` pointer)
- Modify: root `tsconfig.json` (becomes a solution file for tests only)
- Modify: `.gitignore`
- Modify: `apps/web/src/app/globals.css` (`@source` path)

**Interfaces:**
- Consumes: `packages/core`, `packages/ui` and the aliases from Tasks 2–3.
- Produces:
  - `apps/web/` as a complete, runnable Next application.
  - Root scripts `npm run dev`, `npm run build`, `npm run start`, `npm run lint` delegating to `apps/web`.
  - Root `npx vitest run` and `npx tsc --noEmit` still working from the repository root.

- [ ] **Step 1: Take a backup of the database first**

`prisma/dev.db` is gitignored, so git will not move it and git cannot restore it.

```bash
cp prisma/dev.db /tmp/contour-dev.db.bak
ls -la /tmp/contour-dev.db.bak
```
Expected: a file of roughly 307200 bytes.

- [ ] **Step 2: Move everything**

```bash
mkdir -p apps/web
git mv src apps/web/src
git mv prisma apps/web/prisma
git mv public apps/web/public
git mv next.config.ts apps/web/next.config.ts
git mv postcss.config.mjs apps/web/postcss.config.mjs
git mv next-env.d.ts apps/web/next-env.d.ts
git mv .env.example apps/web/.env.example
mv .env apps/web/.env
```

`src/middleware.ts` moved with `src/`, which is where Next expects it.

Confirm the database came along — `git mv prisma` moves tracked files only, so check explicitly:

```bash
ls -la apps/web/prisma/dev.db || cp /tmp/contour-dev.db.bak apps/web/prisma/dev.db
ls -la apps/web/prisma/dev.db
```
Expected: the file exists at roughly 307200 bytes. `DATABASE_URL="file:./dev.db"` is relative to the schema's directory, so it now points here and needs no edit.

- [ ] **Step 3: Give the app its own package and tsconfig**

Create `apps/web/package.json`:

```json
{
  "name": "@contour/web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint"
  }
}
```

Dependencies stay declared in the root `package.json` and hoist to the root `node_modules`, which both apps resolve. Splitting them per app is a Phase 4 concern, when `apps/mobile` needs Capacitor packages that `apps/web` must not have.

Create `apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/core/*": ["../../packages/core/src/*"],
      "@/ui/*": ["../../packages/ui/src/*"],
      "@/lib/*": ["../../packages/core/src/*", "./src/lib/*"],
      "@/components/*": ["../../packages/ui/src/*", "./src/components/*"],
      "@/*": ["./src/*"]
    }
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts"
  ],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Make the root tsconfig cover the packages only**

Replace the root `tsconfig.json` with:

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "paths": {
      "@/core/*": ["./packages/core/src/*"],
      "@/ui/*": ["./packages/ui/src/*"],
      "@/lib/*": ["./packages/core/src/*"],
      "@/components/*": ["./packages/ui/src/*"]
    }
  },
  "include": ["packages/**/*.ts", "packages/**/*.tsx", "scripts/**/*.ts", "**/*.mts"],
  "exclude": ["node_modules", "apps"]
}
```

This is what `npx tsc --noEmit` at the root now checks. The app is checked by its own config, invoked in Step 7.

- [ ] **Step 5: Fix the Tailwind source path and the gitignore**

In `apps/web/src/app/globals.css`, the `@source` line added in Task 3 is now three levels too shallow. Change it to:

```css
@source "../../../../packages/ui/src";
```

From `apps/web/src/app/`, four levels up is the repository root.

In `.gitignore`, the Next patterns are anchored to the root and no longer match. Replace:

```
/.next/
/out/
```

with:

```
.next/
out/
```

and confirm the ignore now covers the moved build directory:

```bash
git check-ignore -v apps/web/.next 2>/dev/null || echo "NOT IGNORED — fix .gitignore"
```
Expected: a line naming the `.next/` rule, not the error message.

- [ ] **Step 6: Delegate the root scripts**

In the root `package.json`, replace the `scripts` block with:

```json
  "scripts": {
    "dev": "npm run dev --workspace @contour/web",
    "build": "npm run build --workspace @contour/web",
    "start": "npm run start --workspace @contour/web",
    "lint": "npm run lint --workspace @contour/web",
    "test": "vitest run",
    "typecheck": "tsc --noEmit && tsc --noEmit -p apps/web",
    "android:sync": "npx cap sync android",
    "android:build": "cd android && ./gradlew assembleDebug"
  },
```

Also tell the Prisma CLI where the schema went, by adding a sibling of `"scripts"`:

```json
  "prisma": { "schema": "apps/web/prisma/schema.prisma" },
```

Without it every root-level `npx prisma generate|migrate|studio` looks for
`prisma/schema.prisma` under the cwd and no longer finds it. Worse, the *generated client*
bakes in the schema's absolute path and resolves `file:./dev.db` against it, so a client
generated before the move silently opens an empty database beside itself in
`node_modules/.prisma/client` and the app reports missing tables. Regenerate after adding
the pointer:

```bash
npx prisma generate
```

Then re-link the workspaces:

```bash
npm install
```
Expected: npm reports the workspace packages linked; no errors.

- [ ] **Step 7: Verify all four gates**

```bash
npx vitest run
```
Expected: **195 passed (20 files)**. The pinescript tests still resolve `samples/` because `samples/` stayed at the root and vitest runs from the root.

```bash
npx tsc --noEmit
npx tsc --noEmit -p apps/web
```
Expected: both silent.

```bash
npm run build
```
Expected: a successful build, writing to `apps/web/.next`.

```bash
npx prisma studio --schema apps/web/prisma/schema.prisma &
sleep 5
```
Open it and confirm your real portfolios are listed. If the tables are empty, the database did not move — restore it from `/tmp/contour-dev.db.bak` and re-check. Kill it when satisfied: `kill %1`.

- [ ] **Step 8: Verify the running app, then commit**

**Build first, then restart.** Rebuilding underneath a running `next start` leaves it serving the previous build from memory, which looks exactly like a broken deployment.

```bash
pkill -f "next start" || true
npm run build
(cd apps/web && npx next start -p 3001 &)
sleep 9
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/login
```
Expected: `200`. Start the server directly rather than through `npm run start -- -p 3001`
— the port argument is swallowed by the root script's second hop into the workspace and
arrives as a project directory.

Log in through a browser and confirm the portfolio screen shows your real holdings and is fully styled.

**Now prove the `@source` line, which becomes load-bearing exactly here.** Until this task
the build ran from the repository root, so Tailwind's auto-scan already covered
`packages/ui` and the directive changed nothing. The build now runs in `apps/web`, and
`packages/ui` falls outside that base. Test with two classes used by moved components and
by nothing else — `bg-yellow-500` (only `packages/ui/src/ComparisonChart.tsx`) and `h-14`
(only `packages/ui/src/TopNav.tsx`). Do not use `tabular-nums`: five pages that never
moved also use it, so it is emitted either way and proves nothing.

The stylesheet is a chunk, not a `/_next/static/css/` asset, so read its URL out of the
served HTML rather than guessing the path. Always build *before* restarting the server —
rebuilding underneath a running one leaves it serving the previous build from memory.

```bash
CSS=$(curl -s http://localhost:3001/login | grep -o '/_next/static/chunks/[^"]*\.css' | head -1)
curl -s "http://localhost:3001$CSS" | grep -o -E '\.bg-yellow-500|\.h-14' | sort -u | wc -l
```
Expected: `2` (count matches, not lines — the stylesheet is minified onto one line).
Then delete the `@source` line, rebuild, restart, and repeat: expected `0`. Restore the
line, rebuild, restart, repeat: expected `2` again. If the classes do not
disappear in the middle arm, `@source` is still a no-op and the finding should be reported
as such rather than papered over.

Then:

```bash
kill %1
git add -A
git commit -m "Move the web app into apps/web

Four things move with it that nothing in git tracks or checks: the
SQLite file beside its schema, .env into the app root where Next looks
for it, the Tailwind @source path now four levels from the stylesheet,
and .gitignore patterns that were anchored to a repository root the
build directory no longer sits in."
```

---

### Task 5: Document the new shape

The repository's guidance files describe a tree that no longer exists. `CLAUDE.md` carries a full architecture map with `src/app/...` paths, and every command in its table assumes the app is at the root.

**Files:**
- Modify: `CLAUDE.md` (architecture map, commands table, add a workspace section)
- Modify: `AGENTS.md` (if it repeats any path — check first)
- Modify: `README.md` (setup instructions)
- Modify: `.superdesign/design-system.md` (if it names component paths — check first)

**Interfaces:**
- Consumes: the finished layout from Task 4.
- Produces: documentation an engineer with no context can follow. Nothing imports this task.

- [ ] **Step 1: Find every stale path**

```bash
grep -rn "src/app\|src/lib\|src/components\|prisma/schema" \
  CLAUDE.md AGENTS.md README.md BRAND.md .superdesign/design-system.md 2>/dev/null
```
Record the list. Every hit is a path that has moved.

- [ ] **Step 2: Update the commands table in `CLAUDE.md`**

The commands change as follows. Update the table to match:

| Task | Command |
|---|---|
| Dev server | `npm run dev` (unchanged — delegates to the workspace) |
| Type-check | `npm run typecheck` (checks packages and the app) |
| Production build | `npm run build` |
| Tests | `npx vitest` from the repository root |
| Prisma migration | `npx prisma migrate dev --schema apps/web/prisma/schema.prisma --name <change>` |
| Regenerate Prisma client | `npx prisma generate --schema apps/web/prisma/schema.prisma` |
| Inspect DB | `npx prisma studio --schema apps/web/prisma/schema.prisma` |

The `--schema` flags are belt-and-braces: Task 4 added `"prisma": { "schema": ... }` to the
root `package.json`, so the bare commands find it too. Keep the flags in the table — they
are what makes the new location visible to a reader.

- [ ] **Step 3: Replace the architecture map in `CLAUDE.md`**

Rewrite the `src/` tree so its paths are real: `packages/core/src/...` for the indicator, portfolio maths, Delta parser and exporters; `packages/ui/src/...` for components; `apps/web/src/app/...` for pages and routes. Keep every existing explanatory comment — only the paths are wrong, not the descriptions.

- [ ] **Step 4: Add a workspace section to `CLAUDE.md`**

Insert after the architecture map:

```markdown
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
```

- [ ] **Step 5: Update `README.md` setup steps**

Any instruction to run `npx prisma migrate dev` or edit `.env` needs the new locations: the schema is at `apps/web/prisma/schema.prisma` and the environment file at `apps/web/.env`.

- [ ] **Step 6: Confirm no stale paths remain**

```bash
grep -rn "src/app\|src/lib\|src/components" \
  CLAUDE.md AGENTS.md README.md BRAND.md .superdesign/design-system.md 2>/dev/null \
  | grep -v "apps/web/src\|packages/"
```
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Point the guidance files at the tree that now exists

Every path in the architecture map moved and every Prisma command
needs --schema. The workspace section states the rule the boundary
test enforces, so the next person meets it as intent rather than as a
failing test they are tempted to edit."
```

---

## Phase 1 exit criteria

All five must hold before Phase 2 begins.

- [ ] `npx vitest run` → **195 passed (20 files)**
- [ ] `npm run typecheck` → silent
- [ ] `npm run build` → succeeds
- [ ] The app runs, logs in, and shows real portfolio data, fully styled
- [ ] `git grep -n 'from "@/lib/\|from "@/components/' -- 'apps/**' 'packages/**' | wc -l` returns the same count as before Phase 1 — proof that no import was rewritten

## What Phase 1 deliberately does not do

No `Store`, no `Net`, no `DataClient`, no services, no `apps/mobile`, no SQLite, no Capacitor changes. `capacitor.config.ts` and `android/` stay at the repository root, still pointing at `http://192.168.2.5:3001`, and still working exactly as they do today. They move in Phase 4.

Phase 2 gets its own plan, written once this one lands — its task boundaries depend on what the extracted packages actually look like.
