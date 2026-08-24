# Asset Actions: Sheet, Native Currency, Quote Picker, Prefill

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a transaction from a bottom sheet on any asset page, choosing which currency the price is in, with the current price one tap away — and store that currency instead of silently calling it USD.

**Architecture:** A `Sheet` primitive is extracted from `MoreMenu` first, because it changes no data and nothing else depends on it. Then the native-currency path is built end to end in one group — the input type, the route, the service conversion, the picker and the prefill — because shipping any part of it alone records wrong numbers. Conversion happens in the service, on the trade's date, reusing the classification the importer already has.

**Tech Stack:** TypeScript, React 19, Next 16 App Router, Tailwind v4, Vitest, Prisma 6 + SQLite, Zod.

**Spec:** `docs/superpowers/specs/2026-08-24-asset-actions-design.md`

**Scope:** This plan covers sequencing groups 1 and 2 only — spec §1, §2, §3, §4. Group 3 (§6, cash and income, with a migration) and group 4 (§5, alerts and the evaluator) get their own plans once this lands.

## Global Constraints

- **The app must be correct after every task**, not only after the last. A form that submits `nativeCurrency` to a service that ignores it silently records the wrong number — so Tasks 3–7 land together or not at all.
- **Never run destructive tests against `apps/web/prisma/dev.db`.** Copy it: `cp apps/web/prisma/dev.db /tmp/<name>.db` and point a second server at it with `DATABASE_URL="file:/tmp/<name>.db" npx next start -p 3002`.
- `npm run lint` exits non-zero with **exactly 21** pre-existing errors. 22 means this work added one.
- Run `npm run typecheck` (both projects), never bare `npx tsc --noEmit`.
- `packages/core` imports no Prisma, no `node:*`, no `next/*`, and calls no global `fetch` — `packages/core/src/boundary.test.ts` enforces it.
- A screen never names a route. `apps/web/src/screen-boundary.test.ts` enforces it; the asset page is a converted screen and stays converted.
- **No fourth currency list.** `FIAT` (`transfer.ts`), `STABLES` and `FIAT_CURRENCIES` (`delta-csv.ts`) already overlap. Task 3 moves them; nothing adds another.
- **Rates are taken on the trade's date, never today's.**
- BRAND.md is the authority for anything user-facing. Nothing below 11px; `text-green-500`/`text-red-500`, never `emerald`.
- `FakeNet` resolves the **longest matching key first** — a specific override must be a longer string than the general route.
- Suites touching `sources/` must call `invalidate()` from `@/core/cache` in `beforeEach`, or a neighbouring test's scripted response answers first.

---

### Task 1: The `Sheet` primitive

**Files:**
- Create: `packages/ui/src/Sheet.tsx`
- Test: `packages/ui/src/Sheet.test.tsx`

**Interfaces:**
- Produces: `Sheet({ open, onClose, title, children })` — a bottom sheet at every width.

> **On testing this one.** `Sheet` is entirely DOM behaviour — Escape, the
> scrim, the scroll lock, focus. This repo has **no component tests at all**:
> `@testing-library/react` is not installed and Vitest has no `jsdom`
> environment. Adding both is a real change to how this project tests, worth
> deciding on its own merits rather than smuggling in under a feature. It is
> **not** part of this plan.
>
> So `Sheet` is verified by hand, against the checklist in Step 4, and the
> load-bearing *logic* elsewhere in this plan is extracted into pure functions
> that plain Vitest can reach — see Task 7. If you want the DOM harness, add it
> as its own piece of work first and come back; the tests are worth having and
> this file is the obvious first customer.

- [ ] **Step 1: Implement**

```tsx
// packages/ui/src/Sheet.tsx
"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

/**
 * A panel that rises from the bottom of the screen.
 *
 * Extracted from `MoreMenu`, which had these mechanics welded to its own
 * contents: the scrim, Escape, focus capture, the scroll lock and the
 * safe-area padding are the same for any sheet, and copying them into a
 * second one is how two sheets start behaving differently.
 *
 * One presentation at every width. `MoreMenu` also has a desktop dropdown
 * because it hangs off a button in the nav bar and can be anchored to it; a
 * form sheet has no anchor, and a second desktop treatment would be a design
 * decision nobody asked for.
 */
export default function Sheet({
  open, onClose, title, children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Escape closes from anywhere, including from inside the panel, which is
  // where a keyboard user is after tabbing into it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // The sheet covers the page; letting the page scroll behind it is the
  // classic phone bug where the list moves under your finger.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Move focus into the panel so the first Tab lands inside it rather than
  // back at the top of the page behind it.
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>("input, select, button, a")?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      {/* A button rather than a div so the dismiss gesture is reachable from a
          keyboard instead of being mouse-only. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-[1px]"
      />
      <div
        ref={panel}
        // 4rem clears the tab bar, which stays lit beneath the sheet; the
        // inset clears the home indicator under that.
        className="absolute inset-x-0 bottom-0 md:left-1/2 md:-translate-x-1/2 md:max-w-lg
                   rounded-t-2xl border-t border-neutral-800 bg-neutral-950
                   pb-[calc(env(safe-area-inset-bottom)+4rem)]
                   max-h-[80vh] overflow-y-auto
                   motion-safe:animate-[more-up_.16s_ease-out]"
      >
        <div className="flex items-center justify-between px-4 pt-3">
          <h2 id={titleId} className="text-sm font-semibold uppercase tracking-widest text-neutral-500">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title}`}
            className="p-1 -mr-1 text-neutral-500"
          >
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="p-3">{children}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Make `MoreMenu` a consumer**

In `packages/ui/src/MoreMenu.tsx`, replace the whole `return (...)` block after the dropdown branch — the one beginning `<div className="md:hidden fixed inset-0 z-40" role="dialog"` — with:

```tsx
  return (
    <div className="md:hidden">
      <Sheet open={open} onClose={onClose} title="More">{list}</Sheet>
    </div>
  );
```

Add `import Sheet from "./Sheet";` beside the other local imports. Delete the now-unused body-scroll-lock effect and the sheet-only `pointerdown` guard's `variant !== "dropdown"` twin — **keep** the Escape effect and the focus effect only if the dropdown branch still needs them; the dropdown does need Escape, so that one stays.

`list` is already wrapped in `<div className="p-3 space-y-4">` and `Sheet` now adds its own `p-3`. Remove the padding from `list`'s wrapper so it is not applied twice.

- [ ] **Step 3: Verify the menu still behaves**

Run: `npm run build && cd apps/web && npx next start -p 3001`

On a phone-width viewport open the More sheet from the tab bar. Check: it rises, the tab bar stays visible beneath it, Escape closes it, a tap on the scrim closes it, and the page behind does not scroll while it is open. On a desktop width, More is still a dropdown.

- [ ] **Step 4: Verify the sheet's own behaviour, by hand**

On a phone-width viewport, with the More sheet open, check every one of these — they are the mechanics the extraction could silently drop:

| Check | Why it is on this list |
|---|---|
| Escape closes it, including after tabbing into the panel | The listener is on `document`, not the panel |
| A tap on the scrim closes it | The scrim is a `<button>` so this also works from a keyboard |
| The page behind does not scroll while it is open | The classic phone bug: the list moves under your finger |
| The page scrolls again after it closes | The classic follow-on bug: the lock is never released |
| The first Tab lands inside the panel | Focus is moved on open |
| The tab bar stays visible and lit beneath it | `pb-[calc(env(safe-area-inset-bottom)+4rem)]` |
| It rises rather than appearing | `motion-safe:animate-[more-up_.16s_ease-out]` |

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/Sheet.tsx packages/ui/src/MoreMenu.tsx
git commit -m "Extract the sheet from the menu that happened to be the first one"
```

---

### Task 2: Add-transaction moves into the sheet

**Files:**
- Modify: `apps/web/src/app/portfolio/[symbol]/page.tsx`
- Modify: `apps/web/src/app/portfolio/page.tsx`

**Interfaces:**
- Consumes: `Sheet` from Task 1.
- Produces: nothing new — the same `TxForm` in a different container.

- [ ] **Step 1: Move the asset page's form into a sheet**

In `apps/web/src/app/portfolio/[symbol]/page.tsx`, the form currently renders inline:

```tsx
            {addOpen && (
              <TxForm onSubmit={addTransaction} error={formError} lockedSymbol={symbol}
                      livePrice={shownHolding?.price ?? lastClose} />
            )}
```

Replace with:

```tsx
            <Sheet open={addOpen} onClose={() => setAddOpen(false)} title="Add a transaction">
              <TxForm onSubmit={addTransaction} error={formError} lockedSymbol={symbol}
                      livePrice={shownHolding?.price ?? lastClose} />
            </Sheet>
```

The button that toggles `addOpen` keeps its `{addOpen ? "Close" : "Add"}` label — the sheet has its own close control, but the button is what a returning finger reaches for.

Add `import Sheet from "@/components/Sheet";` (the `@/components/*` alias resolves to `packages/ui/src`).

- [ ] **Step 2: The empty state must not depend on the sheet**

The unheld branch currently reads:

```tsx
            {notHeld
              ? !addOpen && (
                  <EmptyState>
                    You hold none of this. Add a transaction to start tracking it here.
                  </EmptyState>
                )
              : <TransactionTable txs={txs} onDelete={deleteTx} />}
```

The `!addOpen &&` existed because the inline form pushed the empty state down the page. A sheet covers it instead, so drop the condition:

```tsx
            {notHeld
              ? <EmptyState>
                  You hold none of this. Add a transaction to start tracking it here.
                </EmptyState>
              : <TransactionTable txs={txs} onDelete={deleteTx} />}
```

- [ ] **Step 3: Do the same on the portfolio page**

`apps/web/src/app/portfolio/page.tsx:355` renders `<TxForm onSubmit={addTransaction} error={formError} />`. Wrap it in the same `Sheet` with title `"Add a transaction"`, driven by whatever state already toggles it on that screen. Read the surrounding lines first — if that form is not behind a toggle, add one matching the asset page's button rather than leaving a sheet permanently open.

- [ ] **Step 4: Verify by hand, both screens**

Run: `npm run build && cd apps/web && npx next start -p 3001`

Open `/portfolio/ETH`, tap Add: the sheet rises, the form is usable, adding a transaction closes it and the table updates. Open a coin you do not hold from Markets: the empty state is visible behind the sheet and the form still works.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/portfolio
git commit -m "Raise the transaction form from the bottom instead of pushing the page down"
```

---

### Task 3: One home for the currency classification

**Files:**
- Create: `packages/core/src/currencies.ts`
- Modify: `packages/core/src/delta-csv.ts:36-38`
- Modify: `packages/data/src/services/transfer.ts:27`
- Test: `packages/core/src/currencies.test.ts`

**Interfaces:**
- Produces:
  - `FIAT: ReadonlySet<string>` — currencies with an ECB reference rate
  - `STABLES: ReadonlySet<string>` — quotes already worth one USD
  - `needsRate(currency: string): boolean` — false for USD and stables

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/currencies.test.ts
import { describe, expect, it } from "vitest";
import { FIAT, STABLES, needsRate } from "./currencies";

describe("needsRate", () => {
  it("is false for USD and for the stables that track it", () => {
    // A USDT price is already a USD price; asking Binance for USDTUSDT would
    // fetch a market that does not exist to learn something already known.
    for (const c of ["USD", "USDT", "USDC", "FDUSD", "BUSD", "TUSD", "DAI"]) {
      expect(needsRate(c)).toBe(false);
    }
  });

  it("is true for a fiat currency and for a coin quote", () => {
    for (const c of ["EUR", "GBP", "CHF", "BTC", "ETH", "BNB"]) {
      expect(needsRate(c)).toBe(true);
    }
  });

  it("is case-insensitive, because a CSV column is not", () => {
    expect(needsRate("usdt")).toBe(false);
    expect(needsRate("eur")).toBe(true);
  });
});

describe("the sets themselves", () => {
  it("keeps every stable out of FIAT and vice versa", () => {
    // They answer different questions — "has an ECB rate" and "is already a
    // dollar" — and a currency in both would be looked up twice, differently.
    for (const c of STABLES) expect(FIAT.has(c)).toBe(false);
  });

  it("covers the currencies the ledger actually contains", () => {
    // From the live ledger, 2026-08-24. A currency here that is in neither set
    // silently prices at zero on import.
    for (const c of ["EUR", "USD", "USDT", "ETH", "BTC"]) {
      expect(needsRate(c) || STABLES.has(c) || c === "USD").toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/core/src/currencies.test.ts`
Expected: FAIL, cannot find module `./currencies`.

- [ ] **Step 3: Implement**

```ts
// packages/core/src/currencies.ts
/**
 * What a currency is, for the purpose of turning a price into USD.
 *
 * Two questions, and only two: does this already equal a dollar, and if not,
 * where does the rate come from. Three overlapping copies of the answer used
 * to live in `delta-csv.ts` and `transfer.ts`; the importer and the manual
 * entry form now read the same one, because a trade typed by hand and the
 * same trade imported must price identically.
 */

/** Quotes already worth one USD, so a price in them is already a USD price. */
export const STABLES: ReadonlySet<string> = new Set([
  "USD", "USDT", "USDC", "BUSD", "DAI", "FDUSD", "TUSD",
]);

/** Currencies the ECB publishes a reference rate for. */
export const FIAT: ReadonlySet<string> = new Set([
  "EUR", "GBP", "CHF", "JPY", "AUD", "CAD", "SEK", "NOK", "DKK", "PLN",
]);

/**
 * True when a figure in this currency has to be converted before the rest of
 * the app can treat it as dollars.
 *
 * A coin quote (BTC, ETH) answers true and is not in `FIAT`: its rate comes
 * from Binance rather than the ECB, and the caller decides which to ask.
 */
export function needsRate(currency: string): boolean {
  return !STABLES.has(currency.toUpperCase());
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run packages/core/src/currencies.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Point the two existing copies at it**

In `packages/core/src/delta-csv.ts`, delete the local `STABLES` (line 36) and `FIAT_CURRENCIES` (line 38) declarations and import instead:

```ts
import { FIAT, STABLES } from "./currencies";
```

`FIAT_CURRENCIES` is used at line 198 (`FIAT_CURRENCIES.has(baseCurrency) || baseCurrency === "USD"`) to decide a row is cash. Replace those references with `FIAT`. **Check the difference before you do:** the old `FIAT_CURRENCIES` contained `USD` and the new `FIAT` does not, which is why the `|| baseCurrency === "USD"` clause beside it must stay. Read every use before replacing it.

In `packages/data/src/services/transfer.ts`, delete the local `FIAT` (line 27) and import the shared one. The old set had 9 entries and the new one has 10 — it gains `DKK`. That is a widening, so a Danish-krone row that previously stayed unpriced now resolves.

- [ ] **Step 6: Run the whole suite**

Run: `npx vitest run && npm run typecheck`
Expected: PASS. If a delta-csv test fails, the `USD`-in-`FIAT_CURRENCIES` difference from Step 5 is the first place to look.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/currencies.ts packages/core/src/currencies.test.ts \
        packages/core/src/delta-csv.ts packages/data/src/services/transfer.ts
git commit -m "Give the currency rules one home instead of three"
```

---

### Task 4: The service converts a native price

**Files:**
- Modify: `packages/data/src/services/transactions.ts`
- Modify: `packages/data/src/services/pricing.ts`
- Test: `packages/data/src/services/transactions.test.ts`

**Interfaces:**
- Consumes: `needsRate`, `FIAT` from Task 3.
- Produces:
  - `usdRateOn(net: Net, currency: string, time: number): Promise<number | null>` in `pricing.ts` — USD per one unit of `currency` on that date, null when unobtainable.
  - `addTransaction(store: Store, net: Net, portfolioId: string, tx: NewTransaction)` — **note the new second parameter**, which every caller must pass.

- [ ] **Step 1: Write the failing test**

```ts
// packages/data/src/services/transactions.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { invalidate } from "@/core/cache";
import { MemoryStore } from "../testing/memory-store";
import { FakeNet } from "../testing/fake-net";
import { addTransaction } from "./transactions";

beforeEach(() => invalidate());

const DAY_MS = 86_400_000;
const TRADE = Date.parse("2024-03-01T12:00:00Z");

/** One daily bar per UTC day at a fixed close. */
function klines(close: number) {
  return (url: string) => {
    const p = new URL(url).searchParams;
    const from = Number(p.get("startTime")), to = Number(p.get("endTime"));
    const out: unknown[] = [];
    for (let t = Math.floor(from / DAY_MS) * DAY_MS; t <= to; t += DAY_MS) {
      out.push([t, "1", "1", "1", String(close), "1", t + DAY_MS - 1, "0", 0, "0", "0", "0"]);
    }
    return out;
  };
}

function base() {
  return {
    symbol: "ETH", assetType: "crypto" as const, side: "buy" as const,
    quantity: 2, price: 0, fee: 0, time: TRADE,
    nativeCurrency: null, nativePrice: null, nativeFee: null, note: null,
  };
}

describe("addTransaction", () => {
  it("converts a EUR price at that day's rate, keeping the native figures", async () => {
    const store = MemoryStore();
    const p = await store.portfolios.create("Main");
    // EUR was worth 1.10 USD on the trade's date.
    const net = FakeNet({ "symbol=EURUSDT": klines(1.1) });

    const tx = await addTransaction(store, net, p.id, {
      ...base(), nativeCurrency: "EUR", nativePrice: 2000, nativeFee: 10,
    });

    expect(tx.price).toBeCloseTo(2200, 6);
    expect(tx.fee).toBeCloseTo(11, 6);
    expect(tx.nativePrice).toBe(2000);
    expect(tx.nativeCurrency).toBe("EUR");
  });

  it("uses the trade's date, not today's", async () => {
    // The whole point of the conversion living here. A trade entered a week
    // late must not be priced at this morning's rate — and a test that scripts
    // one flat rate cannot tell the two apart, so this asserts the window.
    const store = MemoryStore();
    const p = await store.portfolios.create("Main");
    const net = FakeNet({ "symbol=EURUSDT": klines(1.1) });

    await addTransaction(store, net, p.id, {
      ...base(), nativeCurrency: "EUR", nativePrice: 2000, nativeFee: 0,
    });

    const asked = new URL(net.calls.find((c) => c.url.includes("klines"))!.url);
    const from = Number(asked.searchParams.get("startTime"));
    const to = Number(asked.searchParams.get("endTime"));
    expect(from).toBeLessThanOrEqual(TRADE);
    expect(to).toBeGreaterThanOrEqual(TRADE);
    expect(to - TRADE).toBeLessThan(7 * DAY_MS); // not a window ending at now
  });

  it("leaves a USD-stable price alone and asks nothing", async () => {
    const store = MemoryStore();
    const p = await store.portfolios.create("Main");
    const net = FakeNet({});   // any request at all throws

    const tx = await addTransaction(store, net, p.id, {
      ...base(), price: 3000, nativeCurrency: "USDT", nativePrice: 3000,
    });

    expect(tx.price).toBe(3000);
    expect(net.calls).toHaveLength(0);
  });

  it("stores the native figures and a zero price when no rate can be had", async () => {
    // Losing the euro figure would be worse than an unpriced row: the row can
    // be repriced later, but only if what was actually paid survives.
    const store = MemoryStore();
    const p = await store.portfolios.create("Main");
    const net = FakeNet({ "symbol=ZWLUSDT": [] });

    const tx = await addTransaction(store, net, p.id, {
      ...base(), nativeCurrency: "ZWL", nativePrice: 500, nativeFee: 0,
    });

    expect(tx.price).toBe(0);
    expect(tx.nativePrice).toBe(500);
    expect(tx.nativeCurrency).toBe("ZWL");
  });

  it("still refuses a portfolio that does not exist", async () => {
    const store = MemoryStore();
    const net = FakeNet({});
    await expect(addTransaction(store, net, "nope", base())).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/data/src/services/transactions.test.ts`
Expected: FAIL — `addTransaction` takes three arguments, not four.

- [ ] **Step 3: Add `usdRateOn` to `pricing.ts`**

```ts
/**
 * USD per one unit of `currency` on a given date, or null when no rate can be
 * had. A stable answers 1 without asking anyone.
 *
 * One date, one currency — deliberately not the importer's shape. `transfer.ts`
 * fetches a range per currency across many rows, which is the right access
 * pattern there and the wrong one for a single manual entry. What the two share
 * is the classification in `@/core/currencies`, not the fetching: the rule for
 * *which* source answers must have one home, while *how much* is asked for at a
 * time is each caller's business.
 */
export async function usdRateOn(
  net: Net,
  currency: string,
  time: number,
): Promise<number | null> {
  const c = currency.toUpperCase();
  if (!needsRate(c)) return 1;

  const from = time - 5 * DAY_MS;
  const to = time + DAY_MS;

  // Binance first: it covers coin quotes, and for fiat it is the same series
  // the importer uses, so a hand entry and an import agree.
  try {
    const bars = await fetchKlinesRange(net, {
      symbol: pricingPair(c), interval: "1d", from, to,
    });
    const byDay = new Map(bars.map((b) => [b.t, b.c]));
    const hit = rateOn(byDay, time);
    if (hit !== null) return hit;
  } catch {
    // No Binance market for this currency; fall through to the ECB.
  }

  // EURUSDT only lists from late 2020, so an older fiat trade needs the ECB.
  if (FIAT.has(c)) {
    try {
      const ecb = await fetchEcbRates(net, c, "USD", from, to);
      return rateOn(ecb, time);
    } catch {
      // Unavailable; the caller stores the native figures and a zero price.
    }
  }
  return null;
}
```

Imports this needs at the top of `pricing.ts`: `rateOn` from `@/core/fx`, `FIAT` and `needsRate` from `@/core/currencies`, `pricingPair` from `@/core/symbols`, `fetchKlinesRange` from `../sources/binance`, `fetchEcbRates` from `../sources/fx`. `DAY_MS` is `86_400_000`; declare it if the file does not already have one.

- [ ] **Step 4: Convert inside `addTransaction`**

```ts
/**
 * The current POST checks the portfolio exists before creating, and turns a
 * miss into a 404. `store.transactions.add` has no opinion about that, so the
 * check lives here.
 *
 * `net` is here because a price typed in euros has to become the USD figure
 * every other calculation in the app runs on, at the rate on the *trade's*
 * date. Putting that in the form would need a rate lookup in the browser and
 * would let two screens disagree; putting it in the route would leave the
 * device build without it.
 */
export async function addTransaction(
  store: Store,
  net: Net,
  portfolioId: string,
  tx: NewTransaction,
): Promise<Transaction> {
  const portfolio = await store.portfolios.get(portfolioId);
  if (!portfolio) throw new NotFoundError(`no portfolio ${portfolioId}`);
  return store.transactions.add(portfolioId, await inUsd(net, tx));
}

/**
 * A transaction whose `price` and `fee` are USD, given one whose native
 * figures may not be.
 *
 * When no rate can be had the native figures are kept and the USD price is
 * zero — the same shape the importer produces for an unpriceable row, and
 * recoverable, because what was actually paid is still on the row.
 */
async function inUsd(net: Net, tx: NewTransaction): Promise<NewTransaction> {
  if (!tx.nativeCurrency || tx.nativePrice === null || tx.nativePrice === undefined) return tx;
  const rate = await usdRateOn(net, tx.nativeCurrency, Number(tx.time));
  if (rate === null) return { ...tx, price: 0, fee: 0 };
  return {
    ...tx,
    price: tx.nativePrice * rate,
    fee: (tx.nativeFee ?? 0) * rate,
  };
}
```

Import `usdRateOn` from `./pricing` and `Net` from `../ports/net`.

- [ ] **Step 5: Update every caller**

`addTransaction` now takes four arguments. Find them all:

```bash
grep -rn "addTransaction(" apps/web/src packages/data/src --include=*.ts --include=*.tsx | grep -v "\.test\."
```

Each call site passes the `Net` it already has — `deps()` in a route, the injected one in a service. Do not reach for a module-level default.

- [ ] **Step 6: Run and watch them pass**

Run: `npx vitest run && npm run typecheck`
Expected: PASS, including the five new tests.

- [ ] **Step 7: Commit**

```bash
git add packages/data/src/services
git commit -m "Convert a native price at the rate on the day it was paid"
```

---

### Task 5: The input type and the route carry the currency

**Files:**
- Modify: `packages/data/src/client/data-client.ts:298-307`
- Modify: `apps/web/src/app/api/portfolios/tx.ts`
- Modify: `apps/web/src/app/api/portfolios/[id]/transactions/route.ts`
- Test: `packages/data/src/client/client-contract.ts`

**Interfaces:**
- Consumes: `addTransaction(store, net, portfolioId, tx)` from Task 4.
- Produces: `NewTransactionInput` with `nativeCurrency?`, `nativePrice?`, `nativeFee?`.

- [ ] **Step 1: Add the contract test**

In `packages/data/src/client/client-contract.ts`, beside the existing `it("adds a transaction and hands back what was stored")`:

```ts
    it("keeps the currency a price was quoted in", async () => {
      // The importer has always recorded this; a manual entry could not, and
      // its price silently meant USD. Both implementations must agree, which
      // is the whole reason this lives in the contract and not in one client's
      // own suite.
      const p = await client.createPortfolio("Native");
      const tx = await client.addTransaction(p.id, {
        symbol: "ETH", side: "buy", quantity: 1, price: 0, fee: 0,
        time: Date.parse("2024-03-01T12:00:00Z"),
        nativeCurrency: "EUR", nativePrice: 2000, nativeFee: 10,
      });
      expect(tx.nativeCurrency).toBe("EUR");
      expect(tx.nativePrice).toBe(2000);
    });
```

This requires `TransactionDto` to expose the native fields; add them to that type and to `serializeTx` in Step 3.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/data/src/client`
Expected: FAIL against both implementations — the type does not have the fields.

- [ ] **Step 3: Extend the type, the serializer and the DTO**

In `data-client.ts`, `NewTransactionInput` gains:

```ts
  /**
   * What the price and fee were actually paid in. Absent means the figures are
   * already USD — which is what every manual entry meant before this existed,
   * so absent must keep behaving exactly as it did.
   */
  nativeCurrency?: string | null;
  nativePrice?: number | null;
  nativeFee?: number | null;
```

`TransactionDto` gains `nativeCurrency: string | null` and `nativePrice: number | null`, and `serializeTx` in `apps/web/src/app/api/portfolios/tx.ts` returns them.

- [ ] **Step 4: Extend the Zod schema**

In `apps/web/src/app/api/portfolios/tx.ts`:

```ts
export const TxInput = z.object({
  symbol: z.string().min(1).max(20),
  side: z.enum(["buy", "sell", "transfer_in", "transfer_out"]),
  quantity: z.number().positive(),
  price: z.number().nonnegative(),
  fee: z.number().nonnegative().default(0),
  time: z.number().int().positive(), // ms timestamp
  note: z.string().max(500).optional(),
  // Optional, with no default: absent must stay absent. `TxPatch` derives from
  // this schema, and a default here would arrive on a PATCH that never
  // mentioned the currency and overwrite a stored one — the same way a
  // defaulted `fee` once erased part of a cost basis.
  nativeCurrency: z.string().min(1).max(12).optional(),
  nativePrice: z.number().nonnegative().optional(),
  nativeFee: z.number().nonnegative().optional(),
});
```

- [ ] **Step 5: Stop the route hard-coding nulls**

In `apps/web/src/app/api/portfolios/[id]/transactions/route.ts`, the three hard-coded `null`s and their comment go. Pass what arrived, and hand the service the `Net`:

```ts
  const { store, net } = deps();
  try {
    const created = await addTransaction(store, net, id, {
      symbol: body.data.symbol.toUpperCase(),
      // Still crypto: `assetType` is not on this schema yet — cash and income
      // arrive with the next plan, and until then the column default is right.
      assetType: "crypto",
      side: body.data.side,
      quantity: body.data.quantity,
      price: body.data.price,
      fee: body.data.fee,
      time: body.data.time,
      nativeCurrency: body.data.nativeCurrency?.toUpperCase() ?? null,
      nativePrice: body.data.nativePrice ?? null,
      nativeFee: body.data.nativeFee ?? null,
      note: body.data.note ?? null,
    });
```

- [ ] **Step 6: Run and watch both implementations pass**

Run: `npx vitest run packages/data && npm run typecheck`
Expected: PASS, `HttpClient` and the stub alike.

- [ ] **Step 7: Commit**

```bash
git add packages/data/src/client apps/web/src/app/api
git commit -m "Let a transaction say which currency its price was in"
```

---

### Task 6: The quote picker

**Files:**
- Modify: `packages/data/src/sources/binance.ts`
- Modify: `packages/data/src/client/data-client.ts`, `http-client.ts`, `client-contract.ts`
- Create: `apps/web/src/app/api/quotes/[asset]/route.ts`
- Test: `packages/data/src/sources/binance.test.ts`

**Interfaces:**
- Produces:
  - `fetchQuotesFor(net: Net, base: string): Promise<string[]>`
  - `DataClient.listQuotes(asset: string): Promise<string[]>`

- [ ] **Step 1: Write the failing test**

```ts
// in packages/data/src/sources/binance.test.ts
import { QUOTE_ASSETS } from "@/core/symbols";
import { fetchQuotesFor } from "./binance";

const EXCHANGE_INFO = {
  symbols: [
    { symbol: "ETHUSDT", baseAsset: "ETH", quoteAsset: "USDT", status: "TRADING", isSpotTradingAllowed: true },
    { symbol: "ETHEUR",  baseAsset: "ETH", quoteAsset: "EUR",  status: "TRADING", isSpotTradingAllowed: true },
    { symbol: "ETHBTC",  baseAsset: "ETH", quoteAsset: "BTC",  status: "TRADING", isSpotTradingAllowed: true },
    { symbol: "ETHNGN",  baseAsset: "ETH", quoteAsset: "NGN",  status: "TRADING", isSpotTradingAllowed: true },
    { symbol: "ETHRUB",  baseAsset: "ETH", quoteAsset: "RUB",  status: "BREAK",   isSpotTradingAllowed: true },
    { symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", status: "TRADING", isSpotTradingAllowed: true },
  ],
};

describe("fetchQuotesFor", () => {
  it("lists the quotes this base trades against, in quotes the app knows", async () => {
    const net = FakeNet({ "/api/v3/exchangeInfo": EXCHANGE_INFO });
    const quotes = await fetchQuotesFor(net, "ETH");
    // NGN is dropped for being outside QUOTE_ASSETS, RUB for not trading.
    expect(quotes.sort()).toEqual(["BTC", "EUR", "USDT"]);
  });

  it("puts USDT first, because it is the one people mean", async () => {
    const net = FakeNet({ "/api/v3/exchangeInfo": EXCHANGE_INFO });
    expect((await fetchQuotesFor(net, "ETH"))[0]).toBe("USDT");
  });

  it("answers an empty list for a base with no listed pair", async () => {
    // Not an error: an equity reaches here through no path, but a delisted or
    // misspelled coin does, and the form must draw something.
    const net = FakeNet({ "/api/v3/exchangeInfo": EXCHANGE_INFO });
    expect(await fetchQuotesFor(net, "NOSUCH")).toEqual([]);
  });

  it("offers nothing outside the shared quote list", async () => {
    const net = FakeNet({ "/api/v3/exchangeInfo": EXCHANGE_INFO });
    for (const q of await fetchQuotesFor(net, "ETH")) {
      expect(QUOTE_ASSETS as readonly string[]).toContain(q);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/data/src/sources/binance.test.ts`
Expected: FAIL, `fetchQuotesFor` is not exported.

- [ ] **Step 3: Implement**

```ts
/**
 * Quote assets Binance lists this base against — ETH -> ["USDT", "EUR", "BTC"].
 *
 * Filtered to `QUOTE_ASSETS` so the form never offers a pair the rest of the
 * app cannot price: `assetOf` has to be able to read the asset back out, and a
 * quote it does not know would make `ETHNGN` parse as the asset `ETHN`.
 *
 * USDT leads because it is what a price usually means; the rest keep
 * `exchangeInfo`'s order, which is stable.
 */
export function fetchQuotesFor(net: Net, base: string): Promise<string[]> {
  const b = base.toUpperCase();
  return cached(`quotes:${b}`, 3_600_000, async () => {
    const info = await net.json<{
      symbols: { baseAsset: string; quoteAsset: string; status: string; isSpotTradingAllowed: boolean }[];
    }>("https://api.binance.com/api/v3/exchangeInfo");
    const known = new Set<string>(QUOTE_ASSETS);
    const found = info.symbols
      .filter((s) => s.baseAsset === b && s.status === "TRADING" && s.isSpotTradingAllowed)
      .map((s) => s.quoteAsset)
      .filter((q) => known.has(q));
    return [...new Set(found)].sort((x, y) =>
      x === "USDT" ? -1 : y === "USDT" ? 1 : 0);
  });
}
```

Import `QUOTE_ASSETS` from `@/core/symbols` and `cached` from `@/core/cache` if not already imported.

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run packages/data/src/sources/binance.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Expose it through the client**

`data-client.ts`:

```ts
  /**
   * Which currencies this asset's price can be quoted in. Empty for an equity,
   * whose currency is its venue's and is not a choice.
   */
  listQuotes(asset: string): Promise<string[]>;
```

`http-client.ts`:

```ts
    listQuotes(asset: string): Promise<string[]> {
      return send<{ quotes: string[] }>("GET", `/api/quotes/${encodeURIComponent(asset)}`)
        .then((d) => d.quotes);
    },
```

New route `apps/web/src/app/api/quotes/[asset]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { deps } from "@/lib/deps";
import { fetchQuotesFor } from "@/data/sources/binance";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ asset: string }> }) {
  const { asset } = await ctx.params;
  const { net } = deps();
  return NextResponse.json({ quotes: await fetchQuotesFor(net, decodeURIComponent(asset)) });
}
```

And a contract entry, beside the other read methods:

```ts
    it("lists the currencies an asset can be priced in", async () => {
      const quotes = await client.listQuotes("ETH");
      expect(Array.isArray(quotes)).toBe(true);
    });
```

The stub client implements it by calling `fetchQuotesFor` with its own `FakeNet`; script `"/api/v3/exchangeInfo"` in that suite's net the way the source test does.

- [ ] **Step 6: Run both implementations**

Run: `npx vitest run packages/data && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/data/src apps/web/src/app/api/quotes
git commit -m "Ask Binance which currencies a coin actually trades against"
```

---

### Task 7: The form picks a currency and fills the price

**Files:**
- Create: `packages/ui/src/tx-fields.ts`
- Create: `packages/ui/src/tx-fields.test.ts`
- Modify: `packages/ui/src/TxForm.tsx`
- Modify: `apps/web/src/app/portfolio/[symbol]/page.tsx`

**Interfaces:**
- Consumes: `listQuotes` from Task 6; `NewTransactionInput`'s native fields from Task 5.
- Produces:
  - `NewTx` gains `nativeCurrency: string | null`, `nativePrice: number`, `nativeFee: number`
  - `priceCurrency(symbol, assetType, chosen): string`
  - `toNewTx(fields: TxFields): NewTx | null`

> **On testing this one.** The question worth pinning is *which currency ends
> up on the submitted transaction* — that is arithmetic, not markup, and it is
> where a mistake stores a wrong number silently. So it comes out of the
> component into a pure function and is tested directly. The markup around it
> is verified by hand in Step 6, for the reason given in Task 1.

- [ ] **Step 1: Write the failing test**

```ts
// packages/ui/src/tx-fields.test.ts
import { describe, expect, it } from "vitest";
import { priceCurrency, toNewTx } from "./tx-fields";

describe("priceCurrency", () => {
  it("is the chosen quote for a coin", () => {
    expect(priceCurrency("ETH", "crypto", "EUR")).toBe("EUR");
  });

  it("is the venue's currency for an equity, whatever was chosen", () => {
    // ASML trades in euros and cannot trade in anything else. A quote picked
    // for a previous coin must not leak onto it.
    expect(priceCurrency("ASML.AS", "equity", "USDT")).toBe("EUR");
    expect(priceCurrency("AMD", "equity", "EUR")).toBe("USD");
  });

  it("defaults a coin to USDT, which is what a price usually means", () => {
    expect(priceCurrency("ETH", "crypto", null)).toBe("USDT");
  });
});

describe("toNewTx", () => {
  const fields = {
    symbol: "eth", side: "buy" as const, quantity: "2", price: "2000",
    fee: "1.5", when: "2024-03-01T12:00", currency: "EUR",
  };

  it("carries the typed figure and the currency it was typed in", () => {
    const tx = toNewTx(fields)!;
    expect(tx).toMatchObject({
      symbol: "ETH", side: "buy", quantity: 2,
      nativeCurrency: "EUR", nativePrice: 2000, nativeFee: 1.5,
    });
  });

  it("does not convert — that is the service's job, on the trade's date", () => {
    // Two screens converting independently is how they come to disagree, and
    // a browser has no business knowing March's exchange rate.
    const tx = toNewTx(fields)!;
    expect(tx.price).toBe(2000);
    expect(tx.nativePrice).toBe(2000);
  });

  it("refuses a row that is not a transaction", () => {
    expect(toNewTx({ ...fields, quantity: "" })).toBeNull();
    expect(toNewTx({ ...fields, quantity: "0" })).toBeNull();
    expect(toNewTx({ ...fields, quantity: "-1" })).toBeNull();
    expect(toNewTx({ ...fields, price: "abc" })).toBeNull();
    expect(toNewTx({ ...fields, when: "" })).toBeNull();
  });

  it("treats an empty fee as zero, not as missing", () => {
    expect(toNewTx({ ...fields, fee: "" })!.fee).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/ui/src/tx-fields.test.ts`
Expected: FAIL, cannot find module `./tx-fields`.

- [ ] **Step 2a: Implement the pure part**

```ts
// packages/ui/src/tx-fields.ts
import { currencyForTicker } from "@/core/equity";

/**
 * The transaction a form describes. It lives here rather than in `TxForm`
 * because `TxForm` imports this module — the other direction would be a cycle,
 * and a type-only cycle is still a cycle waiting for someone to add a value to
 * it. `TxForm` re-exports it so existing importers do not move.
 */
export type NewTx = {
  symbol: string;
  side: "buy" | "sell" | "transfer_in" | "transfer_out";
  quantity: number;
  price: number;
  fee: number;
  time: number;
  /** What the price was quoted in; null means it was already USD. */
  nativeCurrency: string | null;
  nativePrice: number;
  nativeFee: number;
};

export type TxFields = {
  symbol: string;
  side: NewTx["side"];
  quantity: string;
  price: string;
  fee: string;
  /** A `datetime-local` value, in the device's own timezone. */
  when: string;
  /** The quote chosen for a coin; ignored for an equity. */
  currency: string | null;
};

/**
 * What the price field is denominated in.
 *
 * A coin can be bought with several things and the picker says which. A listed
 * security is priced in its venue's currency and has no choice about it, so a
 * quote left over from the last coin must not follow it there.
 */
export function priceCurrency(
  symbol: string,
  assetType: "crypto" | "equity",
  chosen: string | null,
): string {
  if (assetType === "equity") return currencyForTicker(symbol);
  return chosen ?? "USDT";
}

/**
 * The transaction a filled-in form describes, or null if it does not describe
 * one yet.
 *
 * `price` and `nativePrice` are the same number on purpose: the figure typed
 * is the figure paid, and turning it into USD happens in the service at the
 * rate on the trade's date. A browser has no business knowing that rate, and
 * two screens that each converted would eventually disagree.
 */
export function toNewTx(f: TxFields): NewTx | null {
  const quantity = Number(f.quantity);
  const price = Number(f.price);
  const fee = f.fee === "" ? 0 : Number(f.fee);
  const time = new Date(f.when).getTime();
  if (!f.symbol) return null;
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  if (!Number.isFinite(price) || price < 0) return null;
  if (!Number.isFinite(fee) || fee < 0) return null;
  if (!Number.isFinite(time)) return null;
  return {
    symbol: f.symbol.toUpperCase(),
    side: f.side,
    quantity, price, fee, time,
    nativeCurrency: f.currency,
    nativePrice: price,
    nativeFee: fee,
  };
}
```

- [ ] **Step 2b: Run and watch it pass**

Run: `npx vitest run packages/ui/src/tx-fields.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 3: Wire the component to it**

`TxForm` keeps only the fields and the rendering: it holds the same strings in
state, calls `priceCurrency` for the label, and calls `toNewTx` on submit,
passing the result to `onSubmit` when it is not null. No parsing or validation
stays in the component — everything Step 2a covers is now covered by a test.

`NewTx` now lives in `tx-fields.ts`. `TxForm` re-exports it —
`export type { NewTx } from "./tx-fields";` — so the screens importing it from
`TxForm` today do not have to move.

`TxForm` gains an `assetType?: "crypto" | "equity"` prop, a `quote` state defaulting to `"USDT"`, and a quotes list loaded from `useDataClient().listQuotes(lockedSymbol ?? symbol)` when `assetType === "crypto"`.

For an equity, the currency is `currencyForTicker(symbol)` from `@/core/equity`, rendered as text rather than a control.

The price field's label becomes `Price (${currency})`. Replace the existing `quoteAsset(symbol)` derivation entirely — it read the quote out of a pair, and after the symbol rename a stored symbol is an asset, so it now answers null for every coin.

`submit()` becomes a call into the pure part:

```ts
  function submit() {
    const tx = toNewTx({ symbol, side, quantity, price, fee, when, currency });
    if (!tx) return;
    onSubmit(tx);
    setQuantity(""); setPrice(""); setFee(""); setWhen(localNow());
  }
```

where `currency` is `priceCurrency(lockedSymbol ?? symbol, assetType, quote)`.

The fill control sits beside the price field:

```tsx
        {/* `money` is `@/core/display`'s, the same formatter every figure in the
            app goes through — a hand-rolled one here would bypass privacy mode. */}
        {livePrice != null && livePrice > 0 && (
          <button
            type="button"
            onClick={() => setPrice(String(livePrice))}
            // 11px is the floor BRAND.md sets; nothing smaller.
            className="text-[11px] text-neutral-400 underline underline-offset-2"
          >
            Use {money(livePrice)}
          </button>
        )}
```

- [ ] **Step 4: Feed it the right live price**

In `apps/web/src/app/portfolio/[symbol]/page.tsx`, the form is currently passed `livePrice={shownHolding?.price ?? lastClose}`. **`shownHolding.price` is in the display currency and `lastClose` is in the asset's own** — measured on the live ledger, `AMD` reads 457.58 from history and €389.13 on the holding. Feeding the first would put a euro figure into a field labelled USD.

Pass the series figure only:

```tsx
                      livePrice={lastClose} />
```

and add `assetType={resolvedType}`.

- [ ] **Step 5: Run and watch them pass**

Run: `npx vitest run packages/ui && npm run typecheck`
Expected: PASS, including the 9 from Step 1.

- [ ] **Step 6: Verify the round trip by hand, against a copy**

```bash
cp apps/web/prisma/dev.db /tmp/native-test.db
npm run build
cd apps/web && DATABASE_URL="file:/tmp/native-test.db" npx next start -p 3002
```

On `/portfolio/ETH`, add a buy of 1 ETH at 2000 EUR dated a month ago. Then check the stored row:

```bash
sqlite3 /tmp/native-test.db \
  "SELECT symbol, quantity, price, nativeCurrency, nativePrice FROM \"Transaction\" ORDER BY rowid DESC LIMIT 1;"
```

Expected: `ETH|1.0|<about 2100-2200>|EUR|2000.0`. The USD price must be the euro figure times the rate *on that date* — check it against `https://api.binance.com/api/v3/klines?symbol=EURUSDT&interval=1d&limit=40` rather than against today's rate, since the two are close enough to look right when they are not.

- [ ] **Step 7: Compare the two entry paths**

The check that matters, per the spec: the same trade typed and imported must agree.

Import a one-row CSV against the same copy, through `/ledger`:

```
Date,Type,Exchange,Base amount,Base currency,Quote amount,Quote currency,Fee,Fee currency,Costs/Proceeds,Costs/Proceeds currency,Notes
2024-03-01,BUY,Bitvavo,1,ETH,2000,EUR,0,EUR,,,
```

Then type the same trade in the form. Both rows must show the same `price` to within rounding. **A difference here means the manual path is not using the importer's rate source, and no unit test in this plan would have caught it** — that is why this step is by hand.

- [ ] **Step 8: Full verification and commit**

Run: `npm run typecheck && npx vitest run && npm run lint`
Expected: typecheck clean, all tests pass, lint exits non-zero with **exactly 21** errors.

```bash
rm /tmp/native-test.db
git add packages/ui/src apps/web/src/app/portfolio
git commit -m "Record what a price was quoted in, and offer the one on screen"
```

---

### Task 8: Close the door and write it down

**Files:**
- Modify: `packages/core/src/boundary.test.ts`
- Modify: `CLAUDE.md`, `docs/carried-forward.md`

- [ ] **Step 1: Guard the currency lists**

```ts
it("keeps one home for the currency classification", () => {
  // Three overlapping copies of these sets is what this replaced. A fourth
  // would drift the same way, and the drift is invisible until a price is
  // wrong on one screen only.
  const offenders = sourceFiles(join(process.cwd(), "packages"))
    .filter((f) => !f.endsWith("currencies.ts"))
    .filter((f) => /new Set\(\[[^\]]*"(EUR|USDT)"[^\]]*"(GBP|USDC)"/.test(
      stripComments(readFileSync(f, "utf8")),
    ));
  expect(offenders).toEqual([]);
});
```

- [ ] **Step 2: Run it, then prove it catches**

Run: `npx vitest run packages/core/src/boundary.test.ts`
Expected: PASS.

Then reintroduce an offender to check the guard is real — add `const NOPE = new Set(["EUR", "GBP"]);` to `packages/core/src/portfolio.ts`, re-run, and confirm it FAILS naming that file. Remove it and confirm it passes again. **A guard never seen failing is not known to work.**

- [ ] **Step 3: Update the guides**

`CLAUDE.md`, in Conventions:

> - **A manual transaction records what it was paid in.** `nativeCurrency` /
>   `nativePrice` carry the typed figure; the service converts to the USD
>   `price` at the rate on the trade's date. A form never converts — two
>   screens would disagree. Currency classification lives in
>   `packages/core/src/currencies.ts` and nowhere else.

`docs/carried-forward.md`: move the manual-entry-cannot-record-currency note into "Resolved since the ledgers were written", and add, under a heading of its own, that **§5 and §6 of the spec are not built** — alerts still cannot fire for equities, dividends are still dropped at import, and cash still cannot be added by hand.

- [ ] **Step 4: Full verification**

```bash
npm run typecheck && npx vitest run && npm run lint
```

Expected: typecheck clean, all pass, lint exits non-zero with exactly 21 errors.

- [ ] **Step 5: Browser pass**

`/portfolio` totals unchanged from before this plan. The Add sheet rises on `/portfolio`, on a held asset page and on an unheld one. The currency picker appears for a coin and not for a stock. The price fill button works and fills the field it sits beside. The More menu still opens as a sheet on a phone and a dropdown on a desktop.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Keep the currency rules in one place"
```
