# Cash and income — Implementation Plan

> **The figures in this document are illustrative.** It described a repair to a
> real ledger, and the amounts, quantities and ticker have been replaced with
> invented ones that preserve the arithmetic the argument depends on. The
> reasoning is unchanged; the numbers are not anybody's positions.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a person record cash and income — a euro deposit, a Shell dividend,
staking rewards, bank interest — and stop the importer dropping dividends on the
floor.

**Architecture:** A new transaction side, `income`, for *cash attributed to a
security*. It always credits cash and never moves a position, so a dividend
cannot lower the average cost of the shares that paid it. `transfer_in` keeps its
existing meaning and gains nothing new — a staking reward or a share grant is an
inbound delivery, and `transfer_in` has carried a cost-basis price all along; what
changes is that the importer stops writing 0 where the export gives a figure. One
migration adds `sourceSymbol` to `Transaction`.

**Tech Stack:** TypeScript, Prisma 6 + SQLite, Zod, Vitest, React 19.

**Spec:** `docs/superpowers/specs/2026-08-24-asset-actions-design.md` §6.

**Sequencing:** Third of the spec's four groups. §1 (the sheet) and §2–§4 (native
currency, quote picker, prefill) are **already merged** — `Sheet.tsx`,
`tx-fields.ts`, `usdRateOn`, `fetchQuotesFor` and `listQuotes` all exist. This
plan builds on them. §5 (equity alerts) is the fourth group and has its own plan:
`docs/superpowers/plans/2026-08-24-equity-alerts.md`. They are independent and may
run in either order.

## Global Constraints

- **`income` never touches a position.** Not `quantity`, not `costBasis`, not
  `avgCost`, not `realizedPnl`. A dividend is not a purchase. This is the single
  mistake to guard against, because the income row and the shares that paid it
  name the same security.
- **An income row is a cash row**: `assetType: "cash"`, `symbol` is the currency,
  `quantity` is the amount, `nativeCurrency` is the currency, `nativePrice: 1`,
  `price: 0`. This is exactly the shape the importer already writes for a fiat
  `DEPOSIT`, and every cash consumer already reads it.
- **`sourceSymbol` is nullable.** Bank interest has no source security.
- **The app is correct after every task, not only after the last one.** Same rule
  the symbol rename ran under.
- `npm run typecheck` — never bare `npx tsc --noEmit`.
- `npm run lint` must stay at exactly **21** pre-existing errors.
- Tests: `npx vitest run <path>` from the repository root. Full suite before
  finishing: **587 tests / 46 files** pass on the tip this plan starts from.
- Prisma migrations run **from `apps/web`** (that is where `.env` lives);
  `npx prisma generate` runs from the repository root.
- **Never commit `apps/web/prisma/dev.db` or a dated copy.** Destructive testing
  runs against a copy with a second server on port 3001, killed **by port**.

## What the spec got wrong, and what that changes

The spec's §6 table counts **34 branch sites across eight files** and calls it
"the largest single risk". Two corrections, both found by reading the code before
writing this plan, and both make the work smaller and safer than the spec
predicted:

1. **`asset-info.ts` has no side branch at all.** Its one apparent hit is
   `recommendationScore`, switching on Yahoo's analyst-recommendation keys —
   `"buy"`, `"sell"`, `"hold"`. Same words, different vocabulary. Nothing to do.
2. **Every service consumer already filters cash out first.**
   `valuation.insights()` (`valuation.ts:384`), `series` (`series.ts:107`,
   `series.ts:443`) and `snapshot` (`valuation.ts:280`) all pass
   `.filter((t) => t.assetType !== "cash")` before reaching `tradeStats`,
   `flowsByYear`, `flowsByBar` or `computeHoldings`. An income row is a cash row,
   so **it never reaches them through any service that exists today.**

That second point is the important one, and it cuts both ways. It means no figure
on any screen can be wrong on the day `income` lands — but it also means **a test
that only exercises the services will pass whether or not the pure functions are
correct**. So Tasks 1–3 guard the pure functions directly, with unit tests that
call them with an income row, because the filter is a caller's habit and the next
caller may not have it.

The sites that genuinely need changing, enumerated:

| File | Function | What income does today if unguarded |
|---|---|---|
| `portfolio.ts` | `computeHoldings` | falls into the disposal `else` — **reduces the position** |
| `portfolio.ts` | `annotateTransactions` | same disposal `else` |
| `portfolio.ts` | `portfolioValueSeries` | negative `delta` — reduces held quantity |
| `cash.ts` | `cashBalances` | `signed` is **negative** — a dividend *debits* cash |
| `cash.ts` | `cashBalancesOver` | same, on the running balance |
| `ledger-audit.ts` | `underfundedCurrencies` | income read as a withdrawal → false shortfalls |
| `ledger-audit.ts` | `cashLegTimes` | a dividend near a trade misread as that trade's cash leg |
| `insights.ts` | `tradeStats` | counted as a "transfer" |
| `insights.ts` | `flowsByYear` | falls into the final `else` — negative flow |
| `performance.ts` | `flowsByBar` | no branch matches → flow 0 (harmless, but unstated) |
| `export.ts` | `BackupSchema` | Zod enum rejects it — **a backup containing income cannot be restored** |
| `export.ts` | `ghostfolioCsv` | emitted as `BUY`, and dropped anyway by the cash filter |

Twelve, not thirty-four. `display-tx.ts`'s `side as TxSide` cast needs no change —
it widens with the type.

---

### Task 1: `income` in the type, and the position left alone

**Files:**
- Modify: `packages/core/src/portfolio.ts:3` (the type), `:58`, `:133`, `:177`
- Modify: `packages/core/src/insights.ts:23`, `:61`
- Modify: `packages/core/src/performance.ts:19-22`
- Test: `packages/core/src/income.test.ts` (create)

**Interfaces:**
- Produces: `TxSide = "buy" | "sell" | "transfer_in" | "transfer_out" | "income"`,
  imported by `delta-csv.ts`, `display-tx.ts` and every service. Widening it is
  what makes the compiler point at the switch sites in later tasks.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/income.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { annotateTransactions, computeHoldings, portfolioValueSeries, type Tx } from "./portfolio";
import { flowsByYear, tradeStats } from "./insights";
import { flowsByBar } from "./performance";

/**
 * `income` is cash attributed to a security. Every function here is about
 * positions or invested money, and a dividend is neither — so each must leave
 * its answer exactly as it was.
 *
 * Written as a before/after pair rather than as absolute figures on purpose:
 * the assertion is "adding this row changed nothing", which is the property
 * that matters and which absolute expectations would let drift.
 */
const shares: Tx[] = [
  { symbol: "ACME.AS", side: "buy", quantity: 100, price: 25, fee: 1, time: 1_700_000_000_000 },
];
const withDividend: Tx[] = [
  ...shares,
  { symbol: "ACME.AS", side: "income", quantity: 120, price: 0, fee: 0, time: 1_700_100_000_000 },
];

describe("income leaves positions alone", () => {
  it("does not move quantity, cost basis or average cost", () => {
    expect(computeHoldings(withDividend)).toEqual(computeHoldings(shares));
  });

  it("does not appear as a disposal in the annotated ledger", () => {
    const rows = annotateTransactions(withDividend);
    const dividend = rows.find((r) => r.side === "income")!;
    expect(dividend.realized).toBeNull();
    expect(dividend.positionAfter).toBe(100);
    expect(dividend.avgCostAfter).toBeCloseTo(25.01, 6);
  });

  it("does not change the value series", () => {
    const candles = { "ACME.AS": [{ t: 1_700_000_000_000, o: 25, h: 25, l: 25, c: 25, v: 0 }] };
    expect(portfolioValueSeries(withDividend, candles))
      .toEqual(portfolioValueSeries(shares, candles));
  });

  it("is not a transfer, and not invested money", () => {
    expect(tradeStats(withDividend).transfers).toBe(0);
    expect(flowsByYear(withDividend)).toEqual(flowsByYear(shares));
    expect([...flowsByBar(withDividend).entries()]).toEqual([...flowsByBar(shares).entries()]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/core/src/income.test.ts`
Expected: a type error on `side: "income"` (not yet in `TxSide`). That is the
failure — the type is the first thing to widen.

- [ ] **Step 3: Widen the type and guard the six functions**

In `packages/core/src/portfolio.ts`:

```ts
/**
 * `income` is cash credited against a security — a dividend, bank interest.
 * It is deliberately not a position change: every function in this file skips
 * it, because falling into the disposal branch would sell shares that a
 * dividend did not sell.
 */
export type TxSide = "buy" | "sell" | "transfer_in" | "transfer_out" | "income";
```

Then, in `computeHoldings`, immediately after `h.fees += tx.fee;`:

```ts
    // Cash attributed to this security. It moves no shares and buys none, so
    // it must not reach either branch below — the `else` is a disposal.
    if (tx.side === "income") continue;
```

In `annotateTransactions`, at the top of the loop body, before `let realized`:

```ts
    if (tx.side === "income") {
      out.push({ ...tx, positionAfter: quantity, avgCostAfter: quantity > 0 ? costBasis / quantity : 0, realized: null });
      continue;
    }
```

In `portfolioValueSeries`, inside the `while` that applies transactions:

```ts
      if (tx.side === "income") { txIdx++; continue; }
```

In `packages/core/src/insights.ts`:

```ts
  // Income is cash, not a movement of the asset. It is neither a trade nor a
  // transfer, so it is counted separately rather than swept into `transfers`
  // by a `!== "buy" && !== "sell"` test that predates it.
  const income = txs.filter((t) => t.side === "income");
  const transfers = txs.filter(
    (t) => t.side !== "buy" && t.side !== "sell" && t.side !== "income",
  );
```

and add `income: income.length` to `TradeStats` and to the returned object,
documented as "Cash credited by a holding — dividends, interest, rewards."

In `flowsByYear`, before the `else`:

```ts
    else if (t.side === "income") flow = 0; // a return, not money put in
```

In `packages/core/src/performance.ts`'s `flowsByBar`, make the same case
explicit rather than relying on no branch matching:

```ts
    else if (tx.side === "income") flow = 0; // arrived as a return; belongs in it
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run packages/core/src/income.test.ts packages/core/src/portfolio.test.ts`
Expected: PASS. If `tradeStats(...).trades` assertions elsewhere now fail, note
that `trades: txs.length` still counts income rows — decide once and write it in
the doc comment. **Ruling for this plan: `trades` counts every row, as it always
has; `income` is reported beside it.**

- [ ] **Step 5: Typecheck — this is the real work of the task**

Run: `npm run typecheck`
Expected: errors wherever a `switch (side)` is not exhaustive or an object typed
`TxSide` is built from a narrower union. Fix each by handling `income`
explicitly; **never by casting or by widening a parameter to `string`.** A cast
here is the exact failure the spec warns about — a consumer that silently ignores
an unknown side gives a figure that is right on one screen and wrong on another.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/portfolio.ts packages/core/src/insights.ts \
        packages/core/src/performance.ts packages/core/src/income.test.ts
git commit -m "Teach the position maths that income moves no shares"
```

---

### Task 2: Income credits cash

**Files:**
- Modify: `packages/core/src/cash.ts:24`, `:62`
- Modify: `packages/core/src/ledger-audit.ts:115`, `:239`
- Test: `packages/core/src/cash.test.ts`, `packages/core/src/ledger-audit.test.ts`

**Interfaces:**
- Consumes: `TxSide` from Task 1.
- Produces: nothing new; the same functions, one more side understood.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/cash.test.ts`:

```ts
describe("income", () => {
  const dividend = {
    assetType: "cash", side: "income", quantity: 120, nativeCurrency: "EUR",
  };

  it("credits cash, it does not debit it", () => {
    expect(cashBalances([dividend])).toEqual({ EUR: 120 });
  });

  it("credits the running balance too", () => {
    const at = 1_700_000_000_000;
    expect(cashBalancesOver([{ ...dividend, time: at }], [at - 1, at + 1]))
      .toEqual([{}, { EUR: 120 }]);
  });
});
```

Append to `packages/core/src/ledger-audit.test.ts`:

```ts
describe("income", () => {
  it("funds spending rather than reporting a shortfall", () => {
    // EUR 500 of dividends, then a EUR 400 purchase. Nothing is missing.
    const txs = [
      { symbol: "EUR", assetType: "cash" as const, side: "income", quantity: 500,
        price: 0, fee: 0, time: 1_000, nativeCurrency: "EUR", nativePrice: 1 },
      { symbol: "ASML.AS", assetType: "equity" as const, side: "buy", quantity: 1,
        price: 400, fee: 0, time: 2_000, nativeCurrency: "EUR", nativePrice: 400 },
    ];
    expect(auditLedger(txs).filter((f) => f.kind === "underfunded-currency")).toEqual([]);
  });

  it("is not mistaken for a trade's cash leg", () => {
    // A dividend landing in the same second as an unrelated trade is still a
    // real credit; treating it as that trade's leg would erase it.
    const at = 5_000;
    const txs = [
      { symbol: "EUR", assetType: "cash" as const, side: "income", quantity: 90,
        price: 0, fee: 0, time: at, nativeCurrency: "EUR", nativePrice: 1 },
      { symbol: "ASML.AS", assetType: "equity" as const, side: "buy", quantity: 1,
        price: 50, fee: 0, time: at, nativeCurrency: "EUR", nativePrice: 50 },
    ];
    expect(auditLedger(txs).filter((f) => f.kind === "underfunded-currency")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run packages/core/src/cash.test.ts packages/core/src/ledger-audit.test.ts`
Expected: FAIL — `{ EUR: -120 }` from `cashBalances`, and an
`underfunded-currency` finding of 400 from the audit.

- [ ] **Step 3: Implement**

In `packages/core/src/cash.ts`, both places (`cashBalances:24` and
`cashBalancesOver:62`):

```ts
    const signed =
      t.side === "transfer_in" || t.side === "buy" || t.side === "income"
        ? t.quantity
        : -t.quantity;
```

Add to `cashBalances`'s doc comment:

```
 * `income` — a dividend, interest, a staking payout in fiat — is a credit like
 * any other. It is listed explicitly rather than left to fall through, because
 * the fall-through is the withdrawal branch.
```

In `packages/core/src/ledger-audit.ts`, `underfundedCurrencies` (line 115):

```ts
      delta = t.side === "transfer_in" || t.side === "buy" || t.side === "income"
        ? t.quantity : -t.quantity;
```

And in `cashLegTimes` (line 239), exclude income from leg detection:

```ts
    if (t.assetType !== "cash") continue;
    // Income is never a trade's cash leg. A dividend that happens to land in
    // the same second as a purchase is a real credit; counting it as the
    // purchase's leg would erase it from the balance entirely.
    if (t.side === "income") continue;
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/core/src/cash.test.ts packages/core/src/ledger-audit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cash.ts packages/core/src/ledger-audit.ts \
        packages/core/src/cash.test.ts packages/core/src/ledger-audit.test.ts
git commit -m "Credit cash for income, and stop the audit calling it a withdrawal"
```

---

### Task 3: Backups round-trip, and Ghostfolio gets its DIVIDEND

**Files:**
- Modify: `packages/core/src/export.ts:47-57` (`ghostfolioCsv`), `:71` (`BackupSchema`), `:16-27` (`ExportTx`)
- Test: `packages/core/src/export.test.ts`

**Interfaces:**
- Consumes: `TxSide` from Task 1.
- Produces: `ExportTx` gains `sourceSymbol: string | null`, read by Task 4's
  serialiser and Task 8's verification.

- [ ] **Step 1: Write the failing tests**

```ts
describe("income in the exports", () => {
  const rows = [
    { symbol: "ACME.AS", assetType: "equity", side: "buy", quantity: 100, price: 25,
      fee: 1, time: 1_700_000_000_000, nativeCurrency: "EUR", nativePrice: 23,
      sourceSymbol: null, note: null },
    { symbol: "EUR", assetType: "cash", side: "income", quantity: 120, price: 0,
      fee: 0, time: 1_700_100_000_000, nativeCurrency: "EUR", nativePrice: 1,
      sourceSymbol: "ACME.AS", note: null },
  ];

  it("emits a dividend as DIVIDEND against the security that paid it", () => {
    const lines = ghostfolioCsv(rows, "EUR").trim().split("\r\n");
    expect(lines[2]).toContain("ACME.AS");
    expect(lines[2]).toContain("DIVIDEND");
  });

  it("round-trips through a backup", () => {
    const backup = {
      version: 1, exportedAt: new Date().toISOString(),
      portfolio: { name: "p", transactions: rows.map(({ note, ...r }) => ({ ...r, note })) },
    };
    const parsed = parseBackup(JSON.stringify(backup));
    expect("error" in parsed ? parsed.error : null).toBeNull();
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run packages/core/src/export.test.ts`
Expected: FAIL twice — the Ghostfolio row says `BUY` (or is absent entirely,
filtered out by `assetType !== "cash"`), and `BackupSchema`'s
`z.enum([...])` rejects `"income"`.

The backup failure is the serious one: without this fix, **a backup taken after
income exists cannot be restored.** A silent one-way door.

- [ ] **Step 3: Implement**

Add `sourceSymbol: string | null` to `ExportTx`, and to the `transactionsCsv`
header and rows (after `nativePrice`).

`BackupSchema`:

```ts
      side: z.enum(["buy", "sell", "transfer_in", "transfer_out", "income"]),
      sourceSymbol: z.string().nullable().optional(),
```

`ghostfolioCsv` — income becomes a first-class type, and is the one cash row that
survives the filter:

```ts
/**
 * Ghostfolio's import columns. Its vocabulary has no notion of a transfer, so
 * those rows are emitted as BUY/SELL at their recorded price — which is what a
 * cost basis needs anyway.
 *
 * `DIVIDEND` it has always supported; we simply had nothing to put in it until
 * `income` existed. A dividend is emitted against the security that paid it,
 * not against the currency it arrived in — Ghostfolio wants the symbol whose
 * income it was.
 */
export function ghostfolioCsv(txs: ExportTx[], currency: string): string {
  const type = (side: string) =>
    side === "income" ? "DIVIDEND"
    : side === "sell" || side === "transfer_out" ? "SELL"
    : "BUY";
  return toCsv(
    ["Date", "Symbol", "Type", "Quantity", "UnitPrice", "Fee", "Currency"],
    [...txs]
      // Cash movements have no place in a holdings import — except income,
      // which is about a security and carries the symbol to prove it.
      .filter((t) => t.assetType !== "cash" || (t.side === "income" && t.sourceSymbol))
      .sort((a, b) => a.time - b.time)
      .map((t) => [
        ISO(t.time).slice(0, 10),
        t.side === "income" ? t.sourceSymbol! : t.symbol,
        type(t.side),
        // A dividend's "quantity" in Ghostfolio's grammar is 1 unit at the
        // amount received; the row records an amount, not a share count.
        t.side === "income" ? 1 : t.quantity,
        t.side === "income" ? t.nativePrice ?? t.quantity : t.price,
        t.fee,
        currency,
      ]),
  );
}
```

**Ruling recorded here because it is a real ambiguity:** a dividend row's
`quantity` is an *amount of cash*, and Ghostfolio's `Quantity`/`UnitPrice` pair
means shares × price. Emitting `1 × amount` is the honest encoding of "this much
money arrived", and it is what Ghostfolio's own dividend import expects. Cost if
wrong: a Ghostfolio import shows the right total with a nominal quantity of 1.
Nothing in this app reads it back.

Note the units: for an income row `nativePrice` is 1 and `quantity` is the
amount, so `nativePrice ?? t.quantity` would emit 1, not the amount. **Use
`t.quantity` as the unit price and `1` as the quantity** — write it that way and
let the test pin it.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/core/src/export.test.ts`
Expected: PASS. Assert the emitted amount, not just the word `DIVIDEND` — the
units above are the part that can be quietly wrong.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/export.ts packages/core/src/export.test.ts
git commit -m "Let a backup carry income, and give Ghostfolio a real DIVIDEND"
```

---

### Task 4: The column, the port, and both stores

**Files:**
- Modify: `apps/web/prisma/schema.prisma` (`Transaction`)
- Create: `apps/web/prisma/migrations/<generated>/migration.sql`
- Modify: `packages/data/src/ports/store.ts:10` (`Side`), `:11-30` (`Transaction`)
- Modify: `apps/web/src/lib/store/prisma-store.ts:32-80`
- Modify: `packages/data/src/testing/memory-store.ts`
- Test: `packages/data/src/testing/store-contract.ts`

**Interfaces:**
- Produces: `Side` gains `"income"`; `Transaction` and `NewTransaction` gain
  `sourceSymbol: string | null`. Task 5 consumes both.

- [ ] **Step 1: Write the failing contract case**

In `packages/data/src/testing/store-contract.ts`, inside the transactions
describe:

```ts
    it("round-trips an income row with its source security", async () => {
      const store = await make();
      const p = await store.portfolios.create("p");
      const tx = await store.transactions.add(p.id, {
        symbol: "EUR", assetType: "cash", side: "income", quantity: 120,
        price: 0, fee: 0, time: 1_700_000_000_000,
        nativeCurrency: "EUR", nativePrice: 1, nativeFee: null,
        sourceSymbol: "ACME.AS", note: null,
      });
      expect(tx.side).toBe("income");
      expect(tx.sourceSymbol).toBe("ACME.AS");
      const back = await store.portfolios.get(p.id);
      expect(back!.transactions[0]!.sourceSymbol).toBe("ACME.AS");
    });

    it("keeps sourceSymbol null where there is none", async () => {
      const store = await make();
      const p = await store.portfolios.create("p");
      const tx = await store.transactions.add(p.id, {
        symbol: "EUR", assetType: "cash", side: "income", quantity: 4.5,
        price: 0, fee: 0, time: 1_700_000_000_000,
        nativeCurrency: "EUR", nativePrice: 1, nativeFee: null,
        sourceSymbol: null, note: "bank interest",
      });
      expect(tx.sourceSymbol).toBeNull();
    });
```

This runs against **both** `MemoryStore` and the app's `PrismaStore` — that is
the whole point of the contract, and it is what catches a Prisma mapping that
drops the column.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run packages/data/src/testing packages/data/src/store`
Expected: a type error on `sourceSymbol` — it is not on `NewTransaction` yet.

- [ ] **Step 3: The schema and the migration**

In `apps/web/prisma/schema.prisma`, on `Transaction`:

```prisma
  assetType   String    @default("crypto") // "crypto" | "equity" | "cash"
  side        String    // "buy" | "sell" | "transfer_in" | "transfer_out" | "income"
  ...
  /// The security an income row is attributed to — a Shell dividend is EUR
  /// credited against ACME.AS, and the share count does not move. Null for
  /// income with no source (bank interest) and for every other side.
  sourceSymbol String?
```

Run, **from `apps/web`**:

```bash
npx prisma migrate dev --name add-transaction-source-symbol
```

Then, from the repository root:

```bash
npx prisma generate
```

Expected: one `ALTER TABLE "Transaction" ADD COLUMN "sourceSymbol" TEXT;`.
Read the generated SQL before continuing. SQLite's migration engine sometimes
rewrites a whole table; a plain `ADD COLUMN` is what a nullable column should
produce, and anything else on a table holding 400 real rows needs a look.

- [ ] **Step 4: The port**

In `packages/data/src/ports/store.ts`:

```ts
export type Side = "buy" | "sell" | "transfer_in" | "transfer_out" | "income";
```

and on `Transaction`:

```ts
  /**
   * The security an income row is attributed to. A dividend is cash credited
   * against `ACME.AS`; the position does not move, which is why this is a
   * separate field rather than the row's `symbol`. Null for every other side,
   * and for income with no source — bank interest is not paid by anything.
   */
  sourceSymbol: string | null;
```

Update the `Side` doc to say what `income` means, mirroring the schema comment.

- [ ] **Step 5: Both stores**

`apps/web/src/lib/store/prisma-store.ts` — add `sourceSymbol: row.sourceSymbol`
to `toTransaction` (line ~43 area), `sourceSymbol: tx.sourceSymbol` to the create
mapping (~line 59), and `sourceSymbol: patch.sourceSymbol` to the patch mapping
(~line 77).

`packages/data/src/testing/memory-store.ts` — the same three places. If it spreads
the input object wholesale, confirm by reading rather than assuming: the contract
test above is what proves it either way.

- [ ] **Step 6: Run the contract against both**

Run: `npx vitest run packages/data`
Expected: PASS, both implementations.

- [ ] **Step 7: Commit**

```bash
git add apps/web/prisma packages/data/src/ports/store.ts \
        apps/web/src/lib/store/prisma-store.ts \
        packages/data/src/testing/memory-store.ts \
        packages/data/src/testing/store-contract.ts
git commit -m "Give a transaction a source security, and both stores a way to keep it"
```

---

### Task 5: Through the seam — input, service, route, client

**Files:**
- Modify: `packages/data/src/client/data-client.ts:286-324` (`TransactionDto`, `NewTransactionInput`)
- Modify: `apps/web/src/app/api/portfolios/tx.ts` (`TxInput`, `TxPatch`, `serializeTx`)
- Modify: `apps/web/src/app/api/portfolios/[id]/transactions/route.ts:18-29`
- Modify: `packages/data/src/services/transactions.ts` (`inUsd`)
- Test: `packages/data/src/client/client-contract.ts`

**Interfaces:**
- Consumes: `Side`, `Transaction.sourceSymbol` from Task 4.
- Produces: `NewTransactionInput` gains
  `assetType?: "crypto" | "equity" | "cash"` (default `"crypto"`) and
  `sourceSymbol?: string | null`. Task 7's form builds it.

- [ ] **Step 1: Write the failing contract case**

In `packages/data/src/client/client-contract.ts`:

```ts
    it("records income as cash against its source, converting nothing", async () => {
      const client = makeClient();
      const p = await client.createPortfolio("income");
      const tx = await client.addTransaction(p.id, {
        symbol: "EUR", assetType: "cash", side: "income", quantity: 120,
        price: 0, fee: 0, time: Date.UTC(2025, 5, 2),
        nativeCurrency: "EUR", nativePrice: 1, sourceSymbol: "ACME.AS",
      });
      expect(tx.side).toBe("income");
      expect(tx.sourceSymbol).toBe("ACME.AS");
      // A cash row is worth one unit of itself. `usdRateOn` must not have been
      // asked to convert it — FakeNet throws on an unmatched URL, so a rate
      // lookup that happened anyway fails this outright.
      expect(tx.quantity).toBe(120);
    });
```

That last comment is the assertion that matters: `FakeNet` throws on any URL it
was not scripted for, so "no conversion happened" is checkable rather than
assumed.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run packages/data/src/client`
Expected: FAIL for both `HttpClient` and the stub — `assetType` and
`sourceSymbol` are not on `NewTransactionInput`.

- [ ] **Step 3: The input type**

In `data-client.ts`, on `NewTransactionInput`:

```ts
  /**
   * What kind of thing this row is about. Defaults to `"crypto"`, which is what
   * every manual entry meant before cash existed, so an omitted field keeps its
   * old behaviour exactly.
   *
   * `"cash"` is money itself: `symbol` is the currency, `quantity` the amount,
   * `price` 0. Every cash consumer — balances, the audit, the value series —
   * already reads that shape, because the importer has written it for fiat
   * deposits all along.
   */
  assetType?: "crypto" | "equity" | "cash";
  /**
   * The security an `income` row is attributed to. Null or absent for
   * everything else, and for income with no source.
   */
  sourceSymbol?: string | null;
```

and add `sourceSymbol: string | null` to `TransactionDto`.

- [ ] **Step 4: The Zod schema and the route**

In `apps/web/src/app/api/portfolios/tx.ts`, extend `TxInput`:

```ts
  assetType: z.enum(["crypto", "equity", "cash"]).optional(),
  sourceSymbol: z.string().min(1).max(32).nullable().optional(),
```

and widen the `side` enum to include `"income"`.

**`TxPatch` needs care.** `carried-forward.md` records that `PATCH` once zeroed
every fee because Zod applied a default through `.partial()`. Add the two fields
to `TxPatch` **without defaults**, and extend the existing regression test:

```ts
    it("stays empty for an empty body", () => {
      expect(TxPatch.parse({})).toEqual({});
    });
```

In the POST route, replace the placeholder comment and its hard-coded value:

```ts
      // Was pinned to "crypto" with a note saying cash and income arrive with a
      // later plan. This is that plan.
      assetType: body.data.assetType ?? "crypto",
      sourceSymbol: body.data.sourceSymbol?.toUpperCase() ?? null,
```

Add `sourceSymbol` to `serializeTx`.

- [ ] **Step 5: The service must not convert a cash row**

In `packages/data/src/services/transactions.ts`, at the top of `inUsd`:

```ts
  // A cash row is worth one unit of itself: EUR 120 is EUR 120, and its
  // `nativePrice` of 1 is a statement of that, not a price to convert. Running
  // it through `usdRateOn` would multiply the amount by the exchange rate and
  // store a euro balance as a dollar one.
  if (tx.assetType === "cash") return tx;
```

This guard is the reason Task 5 has a test asserting `FakeNet` was never called.
Without it, `nativeCurrency: "EUR"` on a cash row triggers exactly the conversion
that `cashBalances` then double-counts.

- [ ] **Step 6: Run the contract against both implementations**

Run: `npx vitest run packages/data && npm run typecheck`
Expected: PASS, and the stub client over `MemoryStore` passes the same case —
which is what proves the interface is not HTTP-shaped.

- [ ] **Step 7: Commit**

```bash
git add packages/data/src/client packages/data/src/services/transactions.ts \
        apps/web/src/app/api/portfolios/tx.ts \
        "apps/web/src/app/api/portfolios/[id]/transactions/route.ts"
git commit -m "Carry assetType and a source security across the seam"
```

---

### Task 6: The importer stops dropping dividends

**Files:**
- Modify: `packages/core/src/delta-csv.ts:41-59` (`SIDE_MAP`), `:214-238` (the side and price derivation), `:253-270` (the cash branch)
- Test: `packages/core/src/delta-csv.test.ts`

**Interfaces:**
- Consumes: `TxSide` from Task 1.
- Produces: `ParsedTx` gains `sourceSymbol?: string`, read by the import service.

- [ ] **Step 1: GATE — answered, 2026-08-24**

The gate was to read a real `DIVIDEND` row before writing the mapping, because
this repo held no Delta CSV and the column layout was not knowable from the
code. It is now answered from `dickwolff/Export-To-Ghostfolio`, which ships a
documented Delta export sample. The header:

```
Date,Way,Base amount,Base currency (name),Base type,Quote amount,Quote currency,
Exchange,Sent/Received from,Sent to,Fee amount,Fee currency (name),Broker,Notes
```

and its dividend row:

```
2023-05-08 15:00:00-04:00,DIVIDEND,,AAPL,STOCK,2.5,USD,Nasdaq,,,0.5,USD,eToro,...
```

Three answers, and a fourth thing nobody asked:

1. **The security is in `Base currency`** — `AAPL`.
2. **The cash amount and currency are in `Quote amount`/`Quote currency`** —
   `2.5 USD`. This is what §6 assumed, and it is right.
3. **Delta writes `DIVIDEND`.** Map `DIVIDENDS` too; it costs nothing.
4. **`Base amount` is EMPTY on a dividend row**, and it carries a **fee**
   (`0.5 USD`). Neither was anticipated. Both change the implementation — see
   Steps 4a and 4b.

Still verify against the owner's own export before shipping: this sample is
Delta's documented shape, not a stranger's real file, so it answers the layout
question but is not Phase 0.

- [ ] **Step 2: Write the failing test**

Using the real header from Step 1:

```ts
describe("income rows", () => {
  it("imports a dividend as cash attributed to the security", () => {
    const csv = [
      "Date,Type,Base amount,Base currency,Quote amount,Quote currency",
      "2025-03-20 10:00:00,DIVIDEND,0,ACME.AS,120.50,EUR",
    ].join("\n");
    const { rows, skipped } = parseDeltaCsv(csv);
    expect(skipped).toEqual([]);
    expect(rows[0]).toMatchObject({
      symbol: "EUR", assetType: "cash", side: "income",
      quantity: 120.5, price: 0, nativeCurrency: "EUR", nativePrice: 1,
      sourceSymbol: "ACME.AS",
    });
  });

  it("imports bank interest as income with no source", () => {
    const csv = [
      "Date,Type,Base amount,Base currency",
      "2025-03-20 10:00:00,INTEREST,4.50,EUR",
    ].join("\n");
    const { rows } = parseDeltaCsv(csv);
    expect(rows[0]).toMatchObject({
      symbol: "EUR", assetType: "cash", side: "income", quantity: 4.5,
      sourceSymbol: undefined,
    });
  });

  it("keeps a staking reward a delivery, and gives it the price the export names", () => {
    const csv = [
      "Date,Type,Base amount,Base currency,Quote amount,Quote currency",
      "2025-03-20 10:00:00,STAKING,10,ETH,25000,USDT",
    ].join("\n");
    const { rows } = parseDeltaCsv(csv);
    // A reward is shares arriving, not cash — inbound delivery, priced.
    expect(rows[0]).toMatchObject({
      symbol: "ETH", assetType: "crypto", side: "transfer_in", price: 2500,
    });
  });
});
```

That third case is a **behaviour change**: today `if (mapped === "income")
{ price = 0; pendingQuote = undefined; }` zeroes it. The spec says deliveries
"gain a price where the export gives one".

- [ ] **Step 3: Run and watch them fail**

Run: `npx vitest run packages/core/src/delta-csv.test.ts`
Expected: FAIL — the dividend is `skipped` as `unsupported type "DIVIDEND"`, and
the staking row has `price: 0`.

- [ ] **Step 4: Split the marker**

```ts
/**
 * Delta's vocabulary, mapped to ours. Two of the values are markers rather than
 * sides, resolved below once the row's numbers have been read:
 *
 * - `"transfer"` — direction comes from the sign of the base amount.
 * - `"delivery"` — an asset arriving without a purchase: a staking reward, an
 *   airdrop, a share grant. `transfer_in` has carried a cost-basis price all
 *   along, so these need no side of their own; they only need the price the
 *   export already names, which this importer used to throw away.
 * - `"income"` — cash credited against a security. A dividend does not move a
 *   share count, so it cannot be a delivery of anything.
 */
const SIDE_MAP: Record<string, TxSide | "income" | "transfer" | "delivery"> = {
  TRANSFER: "transfer",
  BUY: "buy",
  SELL: "sell",
  DEPOSIT: "transfer_in",
  RECEIVE: "transfer_in",
  "TRANSFER IN": "transfer_in",
  TRANSFER_IN: "transfer_in",
  WITHDRAW: "transfer_out",
  WITHDRAWAL: "transfer_out",
  SEND: "transfer_out",
  "TRANSFER OUT": "transfer_out",
  TRANSFER_OUT: "transfer_out",
  INCOME: "delivery",
  STAKING: "delivery",
  REWARD: "delivery",
  AIRDROP: "delivery",
  MINING: "delivery",
  DIVIDEND: "income",
  DIVIDENDS: "income",
  INTEREST: "income",
};
```

Note `INCOME` maps to `"delivery"`, not to `"income"`. Delta's `INCOME` type is
its catch-all for an asset arriving, and it has always been imported as a
transfer; re-pointing it at cash would silently reclassify existing rows on the
owner's next import. **Ruling: `INCOME` stays a delivery.** Cost if wrong: a
Delta user whose export uses `INCOME` for cash gets a crypto row named after
their currency — visible immediately, and the same thing that happens today.

- [ ] **Step 4a: The income branch must sit ABOVE the base-amount guard**

**This plan had it in the wrong place, and the sample proved it.** The parser
reads the base amount and rejects the row before anything else happens:

```ts
const rawAmount = num(cell(cols.baseAmount));
const quantity = Math.abs(rawAmount);
if (!Number.isFinite(quantity) || quantity <= 0) {
  skipped.push({ line, reason: `invalid base amount "${cell(cols.baseAmount)}"` });
  continue;
}
```

A dividend row's `Base amount` is empty, so `quantity` is `NaN` and the row is
skipped there — **before** the income branch this plan originally placed further
down. Verified against the real row on 2026-08-24: with `DIVIDEND` mapped, the
skip reason changes from `unsupported type "DIVIDEND"` to
`invalid base amount ""`, and the dividend is still lost. A fix that only adds
the side would look correct, pass a mapping test written against a row with a
base amount, and drop every real dividend.

So the income branch goes **immediately after the date parse and before the
base-amount read**, and takes its quantity from the quote side:

```ts
    if (mapped === "income") {
      // A dividend names the security in the base column and the money in the
      // quote columns, and leaves `Base amount` empty — so this must run before
      // the base-amount guard below, which would reject the row as malformed.
      ...
    }
```

Reorder the date parse above it too, since the branch needs `time`.

- [ ] **Step 4b: A dividend can carry a fee**

Delta's sample dividend has `Fee amount 0.5`, `Fee currency USD`. An income row
as §6 specifies it has `fee: 0`, and `cashBalances` credits `quantity` outright,
so that fee would vanish.

**Ruling: store the gross in `quantity` and the fee in `fee`, and teach
`cashBalances` to credit `quantity - fee`.** Both figures stay truthful and the
ledger shows what was withheld. It is safe for every existing row: a cash
deposit today always has `fee: 0`, so the subtraction is a no-op everywhere
except the rows this epic introduces. Add the case to Task 2's tests:

```ts
  it("credits a dividend net of its fee", () => {
    expect(cashBalances([{ assetType: "cash", side: "income", quantity: 2.5,
                           fee: 0.5, nativeCurrency: "USD" }])).toEqual({ USD: 2 });
  });
```

`CashRelevantTx` gains `fee: number`. Cost if wrong: a dividend reads €0.50 high
and the fee is invisible — which is what happens if this step is skipped.

- [ ] **Step 5: Resolve the side, and the income branch**

Replace the side resolution (currently `if (mapped === "income") side = "transfer_in"`):

```ts
    let side: TxSide;
    if (mapped === "delivery") side = "transfer_in";
    else if (mapped === "income") side = "income";
    else if (mapped === "transfer") side = rawAmount < 0 ? "transfer_out" : "transfer_in";
    else side = mapped;
```

Delete the `if (mapped === "income") { price = 0; pendingQuote = undefined; }`
line: a delivery now keeps whatever price the export gave, and an income row does
not reach the price derivation at all because of the branch below.

Add the income branch **before** the existing `if (isCash)` block:

```ts
    if (mapped === "income") {
      // Cash credited against a security. The amount and its currency come from
      // the quote side; the base column names what paid it — except for bank
      // interest, where the base column IS the currency and there is no source.
      const currency = STABLES.has(quoteCurrency) || isFiat(quoteCurrency)
        ? quoteCurrency : baseCurrency;
      const amount = currency === baseCurrency ? quantity : quoteAmount;
      if (!isFiat(currency) && !STABLES.has(currency)) {
        skipped.push({ line, reason: `income in ${currency}, which is not money` });
        continue;
      }
      rows.push({
        symbol: currency,
        assetType: "cash",
        base: currency,
        venue: cell(cols.venue),
        side: "income",
        quantity: amount,
        price: 0,
        fee: 0,
        time,
        nativeCurrency: currency,
        nativePrice: 1,
        sourceSymbol: currency === baseCurrency ? undefined : baseCurrency,
      });
      continue;
    }
```

Add `sourceSymbol?: string;` to `ParsedTx`, documented as "the security an
income row is attributed to; absent for interest."

- [ ] **Step 6: Run the tests**

Run: `npx vitest run packages/core/src/delta-csv.test.ts`
Expected: PASS, including every existing case. If an existing test now sees a
priced staking row where it expected 0, that is Step 2's intended change — update
the expectation and say so in the commit, do not revert the behaviour.

- [ ] **Step 7: Carry `sourceSymbol` through the import service**

Find where `ParsedTx` becomes a `NewTransaction`:

```bash
grep -rn "pendingQuote\|ParsedTx" packages/data/src/services/transfer.ts
```

Add `sourceSymbol: row.sourceSymbol ?? null` to the mapping. Without this the
importer parses the field and then drops it one layer later — the kind of gap
`livePrice` already demonstrated in this codebase, where a feature looks finished
and is never read.

- [ ] **Step 8: Run everything and commit**

Run: `npx vitest run packages/core packages/data && npm run typecheck`

```bash
git add packages/core/src/delta-csv.ts packages/core/src/delta-csv.test.ts \
        packages/data/src/services/transfer.ts
git commit -m "Import dividends instead of dropping them, and price a delivery"
```

---

### Task 7: The form

**Files:**
- Modify: `packages/ui/src/tx-fields.ts` (`TxFields`, `NewTx`, `toNewTx`)
- Modify: `packages/ui/src/TxForm.tsx`
- Modify: `apps/web/src/app/ledger/page.tsx` (offer the cash mode where there is no locked symbol)
- Test: `packages/ui/src/tx-fields.test.ts`

**Interfaces:**
- Consumes: `NewTransactionInput` from Task 5.
- Produces: `NewTx` gains `assetType` and `sourceSymbol`; the asset page's
  `addTransaction` already forwards the whole object, so it needs no change.

**Why the tests live in `tx-fields.ts` and not in the component:**
`@testing-library/react` is not installed, there is no jsdom environment, and
this repo has zero component tests. Rather than add a test stack as a drive-by,
the pure logic sits in `tx-fields.ts` where plain Vitest reaches it — the same
split the merged §1–§4 work already established. **The markup is verified by
hand in Task 8, not by a test that does not exist.**

- [ ] **Step 1: Write the failing tests**

In `packages/ui/src/tx-fields.test.ts`:

```ts
describe("cash and income", () => {
  it("builds a cash deposit from an amount and a currency", () => {
    const tx = toNewTx({
      mode: "cash", symbol: "EUR", side: "transfer_in", quantity: "500",
      price: "", fee: "", when: "2025-06-02T10:00", currency: "EUR", sourceSymbol: "",
    })!;
    expect(tx).toMatchObject({
      symbol: "EUR", assetType: "cash", side: "transfer_in", quantity: 500,
      price: 0, fee: 0, nativeCurrency: "EUR", nativePrice: 1, sourceSymbol: null,
    });
  });

  it("attributes income to its source security, uppercased", () => {
    const tx = toNewTx({
      mode: "cash", symbol: "EUR", side: "income", quantity: "120.50",
      price: "", fee: "", when: "2025-06-02T10:00", currency: "EUR",
      sourceSymbol: "shell.as",
    })!;
    expect(tx).toMatchObject({ side: "income", quantity: 120.5, sourceSymbol: "ACME.AS" });
  });

  it("leaves the source null when none is given", () => {
    const tx = toNewTx({
      mode: "cash", symbol: "EUR", side: "income", quantity: "4.5",
      price: "", fee: "", when: "2025-06-02T10:00", currency: "EUR", sourceSymbol: "  ",
    })!;
    expect(tx.sourceSymbol).toBeNull();
  });

  it("still builds a trade exactly as before", () => {
    const before = toNewTx({
      mode: "trade", symbol: "ETH", side: "buy", quantity: "2", price: "2000",
      fee: "1", when: "2025-06-02T10:00", currency: "EUR", sourceSymbol: "",
    })!;
    expect(before).toMatchObject({
      symbol: "ETH", assetType: "crypto", price: 2000, nativePrice: 2000, sourceSymbol: null,
    });
  });
});
```

That last case is the regression guard: adding a mode must not change what the
old mode produces.

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run packages/ui/src/tx-fields.test.ts`
Expected: FAIL — `mode` and `sourceSymbol` are not on `TxFields`.

- [ ] **Step 3: Implement `tx-fields.ts`**

```ts
export type TxMode = "trade" | "cash";

export type NewTx = {
  symbol: string;
  assetType: "crypto" | "equity" | "cash";
  side: "buy" | "sell" | "transfer_in" | "transfer_out" | "income";
  quantity: number;
  price: number;
  fee: number;
  time: number;
  nativeCurrency: string | null;
  nativePrice: number;
  nativeFee: number;
  sourceSymbol: string | null;
};

/**
 * A cash row is money itself: one unit is worth one unit, so `price` is 0 and
 * `nativePrice` is 1 — the shape the importer has written for fiat deposits
 * since it was first written, and the shape every cash consumer reads.
 *
 * The amount goes in `quantity`. That is why the cash mode hides the price
 * field entirely rather than defaulting it: a price box beside an amount box is
 * an invitation to type the amount twice.
 */
export function toNewTx(f: TxFields): NewTx | null {
  if (f.mode === "cash") {
    const quantity = Number(f.quantity);
    const time = Date.parse(f.when);
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(time)) return null;
    if (!f.currency) return null;
    const source = f.sourceSymbol.trim().toUpperCase();
    return {
      symbol: f.currency, assetType: "cash", side: f.side,
      quantity, price: 0, fee: 0, time,
      nativeCurrency: f.currency, nativePrice: 1, nativeFee: 0,
      sourceSymbol: f.side === "income" && source ? source : null,
    };
  }
  /* ...the existing trade path, unchanged, plus `assetType` and
     `sourceSymbol: null` on its returned object... */
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/ui/src/tx-fields.test.ts`
Expected: PASS, all four.

- [ ] **Step 5: The component**

In `TxForm.tsx`:

- A `Segmented` control — the established component, see `BRAND.md` — offering
  **Trade** and **Cash**, shown only when `lockedSymbol` is absent. On an asset's
  own page the ticker is decided and a cash mode there would be recording a
  euro deposit against Ethereum.
- In cash mode: hide the symbol picker, the price field, the fee field and the
  quote picker. Show **Amount**, a **Currency** `<select>` over
  `[...FIAT].concat("USD").sort()` from `packages/core/src/currencies.ts`, and a
  **Side** `<select>` of Deposit (`transfer_in`) / Withdrawal (`transfer_out`) /
  Income (`income`).
- When the side is `income`, show one more field: **Paid by (optional)**, a
  `SymbolPicker`, placeholder `ACME.AS`.
- The price prefill button stays in trade mode only — there is no live price for
  a cash amount.

Copy, per `BRAND.md`: sentence case, no exclamation marks, and the labels say
what the field is rather than what the system calls it — "Amount", not
"Quantity", in cash mode.

- [ ] **Step 6: Verify by hand**

`npm run dev`, then on `/ledger`:

1. Switch to Cash. The symbol, price, fee and quote controls disappear.
2. Add a €500 deposit. It appears in the ledger and in the cash balance.
3. Switch the side to Income; the "Paid by" field appears. Add €120 from
   `ACME.AS`.
4. Check the portfolio screen: cash is up €620, **`ACME.AS`'s quantity, cost
   basis and average cost are unchanged.** That last one is the whole point.
5. Switch back to Trade and add a normal ETH buy. It behaves exactly as before.

- [ ] **Step 7: Lint and commit**

Run: `npm run lint`
Expected: exactly **21** errors, unchanged. A new `react-hooks/set-state-in-effect`
means the mode switch is setting state during render — move it into an effect or
derive it, do not add to the count.

```bash
git add packages/ui/src/tx-fields.ts packages/ui/src/tx-fields.test.ts \
        packages/ui/src/TxForm.tsx apps/web/src/app/ledger/page.tsx
git commit -m "Let a person type a deposit, a withdrawal or a dividend"
```

---

### Task 8: Verify against real data

**Files:**
- No source changes. Evidence, and one documentation commit.

- [ ] **Step 1: Full suite, typecheck, lint**

```bash
npx vitest run && npm run typecheck && npm run lint
```
Expected: all tests pass (587 plus everything added here), typecheck clean, lint
at exactly 21.

- [ ] **Step 2: Copy the database and run a second server**

```bash
cp apps/web/prisma/dev.db /tmp/cash-income.db
npm run build && DATABASE_URL="file:/tmp/cash-income.db" npm run start -- -p 3001
```

Build and restart in the **same** command with nothing else in it.

- [ ] **Step 3: Prove the migration changed no figure**

Before adding anything, compare the two servers' valuations for every portfolio:

```bash
node scripts/parity.mjs capture /tmp/baseline.json /api/portfolios /api/portfolios/<id>/valuation /api/portfolios/<id>/insights
```

Expected: identical `quantity`, `costBasis`, `avgCost` per holding. A nullable
column added to 400 rows must be invisible. **Capture and compare on the same UTC
day** — every windowed endpoint is anchored to "now".

**What this cannot catch**, and it matters more than the green tick: a constant
proportional shift. The `rel` bounds are per-leaf and relative, so an error
scaling every figure by the same small factor passes all of them. Check two or
three absolute figures by hand as well.

- [ ] **Step 4: The parity test that is actually worth having**

Add a dividend two ways against the copy and confirm they agree:

1. Type €120 from `ACME.AS` into the form.
2. Import a one-row CSV with the same dividend.

Both must produce the same row: `assetType: "cash"`, `side: "income"`,
`quantity: 120`, `nativeCurrency: "EUR"`, `nativePrice: 1`,
`sourceSymbol: "ACME.AS"`, `price: 0`.

This is the assertion that §6 closed the gap rather than adding a second,
differently-wrong path. The same check on the trade path is what caught the
native-currency bug in the merged §2 work.

- [ ] **Step 5: Check the four consumers by hand**

With the dividend and a €500 deposit in place on the copy:

| Screen | Expected |
|---|---|
| `/portfolio` | cash +€620; `ACME.AS` quantity, cost basis and average cost **unchanged** |
| `/ledger` | both rows listed, the dividend showing its source |
| `/insights` | trade counts unchanged; the dividend is not a "transfer" |
| the ledger audit | no `underfunded-currency` finding created by the credit |

- [ ] **Step 6: Export and restore**

Export a backup from the copy, then restore it into a scratch portfolio. It must
round-trip with `sourceSymbol` intact. **A backup that cannot be restored is a
one-way door, and this is the only step that opens it.**

Then export the Ghostfolio CSV and confirm the dividend row reads
`ACME.AS,DIVIDEND,1,120,...`.

- [ ] **Step 7: Stop the second server**

Kill it **by port**:

```bash
kill "$(lsof -t -i:3001)"
```

- [ ] **Step 8: Update the documentation**

- `CLAUDE.md`: the `Transaction.side` vocabulary, and one line under
  Conventions saying an income row is a cash row attributed to a security.
- `docs/carried-forward.md`: move the two §6 bullets ("Dividends are dropped at
  import", "Cash cannot be added by hand") from "Designed, not built" into
  "Resolved". Leave the equity-alerts bullet where it is — that is the other
  plan.
- Record the two spec corrections from the top of this plan, so the next reader
  of §6 does not re-derive them.

```bash
git add CLAUDE.md docs/carried-forward.md
git commit -m "Write down that cash and income exist"
```

---

### Task 9 (beyond §6's letter): income by source in Insights

**Flagged deliberately.** The spec does not ask for this, and it is not in "Out of
scope" either. Without it `sourceSymbol` is stored, exported and never shown —
a field whose only reader is a CSV. Attribution was the entire argument for
`income` being its own side (spec decision 8, which rejected plain cash precisely
because it "cannot answer the question that motivated the section").

Skip this task if a reviewer judges it out of scope. Nothing in Tasks 1–8 depends
on it.

**Files:**
- Modify: `packages/core/src/insights.ts`
- Modify: `packages/data/src/services/valuation.ts:384` (stop filtering cash out of *this* one call)
- Modify: `apps/web/src/app/insights/page.tsx`
- Test: `packages/core/src/insights.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("incomeBySource", () => {
  it("groups income by the security that paid it", () => {
    const txs = [
      { symbol: "EUR", side: "income" as const, quantity: 120, price: 0, fee: 0,
        time: 1, sourceSymbol: "ACME.AS" },
      { symbol: "EUR", side: "income" as const, quantity: 80, price: 0, fee: 0,
        time: 2, sourceSymbol: "ACME.AS" },
      { symbol: "EUR", side: "income" as const, quantity: 4.5, price: 0, fee: 0,
        time: 3, sourceSymbol: null },
    ];
    expect(incomeBySource(txs)).toEqual([
      { symbol: "ACME.AS", total: 200 },
      { symbol: null, total: 4.5 },
    ]);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run packages/core/src/insights.test.ts`
Expected: FAIL — `incomeBySource` is not defined.

- [ ] **Step 3: Implement**

```ts
/**
 * What each holding has paid out, largest first, with unattributed income
 * (bank interest) last under a null symbol.
 *
 * Amounts are already in the display currency: an income row's `quantity` is
 * the amount and `toDisplayTxs` has converted it, so nothing is re-priced here.
 */
export function incomeBySource(
  txs: (Tx & { sourceSymbol?: string | null })[],
): { symbol: string | null; total: number }[] {
  const by = new Map<string | null, number>();
  for (const t of txs) {
    if (t.side !== "income") continue;
    const key = t.sourceSymbol ?? null;
    by.set(key, (by.get(key) ?? 0) + t.quantity);
  }
  return [...by.entries()]
    .map(([symbol, total]) => ({ symbol, total }))
    .sort((a, b) =>
      a.symbol === null ? 1 : b.symbol === null ? -1 : b.total - a.total);
}
```

- [ ] **Step 4: Wire the service**

`insights()` in `valuation.ts` filters cash out before `tradeStats`. That filter
must stay for the trade statistics — it is there because "moving euros between a
bank and an exchange is not a trade" — so pass the **unfiltered** rows to
`incomeBySource` only:

```ts
  const cashTxs = toDisplayTxs(
    portfolio.transactions.filter((t) => t.side === "income"),
    currency, toDisplay,
  );
  // ... and in the returned object:
  income: incomeBySource(cashTxs.map((t, i) => ({
    ...t, sourceSymbol: portfolio.transactions.filter((r) => r.side === "income")[i]!.sourceSymbol,
  }))),
```

That index-pairing is fragile. **Prefer widening `toDisplayTxs` to carry
`sourceSymbol` through** — one optional field on `StoredTx` and on its output —
so the two arrays never have to be zipped by position. Do it that way.

Add `income` to the `Insights` type and to `DataClient`'s `Insights` DTO.

- [ ] **Step 5: The panel**

One row in the Activity section of `/insights`: "Income — €204.50", with the
per-source breakdown beneath it. Use the existing `StatTile` and `SubHeading`;
do not invent a fourth heading tier — one was already removed once.

Draw nothing when `income` is empty. `EmptyState` owns the empty tier, and an
empty panel that says "no income yet" on a ledger that never will have any is
noise.

- [ ] **Step 6: Run, lint, commit**

```bash
npx vitest run && npm run typecheck && npm run lint
git add packages/core/src/insights.ts packages/core/src/insights.test.ts \
        packages/data/src apps/web/src/app/insights/page.tsx
git commit -m "Show what each holding has paid out"
```

---

## Self-review

**Spec coverage.** Every requirement in §6 maps to a task:

| §6 requirement | Task |
|---|---|
| `NewTransactionInput` gains `assetType` | 5 |
| `transfer_in` keeps its meaning, gains a price at import | 6 |
| A new `income` side, cash attributed to a security | 1, 4 |
| `sourceSymbol` nullable | 4, 6, 7 |
| Cost basis untouched by income | 1 (its first test) |
| Importer stops dropping `DIVIDEND`; `INTEREST` → income | 6 |
| `STAKING`/`REWARD`/`AIRDROP`/`MINING` stay `transfer_in` | 6 |
| Ghostfolio export emits `DIVIDEND` | 3 |
| Every consumer that switches on `side` is taught the new one | 1, 2, 3 |
| A "Cash / income" mode in `TxForm` | 7 |
| Existing rows are not migrated | — deliberately no task |
| The two Shell rows, separately | separate plan |

The spec's testing section is covered too: the contract entries in Tasks 4 and 5,
the parity-between-entry-paths check in Task 8 Step 4. `listQuotes` already
shipped with §3.

**Type consistency.** `TxSide` (Task 1), `Side` (Task 4) and `NewTx["side"]`
(Task 7) are three names for the same union and all five members are spelled
identically in each. `sourceSymbol` is `string | null` on the port and the DTO,
`string | undefined` on `ParsedTx` (matching its sibling optional fields), and
normalised to `null` at exactly one place — the route, Task 5 Step 4.

**Two things this plan asserts that the spec does not, both flagged inline:**
`INCOME` stays a delivery rather than becoming cash (Task 6 Step 4), and a
Ghostfolio dividend is emitted as `1 × amount` (Task 3 Step 3). Both carry their
reasoning and their cost-if-wrong.

**The one gate.** Task 6 Step 1 stops and reads a real Delta export before
writing the dividend mapping. There is no CSV sample in this repo, so the column
layout of a `DIVIDEND` row is genuinely unknown — and a mapping guessed from the
`BUY` row's shape would import every dividend into the wrong column pair and
report success.
