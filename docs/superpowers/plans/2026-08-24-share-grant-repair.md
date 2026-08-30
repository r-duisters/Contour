# Shell employee-share repair — Implementation Plan

> **The figures in this document are illustrative.** It described a repair to a
> real ledger, and the amounts, quantities and ticker have been replaced with
> invented ones that preserve the arithmetic the argument depends on. The
> reasoning is unchanged; the numbers are not anybody's positions.

> **Done, 2026-08-24.** Applied to the live database after verification against
> a copy. Two things in the plan below were wrong and are corrected in place,
> marked **[corrected]**: the rows were `buy` rather than `transfer_in`, so the
> repair changes the side too; and the projected cost-basis and average-cost
> figures ignored that later sells draw basis down at the new average.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give two `ACME.AS` employee-share-grant rows the cost basis they were
granted at, so the position stops reporting a €12.00 average cost that Shell has
never traded near.

**Architecture:** A one-off script under `scripts/`, dry-run by default, in the
shape of `scripts/migrate-symbols.mjs`. It changes two rows and adds no feature:
`transfer_in` already carries a cost-basis price (`packages/core/src/portfolio.ts:9`,
and `computeHoldings` adds `quantity * price` for a `transfer_in`). Nothing in
`packages/core`, `packages/data`, `packages/ui` or `apps/web` is touched.

**Tech Stack:** Node + `tsx`, Prisma 6 against the SQLite file, `usdRateOn` from
`packages/data/src/services/pricing.ts` over `WebNet`.

**Spec:** `docs/superpowers/specs/2026-08-24-asset-actions-design.md` §6, "Existing
rows are not migrated" — the two-row exception the owner asked for.

## Global Constraints

- **Never run a write pass against `apps/web/prisma/dev.db` before it has run
  green against a copy.** Copy the file, point a second server at the copy, and
  do the whole verification there first. This is a standing rule in this repo.
- **Take a fresh snapshot immediately before the real write**, not the copy made
  an hour earlier.
- **Never commit `apps/web/prisma/dev.db` or any dated copy of it.**
  `.gitignore` covers `**/prisma/dev.db.*`; do not defeat it with `git add -f`.
- `npm run typecheck` — never bare `npx tsc --noEmit`.
- `npm run lint` must stay at exactly **21** pre-existing errors. `scripts/` is
  not a workspace and is not linted, so a new script cannot change that number.
- **The stored `price` column is USD.** The grant prices below are euros. A
  script that writes 25.00 into `price` overstates the basis by the USD/EUR
  rate — the exact bug §2 of the spec was written to end.
- The figures below were computed on 2026-08-24 and shown to the owner. Treat
  them as *expected values to assert against*, not as inputs to trust blindly:
  the script recomputes and refuses if what it finds disagrees.

**The two rows, and what they become:**

| Date | Shares | Trading day priced from | Close | Value |
|---|---|---|---|---|
| 2025-01-01 | 300.0 | 2024-12-31 (1 Jan is a market holiday) | €25.005 | €7,501.50 |
| 2026-01-09 | 20 | 2026-01-09 | €25.00 | €500.00 |

**[corrected]** The close is €25.005, not the €25.00 the design doc prints:
that table rounds for display but computed its totals from the full close, which
is why 300 × 25.00 does not reproduce its own €7,501.50.

**[corrected]** Actual effect, measured: quantity unchanged at 1,500.00; cost
basis €18,000.00 → **€26,001.50**; average cost €12.00 → **€17.33**; realised
P&L €15,000.00 → **€12,500.00**; unrealised €35,000.00 → **€29,498.50**. The
design doc predicted €34,798.47 and €21.71 by adding the grant value straight
onto the basis — but the 2025 grant precedes the Feb and Mar 2026 sells, so
those disposals now consume basis at the higher average and realise €2,500.00
less. **The holding's value does not move**, and realised plus unrealised falls
by exactly €8,001.50. Those two invariants are the strongest checks available
and Task 3 asserts both.

**[corrected] The rows are `buy`, not `transfer_in`.** The spec and this plan
both assumed otherwise, so a script querying `side: "transfer_in"` finds nothing
and refuses. It matters beyond the predicate: `ledger-audit` debits a `buy`
against its native currency, so pricing them as buys reports €8,001 leaving a
euro account that never held it (EUR shortfall €40,000.00 → €48,001.50). A grant
is an inbound delivery, so the repair writes `side: "transfer_in"` as well as the
price, and the audit then comes out byte-identical. Holdings figures are the same
either way — fees are zero, and both sides add `quantity × price` to basis.

**A caveat the owner owns, not this plan:** whether zero or market-value-at-vest
is the correct basis depends on the scheme's tax treatment. The owner instructed
the repair after seeing these figures. The dates are also approximate — a grant
dated 2025-01-01 did not vest on a market holiday, so €25.00 is the closest
honest price rather than the vest-day price. The script records that in the
row's `note` so a later reader is not misled.

---

### Task 1: The script, dry-run only

**Files:**
- Create: `scripts/repair-share-grants.mjs`

**Interfaces:**
- Consumes: `usdRateOn(net, currency, time)` from
  `packages/data/src/services/pricing.ts`; `WebNet()` from
  `apps/web/src/lib/net/web-net.ts`; `PrismaClient` from `@prisma/client`.
- Produces: nothing importable. Task 2 runs it; Task 3 verifies its effect.

- [ ] **Step 1: Write the script**

```js
/**
 * Price two ACME.AS employee-share grants that were imported at zero.
 *
 * They are real shares in the right quantity with no cost basis, which is why
 * the position reports an average cost of EUR 12.00 — a price Shell has not
 * traded at in the five years of history this app holds. 21% of the position
 * was recorded as free.
 *
 * This needs no new feature: `transfer_in` already carries a cost-basis price
 * (packages/core/src/portfolio.ts:9). It is a two-row data fix.
 *
 * Dry-run by default. `--apply` writes.
 *
 *   DATABASE_URL="file:$PWD/apps/web/prisma/dev.db" npx tsx scripts/repair-share-grants.mjs
 *   DATABASE_URL="file:$PWD/apps/web/prisma/dev.db" npx tsx scripts/repair-share-grants.mjs --apply
 *
 * `apps/web/.env` is read by the Prisma CLI, not by `tsx`, so DATABASE_URL has
 * to be named on the command line even from apps/web.
 */
import { PrismaClient } from "@prisma/client";
import { usdRateOn } from "../packages/data/src/services/pricing.ts";
import { WebNet } from "../apps/web/src/lib/net/web-net.ts";

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();
const net = WebNet();

/**
 * What each grant is worth, in euros, at the nearest trading day's close.
 * Hard-coded rather than fetched: these two prices were established with the
 * owner on 2026-08-24 and are the figures they approved. A refetch could
 * quietly return something else and repair the rows to a number nobody saw.
 */
const GRANTS = [
  { quantity: 300.0, on: "2025-01-01", pricedFrom: "2024-12-31", eur: 25.00 },
  { quantity: 20,  on: "2026-01-09", pricedFrom: "2026-01-09", eur: 25.00 },
];

const DAY = 86_400_000;
const dayOf = (ms) => Math.floor(ms / DAY) * DAY;

const candidates = await prisma.transaction.findMany({
  where: { symbol: "ACME.AS", side: "transfer_in", price: 0 },
  orderBy: { time: "asc" },
});

console.log(`Found ${candidates.length} zero-price ACME.AS transfer_in rows.`);

const plan = [];
for (const g of GRANTS) {
  const want = dayOf(Date.parse(`${g.on}T00:00:00Z`));
  const hits = candidates.filter(
    (r) => dayOf(Number(r.time)) === want && Math.abs(r.quantity - g.quantity) < 1e-6,
  );
  if (hits.length !== 1) {
    console.error(
      `REFUSING: expected exactly one ${g.quantity} ACME.AS row on ${g.on}, found ${hits.length}.`,
    );
    process.exit(1);
  }
  const row = hits[0];
  if (row.nativePrice) {
    console.error(`REFUSING: ${row.id} already carries nativePrice ${row.nativePrice}.`);
    process.exit(1);
  }

  const rate = await usdRateOn(net, "EUR", Number(row.time));
  if (rate === null) {
    console.error(`REFUSING: no EUR/USD rate for ${g.on}; the USD price column cannot be filled.`);
    process.exit(1);
  }

  plan.push({
    id: row.id,
    quantity: row.quantity,
    on: g.on,
    eur: g.eur,
    rate,
    price: g.eur * rate,
    valueEur: g.eur * row.quantity,
    note:
      `Employee share programme grant, priced at the ${g.pricedFrom} close ` +
      `(EUR ${g.eur}). Repaired 2026-08-24; the grant date is approximate.`,
  });
}

const total = plan.reduce((a, p) => a + p.valueEur, 0);
for (const p of plan) {
  console.log(
    `${p.on}  ${p.quantity} sh  EUR ${p.eur} x ${p.rate.toFixed(6)} = USD ${p.price.toFixed(4)}/sh` +
    `  -> EUR ${p.valueEur.toFixed(2)}`,
  );
}
console.log(`Total basis added: EUR ${total.toFixed(2)}`);

if (!APPLY) {
  console.log("\nDry run. Re-run with --apply to write.");
  await prisma.$disconnect();
  process.exit(0);
}

for (const p of plan) {
  await prisma.transaction.update({
    where: { id: p.id },
    data: { price: p.price, nativeCurrency: "EUR", nativePrice: p.eur, note: p.note },
  });
  console.log(`updated ${p.id}`);
}
await prisma.$disconnect();
```

Three refusals, and each is there because of a way this could go wrong
silently: more or fewer than one matching row means the ledger is not what the
figures were computed against; an existing `nativePrice` means the script has
already run and a second pass would re-rate an already-correct row; a null rate
means the USD column would be filled with a euro number.

- [ ] **Step 2: Verify it parses and the imports resolve**

Run: `npm run typecheck`
Expected: clean. `scripts/` is outside every workspace's `include`, so this
proves the repo still typechecks, not that the script does — Step 3 is what
actually exercises it.

- [ ] **Step 3: Commit**

```bash
git add scripts/repair-share-grants.mjs
git commit -m "Add the share-grant repair script, dry-run by default"
```

---

### Task 2: Dry-run and apply against a copy

**Files:**
- No source changes. This task produces evidence, not code.

**Interfaces:**
- Consumes: `scripts/repair-share-grants.mjs` from Task 1.
- Produces: a repaired copy of the database at `/tmp/claude-*/scratchpad/shell-repair.db`
  for Task 3 to read.

- [ ] **Step 1: Copy the database**

```bash
SCRATCH="$(dirname "$(mktemp -u)")"   # or the session scratchpad path
cp apps/web/prisma/dev.db /tmp/shell-repair.db
```

Use the session scratchpad directory if one is set; never `/tmp` when a
scratchpad exists.

- [ ] **Step 2: Dry-run against the copy**

Run:
```bash
DATABASE_URL="file:/tmp/shell-repair.db" npx tsx scripts/repair-share-grants.mjs
```
Expected: two lines, one per grant, and `Total basis added: EUR 8001.50`
(7,501.50 + 500.00). A different total means the rate lookup or the row match
found something other than what the owner approved — **stop and report it**,
do not apply.

- [ ] **Step 3: Apply to the copy**

Run:
```bash
DATABASE_URL="file:/tmp/shell-repair.db" npx tsx scripts/repair-share-grants.mjs --apply
```
Expected: `updated <id>` twice.

- [ ] **Step 4: Prove it is idempotent**

Run the same `--apply` command again.
Expected: `REFUSING: <id> already carries nativePrice 25.00`, exit 1, nothing
written. A repair script that can be run twice by accident must say no the
second time.

---

### Task 3: Verify the figures against the copy

**Files:**
- No source changes.

**Interfaces:**
- Consumes: the repaired copy from Task 2.

- [ ] **Step 1: Start a second server against the copy**

Run, as one command with nothing else in it (a standing rule in this repo —
build and restart together):

```bash
npm run build && DATABASE_URL="file:/tmp/shell-repair.db" npm run start -- -p 3001
```

- [ ] **Step 2: Read the holding**

Fetch the valuation and pick out `ACME.AS`:

```bash
curl -s "http://localhost:3001/api/portfolios/<id>/valuation" \
  | node -e 'const d=JSON.parse(require("fs").readFileSync(0));
             const h=d.holdings.find(h=>h.symbol==="ACME.AS");
             console.log(JSON.stringify(h,null,2));'
```

- [ ] **Step 3: Check four figures and one invariant**

Expected, with the display currency set to EUR:

| Figure | Before | After |
|---|---|---|
| quantity | 1,500.00 | **1,500.00 — unchanged** |
| costBasis | €18,000.00 | €34,798.47 |
| avgCost | €12.00 | €21.71 |
| unrealizedPnl | €42,588.83 (+199.3%) | €29,155.65 (+83.8%) |
| **value** | *v* | **exactly *v* — unchanged** |

The last row is the one that matters most. Cost basis and unrealised P&L are
two views of the same change and will move together whether or not the change
is right; **value** is independent of both and must not move at all. If value
moved, the script touched `quantity` or the price of a row it should not have.

Check `costBasis + unrealizedPnl === value` to the cent as well — it is the
identity the whole repair is rearranging, and it holds before and after.

- [ ] **Step 4: Check nothing else moved**

```bash
diff <(curl -s http://localhost:3001/api/portfolios/<id>/valuation | node -e '...print every holding but ACME.AS...') \
     <(curl -s http://localhost:3000/api/portfolios/<id>/valuation | node -e '...same...')
```

Expected: identical. A repair scoped to two rows of one symbol must be invisible
everywhere else. Prices refresh between the two requests, so compare `quantity`,
`costBasis` and `avgCost` — not `price` or `value`.

- [ ] **Step 5: Stop the second server**

Kill it **by port**, never by name pattern — a name match will take the user's
own dev server with it.

```bash
kill "$(lsof -t -i:3001)"
```

---

### Task 4: Apply to the real database

**Files:**
- No source changes.

- [ ] **Step 1: Take a fresh snapshot**

Not the copy from Task 2 — that one is now repaired. A new one, from the live
file, taken now:

```bash
cp apps/web/prisma/dev.db "/tmp/dev.db.before-grant-repair-$(date +%Y%m%d%H%M)"
```

Confirm `.gitignore` still covers it: `git check-ignore -v apps/web/prisma/dev.db.x`
should match `**/prisma/dev.db.*` if the snapshot is ever placed beside the
database rather than in the scratchpad.

- [ ] **Step 2: Dry-run against the real database**

```bash
DATABASE_URL="file:$PWD/apps/web/prisma/dev.db" npx tsx scripts/repair-share-grants.mjs
```
Expected: the same `Total basis added: EUR 8001.50` seen in Task 2. If it
differs, the ledger changed since Task 2 — stop and re-verify against a fresh
copy rather than applying.

- [ ] **Step 3: Apply**

```bash
DATABASE_URL="file:$PWD/apps/web/prisma/dev.db" npx tsx scripts/repair-share-grants.mjs --apply
```

- [ ] **Step 4: Re-check the four figures and the invariant**

Same checks as Task 3 Step 3, against the running app on port 3000. Value
unchanged; cost basis €34,798.47; average cost €21.71.

- [ ] **Step 5: Record it**

Move the entry in `docs/carried-forward.md` from "Designed, not built" to
"Resolved since the ledgers were written", saying what was applied, when, and
that the tax-treatment question was the owner's call. Commit.

```bash
git add docs/carried-forward.md
git commit -m "Record the Shell grant repair as applied"
```

---

## Self-review

**Spec coverage:** §6's "Two rows are repaired, on the owner's instruction and
separately from this work" is the whole of this plan, and Task 4 Step 5 closes
the `carried-forward.md` entry that tracked it.

**One thing the spec does not say and this plan adds:** the spec quotes the
grant values in euros, and the `price` column is USD. Every task in this plan
turns on that conversion; a plan that transcribed €25.00 into `price` would
produce a cost basis roughly 8% too high and every check above would still pass,
because they are all quoted in the display currency. That is why the rate lookup
is in the script rather than the arithmetic being done by hand.

**What no check here catches:** whether market-value-at-vest is the *right* basis
for this scheme. The figures are internally consistent either way. That question
is the owner's and was answered before this plan was written.
