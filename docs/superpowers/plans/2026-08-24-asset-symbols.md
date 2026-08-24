# Store the Asset, Not the Pair — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `Transaction.symbol` name the asset (`ETH`), not a pricing pair (`ETHUSDT`), so the column stops contradicting the `nativeCurrency` beside it on 172 of 261 rows.

**Architecture:** Two pure helpers — `assetOf` and `pricingPair` — are introduced first and taught to every boundary that touches a symbol. That makes the whole app read *both* forms. Only then does the data move, so there is never a moment where the code and the database disagree. The migration is a separate, reversible task with its own verification.

**Tech Stack:** TypeScript, Vitest, Prisma 6 + SQLite, Next 16 App Router.

**Spec:** `docs/superpowers/specs/2026-08-24-asset-symbols-design.md`

## Global Constraints

- **Tolerance before migration.** Tasks 1–4 must leave the app working against the *current* database, unmigrated. Task 5 moves the data. A reviewer who cannot run the app after any task has found a bug.
- `Alert.symbol` keeps its pair. Decision 1 in the spec: those alerts fetch Binance klines and a pair is what they address. Do not migrate the `Alert` table.
- Both `/portfolio/ETH` and `/portfolio/ETHUSDT` must resolve. Decision 2.
- Quote assets recognised today, in `packages/ui/src/CoinIcon.tsx`: `USDT, FDUSD, BUSD, USDC, TUSD, BTC, ETH, BNB, EUR, TRY`. This list is the authority; do not write a second one.
- `packages/core` imports no Prisma, no `node:*`, no `next/*`, and calls no global `fetch`. `packages/core/src/boundary.test.ts` enforces it.
- Run `npm run typecheck` (both projects), never bare `npx tsc --noEmit`.
- `npm run lint` exits non-zero with **exactly 21** pre-existing errors. More means this work added some.
- Never run destructive tests against `apps/web/prisma/dev.db`. Copy it.

---

### Task 1: The two helpers

**Files:**
- Create: `packages/core/src/symbols.ts`
- Test: `packages/core/src/symbols.test.ts`

**Interfaces:**
- Produces:
  - `assetOf(symbol: string): string` — `"ETHUSDT" -> "ETH"`, `"ETH" -> "ETH"`, `"ASML.AS" -> "ASML.AS"`
  - `pricingPair(asset: string): string` — `"ETH" -> "ETHUSDT"`, `"ETHUSDT" -> "ETHUSDT"`
  - `QUOTE_ASSETS: readonly string[]`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { assetOf, pricingPair } from "./symbols";

describe("assetOf", () => {
  it("strips a known quote asset", () => {
    expect(assetOf("ETHUSDT")).toBe("ETH");
    expect(assetOf("IOTAETH")).toBe("IOTA");
  });

  it("leaves a bare asset alone, so it can run twice", () => {
    // The migration and the readers both call this; it must be idempotent or
    // a second pass would eat real characters.
    expect(assetOf("ETH")).toBe("ETH");
    expect(assetOf(assetOf("ETHUSDT"))).toBe("ETH");
  });

  it("leaves an equity ticker alone", () => {
    expect(assetOf("ASML.AS")).toBe("ASML.AS");
    expect(assetOf("AMD")).toBe("AMD");
  });

  it("does not eat a symbol that is only its own quote asset", () => {
    // USDT ends with USDT. Stripping would leave nothing.
    expect(assetOf("USDT")).toBe("USDT");
    expect(assetOf("ETH")).toBe("ETH");
  });

  it("is case-insensitive on input and upper on output", () => {
    expect(assetOf("ethusdt")).toBe("ETH");
  });
});

describe("pricingPair", () => {
  it("appends the quote Binance prices in", () => {
    expect(pricingPair("ETH")).toBe("ETHUSDT");
  });

  it("leaves a symbol that is already a pair alone", () => {
    // Callers hand it whatever the database holds, migrated or not.
    expect(pricingPair("ETHUSDT")).toBe("ETHUSDT");
  });

  it("does not double-suffix USDT itself", () => {
    // Tether is unpriceable either way — Binance has no USDT ticker — so this
    // only has to avoid inventing one. The holding reads "no price", as it
    // does today under USDTUSDT.
    expect(pricingPair("USDT")).toBe("USDT");
  });

  it("is nonsense on an equity, which is why callers must not hand it one", () => {
    // Documented rather than defended: the function cannot tell AMD from a
    // coin, and a guard here would hide the caller's bug instead of the
    // caller splitting equities off as valuation and series both do.
    expect(pricingPair("AMD")).toBe("AMDUSDT");
    expect(pricingPair("ASML.AS")).toBe("ASML.ASUSDT");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/core/src/symbols.test.ts`
Expected: FAIL, cannot find module `./symbols`.

- [ ] **Step 3: Implement**

```ts
/**
 * The two directions between what a person owns and what a venue prices.
 *
 * `Transaction.symbol` records the asset — `ETH`, `ASML.AS`. Binance prices
 * pairs — `ETHUSDT`. Those are different facts, and conflating them is what
 * this module exists to stop: 172 of 261 crypto rows once carried a `USDT`
 * suffix that contradicted the `nativeCurrency` beside them.
 *
 * Both functions are idempotent, deliberately. They run over a database that
 * is half-migrated during Task 5 and over user input that may be either form,
 * so applying one twice must not change the answer.
 */

/**
 * Quote assets, longest first so `FDUSD` is matched before `USD` would be.
 *
 * Kept in step with `QUOTE_ASSETS` in `packages/ui/src/CoinIcon.tsx`, which is
 * the older copy and the one the icons use. `symbols.test.ts` asserts the two
 * agree rather than trusting a comment to keep them together.
 */
export const QUOTE_ASSETS = [
  "FDUSD", "USDT", "USDC", "BUSD", "TUSD", "BNB", "BTC", "ETH", "EUR", "TRY",
] as const;

/** What is owned: `ETHUSDT` -> `ETH`, `ETH` -> `ETH`, `ASML.AS` -> `ASML.AS`. */
export function assetOf(symbol: string): string {
  const s = symbol.toUpperCase();
  for (const q of QUOTE_ASSETS) {
    // `s.length > q.length` is what stops USDT becoming the empty string.
    if (s.endsWith(q) && s.length > q.length) return s.slice(0, -q.length);
  }
  return s;
}

/**
 * What Binance prices: `ETH` -> `ETHUSDT`, and a pair passed straight through.
 *
 * **Crypto only.** It has no way to recognise an equity, so `pricingPair`
 * would happily answer `AMDUSDT` for AMD and `ASML.ASUSDT` for ASML — neither
 * exists, and both would silently price a holding at nothing. Every caller
 * must have split equities off first; `valuation` does it with `equitySymbols`
 * and `series` inside `if (!equitySymbols.has(s))`.
 */
export function pricingPair(asset: string): string {
  const s = asset.toUpperCase();
  return assetOf(s) === s && s !== "USDT" ? `${s}USDT` : s;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run packages/core/src/symbols.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Pin the two quote lists together**

Add to `packages/core/src/symbols.test.ts`:

```ts
import { readFileSync } from "node:fs";

it("agrees with CoinIcon's quote list, which predates this one", () => {
  // Two lists that must match, in packages that cannot import each other
  // (core must not depend on ui). Read the source rather than let them drift.
  const src = readFileSync("packages/ui/src/CoinIcon.tsx", "utf8");
  const found = src.match(/const QUOTE_ASSETS = \[([^\]]*)\]/);
  if (!found) throw new Error("CoinIcon no longer declares QUOTE_ASSETS");
  const theirs = [...found[1]!.matchAll(/"([A-Z]+)"/g)].map((m) => m[1]!);
  expect([...QUOTE_ASSETS].sort()).toEqual(theirs.sort());
});
```

- [ ] **Step 6: Run and commit**

Run: `npx vitest run packages/core/src/symbols.test.ts && npx vitest run packages/core/src/boundary.test.ts`

```bash
git add packages/core/src/symbols.ts packages/core/src/symbols.test.ts
git commit -m "Name the two directions between an asset and a pricing pair"
```

---

### Task 2: Price by pair, hold by asset

**Files:**
- Modify: `packages/data/src/services/valuation.ts:92-99`
- Modify: `packages/data/src/services/pricing.ts` (`fetchCryptoPrevCloses`)
- Modify: `packages/data/src/services/series.ts` (the `fetchKlinesRange` call)
- Test: `packages/data/src/services/valuation.test.ts`

**Interfaces:**
- Consumes: `assetOf`, `pricingPair` from Task 1.
- Produces: nothing new. Valuation keys holdings by whatever the store returns and asks Binance for `pricingPair(symbol)`.

The rule: **a symbol is asked for by pair and reported by asset.** Prices come back keyed on the pair, so they must be mapped home.

- [ ] **Step 1: Write the failing test**

```ts
it("prices a bare asset by its pair", async () => {
  // The store holds ETH; Binance only knows ETHUSDT.
  const store = MemoryStore({
    settings: { displayCurrency: "USD" },
    portfolios: [{ id: "p1", name: "Main", transactions: [
      tx({ symbol: "ETH", quantity: 2, price: 1000 }),
    ] }],
  });
  const net = FakeNet({
    "api.binance.com/api/v3/ticker/price": (url: string) => {
      const asked = JSON.parse(new URL(url).searchParams.get("symbols")!) as string[];
      expect(asked).toContain("ETHUSDT");
      return [{ symbol: "ETHUSDT", price: "3000" }];
    },
    "api.binance.com/api/v3/klines": [],
  });
  const out = await valuation(store, net, "p1");
  const eth = out.holdings.find((h) => h.symbol === "ETH");
  expect(eth?.value).toBe(6000);
});

it("still prices a stored pair, because the database has not moved yet", async () => {
  const store = MemoryStore({
    settings: { displayCurrency: "USD" },
    portfolios: [{ id: "p1", name: "Main", transactions: [
      tx({ symbol: "ETHUSDT", quantity: 2, price: 1000 }),
    ] }],
  });
  const net = FakeNet({
    "api.binance.com/api/v3/ticker/price": [{ symbol: "ETHUSDT", price: "3000" }],
    "api.binance.com/api/v3/klines": [],
  });
  const out = await valuation(store, net, "p1");
  expect(out.holdings.find((h) => h.symbol === "ETHUSDT")?.value).toBe(6000);
});
```

- [ ] **Step 2: Run and watch the first fail**

Run: `npx vitest run packages/data/src/services/valuation.test.ts`
Expected: the bare-asset case FAILS — Binance is asked for `ETH` and answers nothing, so the value is null.

- [ ] **Step 3: Implement in `valuation.ts`**

Replace the price fetch and lookup:

```ts
  const cryptoSymbols = held.filter((s) => !equitySymbols.has(s));
  // Asked for by pair, reported by asset: the store may hold either form
  // while Task 5 is pending, and Binance only knows the pair.
  const pairOf = new Map(cryptoSymbols.map((s) => [s, pricingPair(s)]));

  const [cryptoPrices, equityPrices, cryptoPrev] = await Promise.all([
    fetchPricesSafe(net, [...pairOf.values()]),
    fetchEquityPricesUsd(net, heldEquities, equityProvider, equityApiKey),
    fetchCryptoPrevCloses(net, [...pairOf.values()]),
  ]);
```

and map the results back onto the held symbol:

```ts
  for (const [symbol, pair] of pairOf) {
    const usd = cryptoPrices[pair];
    if (usd !== undefined) prices[symbol] = usd * toDisplay;
    const prev = cryptoPrev[pair];
    if (prev !== undefined) prevCloses[symbol] = prev * toDisplay;
  }
```

Delete the two loops that previously copied `cryptoPrices` and `cryptoPrev` straight across.

- [ ] **Step 4: Do the same in `series.ts`**

The history call takes one symbol at a time:

```ts
        return barMs === DAY_MS
          ? fetchKlinesRange(net, { symbol: pricingPair(s), interval: "1d", from, to: Date.now() })
          : cached(`h1:${pricingPair(s)}:${Math.floor(Date.now() / 300_000)}`, 300_000, () =>
              fetchKlines(net, { symbol: pricingPair(s), interval: "1h", limit: 26 }),
            );
```

Do the same for the `changes()` function lower in the file, which calls `fetchKlines` and `fetchKlinesRange` with a raw symbol.

- [ ] **Step 5: Run and watch both pass**

Run: `npx vitest run packages/data && npm run typecheck`
Expected: PASS. Both forms price.

- [ ] **Step 6: Commit**

```bash
git add packages/data/src/services
git commit -m "Ask Binance for the pair, report the holding by its asset"
```

---

### Task 3: Both URLs, one asset

**Files:**
- Modify: `apps/web/src/app/portfolio/[symbol]/page.tsx`
- Modify: `apps/web/src/app/api/history/route.ts`
- Modify: `apps/web/src/app/markets/page.tsx` (the row link)

**Interfaces:**
- Consumes: `assetOf`, `pricingPair`.

- [ ] **Step 1: Resolve the route parameter to an asset**

In `apps/web/src/app/portfolio/[symbol]/page.tsx`, where `symbol` is derived:

```ts
  // Both forms resolve, per the spec's second decision: `/portfolio/ETH` is
  // the honest URL and `/portfolio/ETHUSDT` is every link and bookmark that
  // predates the migration.
  const symbol = assetOf(decodeURIComponent(raw));
```

- [ ] **Step 2: Link Markets rows by asset**

`r.pair ?? r.symbol` becomes `r.symbol`, because the asset page now resolves a bare asset and prices it itself. Keep `?type=`.

- [ ] **Step 3: Make the history route tolerant, crypto only**

`/api/history` takes `symbol` and `assetType` from the client. Only the crypto
branch may be wrapped — `pricingPair("ASML.AS")` answers `ASML.ASUSDT`, which
does not exist and would price the holding at nothing:

```ts
const wanted = assetType === "crypto" ? pricingPair(symbol) : symbol;
```

Add a test asserting an equity request reaches the provider unchanged:

```ts
it("does not build a pair for an equity", async () => {
  const net = FakeNet({
    "query1.finance.yahoo.com/v8/finance/chart/ASML.AS": yahooChart([{ t: 1, c: 600 }]),
  });
  // FakeNet throws on an unmatched URL, so ASML.ASUSDT fails this outright.
  await expect(history(net, "ASML.AS", "equity", "1y")).resolves.toBeDefined();
});
```

- [ ] **Step 4: Verify by hand, both forms**

```bash
npm run build && cd apps/web && npx next start -p 3001 &
```

Visit `/portfolio/ETHUSDT` and `/portfolio/ETH`. Both must show the same holding, the same chart and the same trade list. This is the check that the migration will not break a bookmark.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app
git commit -m "Resolve an asset page from either an asset or a pair"
```

---

### Task 4: Stop the importer inventing a pair

**Files:**
- Modify: `packages/core/src/delta-csv.ts:279`
- Test: `packages/core/src/delta-csv.test.ts`

**Interfaces:**
- Consumes: nothing. The importer already parses `Base currency` and `Quote currency` into separate fields.

- [ ] **Step 1: Write the failing test**

```ts
it("records the asset bought, not a pair it made up", () => {
  // Delta gives base and quote in their own columns. The importer used to
  // append a constant "USDT" regardless of what the quote column said.
  const csv = HEADER + "\n2024-01-15,BUY,Binance,1,ETH,2000,EUR,0,EUR,,,";
  const { rows } = parseDeltaCsv(csv);
  expect(rows[0]!.symbol).toBe("ETH");
  expect(rows[0]!.nativeCurrency).toBe("EUR");
});

it("records a coin bought with another coin", () => {
  // 52 rows in the live ledger are this shape, and none of them could say so.
  const csv = HEADER + "\n2024-01-15,BUY,Binance,100,IOTA,0.5,ETH,0,ETH,,,";
  const { rows } = parseDeltaCsv(csv);
  expect(rows[0]!.symbol).toBe("IOTA");
  expect(rows[0]!.nativeCurrency).toBe("ETH");
});

it("leaves an equity ticker alone", () => {
  const csv = HEADER + "\n2024-01-15,BUY,Euronext,10,ASML.AS,6000,EUR,0,EUR,,,";
  const { rows } = parseDeltaCsv(csv);
  expect(rows[0]!.symbol).toBe("ASML.AS");
});
```

- [ ] **Step 2: Run and watch the first two fail**

Run: `npx vitest run packages/core/src/delta-csv.test.ts`
Expected: FAIL — symbol is `ETHUSDT` and `IOTAUSDT`.

- [ ] **Step 3: Delete the concatenation**

```ts
      // The base currency IS the asset. This used to append "USDT" for every
      // crypto row, contradicting the quote currency parsed six lines above
      // and producing 172 rows whose symbol disagreed with their own
      // nativeCurrency.
      symbol: baseCurrency,
```

- [ ] **Step 4: Run and watch them pass**

Run: `npx vitest run packages/core`

- [ ] **Step 5: Check the sample import still reconciles**

Run the importer against `samples/` if a fixture exists, or re-run the whole suite. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/delta-csv.ts packages/core/src/delta-csv.test.ts
git commit -m "Import the asset the file names, not a pair with a constant glued on"
```

---

### Task 5: Move the data

**Files:**
- Create: `scripts/migrate-symbols.mjs`

**Interfaces:**
- Consumes: `assetOf` from Task 1, imported through the same tsconfig alias the app uses, or reimplemented in the script if the script cannot resolve it — **prefer importing**; two copies of this rule is exactly the bug being fixed.

This task moves live data. It runs against a copy first, always.

- [ ] **Step 1: Back up**

```bash
cd apps/web && cp prisma/dev.db "prisma/dev.db.before-symbols-$(date +%Y%m%d)"
```

Also take a JSON backup through the app's own export, which is the format a restore reads.

- [ ] **Step 2: Write the script**

```js
/**
 * Rewrite crypto symbols from pricing pairs to assets.
 *
 * Idempotent: `assetOf` leaves a bare asset alone, so a second run is a no-op.
 * Refuses to run if two symbols would collide into one — merging positions may
 * well be correct, but it must be a decision somebody makes, not a side effect
 * of a rename.
 */
import { PrismaClient } from "@prisma/client";
import { assetOf } from "../packages/core/src/symbols.ts";

const prisma = new PrismaClient();
const rows = await prisma.transaction.findMany({ where: { assetType: "crypto" } });

const moves = new Map();
for (const r of rows) {
  const to = assetOf(r.symbol);
  if (to !== r.symbol) moves.set(r.symbol, to);
}

// Collision check: two different pairs landing on one asset.
const landing = new Map();
for (const [from, to] of moves) {
  if (landing.has(to)) {
    console.error(`REFUSING: ${from} and ${landing.get(to)} both become ${to}.`);
    process.exit(1);
  }
  landing.set(to, from);
}

console.log(`${rows.length} crypto rows, ${moves.size} symbols to rename:`);
for (const [from, to] of moves) console.log(`  ${from} -> ${to}`);

if (process.argv.includes("--apply")) {
  for (const [from, to] of moves) {
    const { count } = await prisma.transaction.updateMany({
      where: { assetType: "crypto", symbol: from },
      data: { symbol: to },
    });
    console.log(`  ${from} -> ${to}: ${count} rows`);
  }
} else {
  console.log("\nDry run. Pass --apply to write.");
}
await prisma.$disconnect();
```

- [ ] **Step 3: Prove the rename is safe on this data**

Run `assetOf` over the live symbol list and assert two properties: applying it
twice changes nothing, and no two symbols land on the same asset. Checked on
2026-08-24 against all 23 — clean — but the script must assert it rather than
trust that check, because the ledger grows.

One to expect: `USDTUSDT -> USDT`. Tether is unpriceable under either name
(Binance has no `USDT` ticker) and already shows "no price" in the holdings
list. The rename does not change that.

- [ ] **Step 4: Dry-run against a copy**

```bash
cp apps/web/prisma/dev.db /tmp/symbols-test.db
DATABASE_URL="file:/tmp/symbols-test.db" npx tsx scripts/migrate-symbols.mjs
```

Expected: 261 crypto rows, 23 renames listed, no collision, nothing written.

- [ ] **Step 5: Apply to the copy and check the figures did not move**

```bash
DATABASE_URL="file:/tmp/symbols-test.db" npx tsx scripts/migrate-symbols.mjs --apply
```

Then run the app against the copy and compare the portfolio total, cost basis and realised P&L against the live figures. **They must be identical** — this rename changes a label, not arithmetic. A difference means a pricing lookup is still keyed on the old form.

- [ ] **Step 6: Apply to the real database**

Only after Step 5 matches.

```bash
cd apps/web && npx tsx ../../scripts/migrate-symbols.mjs --apply
```

- [ ] **Step 7: Verify and commit the script**

```bash
sqlite3 apps/web/prisma/dev.db "SELECT DISTINCT symbol FROM \"Transaction\" WHERE assetType='crypto' ORDER BY symbol;"
```

Expected: 23 bare assets, none ending in `USDT`.

```bash
git add scripts/migrate-symbols.mjs
git commit -m "Rename stored crypto symbols from pairs to assets"
```

---

### Task 6: Close the door behind it

**Files:**
- Modify: `packages/core/src/boundary.test.ts`
- Modify: `CLAUDE.md`, `BRAND.md`, `docs/carried-forward.md`

- [ ] **Step 1: Guard against the suffix coming back**

```ts
it("never glues a quote asset onto a stored symbol", () => {
  // The importer did this for years. `pricingPair` is the only place allowed
  // to build a pair, and it does it for a request, never for a row.
  const offenders = sourceFiles.filter((f) =>
    /`\$\{[^}]+\}USDT`|\+ "USDT"/.test(readFileSync(f, "utf8")) &&
    !f.endsWith("symbols.ts"),
  );
  expect(offenders).toEqual([]);
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run packages/core/src/boundary.test.ts`
Expected: PASS after Task 4; it would have failed before.

- [ ] **Step 3: Update the guides**

`CLAUDE.md`: the conventions section gains one line — *a stored symbol is an asset; `pricingPair()` builds a pair for a request and nothing stores the result.* Note that `Alert.symbol` is the documented exception.

`docs/carried-forward.md`: move the "Designed, not built" entry into "Resolved since the ledgers were written", with the migration date and the row count.

- [ ] **Step 4: Full verification**

```bash
npm run typecheck && npx vitest run && npm run lint
```

Expected: typecheck clean, all tests pass, lint exits non-zero with **exactly 21** errors.

- [ ] **Step 5: Browser pass**

Portfolio totals unchanged. `/portfolio/ETH` and `/portfolio/ETHUSDT` both resolve. The asset page charts. Markets rows still open. The two `BTCUSDT` alerts still evaluate — run `/api/cron/evaluate` and check the summary lists them.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Stop a pricing pair being stored as an asset again"
```
