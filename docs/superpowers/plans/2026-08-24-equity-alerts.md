# Equity alerts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise a price-target alert from an asset's own page, on a stock as
readily as on a coin — and make the evaluator actually able to fire it.

**Architecture:** Two halves that must ship together. The evaluator learns to
price equities through the configured provider instead of asking Binance for a
pair that does not exist; and the asset page grows an alert sheet reaching the
alerts API through `DataClient` as optional methods. The route stays server-only
by design and the mobile build never calls it — which is exactly why the client
methods are optional rather than required.

**Tech Stack:** TypeScript, Next.js route handlers, Prisma 6 + SQLite, Zod,
Vitest, React 19.

**Spec:** `docs/superpowers/specs/2026-08-24-asset-actions-design.md` §5.

**Sequencing:** Fourth and last of the spec's four groups. §1 (the sheet) and
§2–§4 (native currency, quote picker, prefill) are **already merged** — `Sheet`,
`pricingPair` and the asset page's `?type=` parameter all exist and this plan
uses them. §6 (cash and income) is the third group and has its own plan,
`docs/superpowers/plans/2026-08-24-cash-and-income.md`. The two are independent
and may run in either order.

**Order within this plan is not negotiable: the evaluator comes first.** Shipping
the button first puts a control on a stock page that saves an alert, lists it,
and never fires — which is the exact state §5 exists to end. The app must be
correct after every task, not only after the last one.

## Global Constraints

- **A broken evaluator reports success.** `GET /api/cron/evaluate` returns
  `{ ok: true, summary: [...] }` whether or not anything was priced; a symbol
  with no price is `continue`d silently in `evalPctMove` and reported as
  `fired: 0` in `evalPriceTarget`. Every verification step in this plan must
  check a **fired event or a named price**, never `ok: true`.
- **`Alert.symbol` keeps the pair.** Decision 1 of the symbol spec: an alert
  addresses a Binance market. The sheet submits `pricingPair(symbol)` for a coin
  and the bare ticker for an equity. `boundary.test.ts` allows `Alert.symbol` as
  the documented exception to "a stored symbol is an asset, not a pair".
- **The alert sheet offers a price target only** — direction and price. The
  indicator alerts are Bitcoin-specific (the risk metric's curves are fitted to
  BTC), so offering them per-coin would invite alerts that cannot mean anything.
  The alerts page keeps the full form.
- Alert routes stay in the `screen-boundary.test.ts` allowlist as server-only.
  Adding `listAlerts`/`createAlert` to `DataClient` does **not** convert them —
  it stops the *asset page* naming a route, which is a different rule.
- `npm run typecheck` — never bare `npx tsc --noEmit`.
- `npm run lint` must stay at exactly **21** pre-existing errors.
- Prisma migrations run **from `apps/web`**; `npx prisma generate` from the root.
- **Never commit `apps/web/prisma/dev.db` or a dated copy.** Destructive testing
  runs against a copy on port 3001, killed **by port**.

## The thing the spec gets wrong, and it matters

§5 says: *"for a symbol that `isEquityTicker` recognises, price through
`makeEquitySource`"*. Read `isEquityTicker`:

```ts
/** True for tickers that look like exchange-listed securities rather than coins. */
export function isEquityTicker(symbol: string): boolean {
  return /\.[A-Z]{1,4}$/.test(symbol.toUpperCase());
}
```

It requires a dot. **`AMD` is in this ledger and returns `false`.** So does every
US-listed holding, because US tickers carry no exchange suffix. Follow the spec
literally and an alert on AMD goes to Binance as `AMDUSDT` — and Binance may well
answer, with the price of an unrelated token. That is worse than not firing: it
is firing on the wrong number.

The importer does not have this problem because it has more to go on —
`isSecurityTicker` in `delta-csv.ts` reads Delta's venue column. An alert has no
venue column. Ticker-sniffing cannot answer this question and should not be asked
to.

**Ruling: the alert records what it is.** `Alert` gains
`assetType String @default("crypto")`, written by whoever creates it — the asset
page already knows, since it resolves `?type=` for exactly this reason, and the
alerts page can ask. The evaluator reads the column, falling back to
`isEquityTicker` only for rows written before the column existed.

Cost if wrong: one more column and one more migration than §5 anticipated. Cost
of not doing it: alerts on every US equity in this portfolio price against
whatever coin shares their ticker, silently.

A second bug found in the same read, fixed in Task 1: **`heldSymbols` does not
filter cash.** After the other plan lands, a `EUR` cash row gives
`computeHoldings` a positive quantity, `heldSymbols` returns `EUR`, and
`pricingPair("EUR")` asks Binance for `EURUSDT`. A portfolio-scoped percent-move
alert then fires on the euro. It is latent today and certain once cash rows can
be typed by hand.

---

### Task 1: The evaluator prices what it is actually holding

**Files:**
- Create: `apps/web/src/lib/alert-pricing.ts`
- Create: `apps/web/src/lib/alert-pricing.test.ts`
- Modify: `apps/web/src/app/api/cron/evaluate/route.ts:129-141` (`evalPriceTarget`), `:150-195` (`evalPctMove`), `:197-210` (`heldSymbols`)
- Modify: `apps/web/prisma/schema.prisma` (`Alert`)
- Create: `apps/web/prisma/migrations/<generated>/migration.sql`

**Interfaces:**
- Produces:
  ```ts
  export type PriceRequest = { symbol: string; assetType: "crypto" | "equity" };
  /** Live price and previous close per symbol, in the symbol's own currency. */
  export function priceSymbols(
    net: Net, requests: PriceRequest[], provider: string | null, apiKey: string | null,
  ): Promise<Record<string, { price: number; prevClose: number | null }>>;
  export function assetTypeOf(alertAssetType: string | null, symbol: string): "crypto" | "equity";
  ```
  Task 2 and Task 3 consume `assetTypeOf` indirectly, through the column it reads.

**Why a separate module:** the route is server-only and `apps/web` has no route
tests, but Vitest does run `apps/web/src/**` (that is where
`screen-boundary.test.ts` lives). Lifting the pricing decision into a plain
module makes the branch testable with `FakeNet`, which is the only way to prove
the equity path is reached — **`FakeNet` throws on an unmatched URL, so a request
that still went to Binance fails outright.** A test against the route itself
could not distinguish "priced through Yahoo" from "priced through Binance and
happened to get a number".

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/alert-pricing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FakeNet } from "@/data/testing/fake-net";
import { invalidate } from "@/core/cache";
import { assetTypeOf, priceSymbols } from "./alert-pricing";

describe("assetTypeOf", () => {
  it("believes the alert's own column over the ticker's shape", () => {
    // The whole point: AMD has no exchange suffix and is still an equity.
    expect(assetTypeOf("equity", "AMD")).toBe("equity");
    expect(assetTypeOf("crypto", "ETHUSDT")).toBe("crypto");
  });

  it("falls back to the ticker only for rows written before the column", () => {
    expect(assetTypeOf(null, "ASML.AS")).toBe("equity");
    expect(assetTypeOf(null, "BTCUSDT")).toBe("crypto");
    // Unknowable without the column, and crypto is what such a row meant.
    expect(assetTypeOf(null, "AMD")).toBe("crypto");
  });
});

describe("priceSymbols", () => {
  it("prices an equity through the provider, never through Binance", async () => {
    invalidate();
    const net = new FakeNet({
      "https://query1.finance.yahoo.com/v8/finance/chart/ASML.AS":
        { chart: { result: [{ meta: { regularMarketPrice: 1489.4, chartPreviousClose: 1470, currency: "EUR" } }] } },
    });
    const out = await priceSymbols(net, [{ symbol: "ASML.AS", assetType: "equity" }], "yahoo", null);
    expect(out["ASML.AS"]).toEqual({ price: 1489.4, prevClose: 1470 });
  });

  it("prices a coin through Binance", async () => {
    invalidate();
    const net = new FakeNet({
      "https://api.binance.com/api/v3/ticker/price": [{ symbol: "BTCUSDT", price: "65000" }],
      "https://api.binance.com/api/v3/klines":
        [[1, "0", "0", "0", "64000", "0"], [2, "0", "0", "0", "65000", "0"]],
    });
    const out = await priceSymbols(net, [{ symbol: "BTCUSDT", assetType: "crypto" }], "yahoo", null);
    expect(out["BTCUSDT"]!.price).toBe(65000);
    expect(out["BTCUSDT"]!.prevClose).toBe(64000);
  });

  it("omits what it cannot price rather than inventing a number", async () => {
    invalidate();
    const net = new FakeNet({ "https://api.binance.com/api/v3/ticker/price": [] });
    const out = await priceSymbols(net, [{ symbol: "NOPEUSDT", assetType: "crypto" }], "yahoo", null);
    expect(out["NOPEUSDT"]).toBeUndefined();
  });
});
```

`invalidate()` in each case is required — `cached()` is demand-driven and a
suite touching `sources/` shares its map across tests.

Check `FakeNet`'s matching rule before finalising the keys: it resolves the
**longest matching key first**, so a prefix is enough and a more specific key
wins.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run apps/web/src/lib/alert-pricing.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the module**

```ts
import { isEquityTicker } from "@/core/equity";
import { makeEquitySource } from "@/data/sources/equity";
import { fetchKlines, fetchPricesSafe } from "@/data/sources/binance";
import type { Net } from "@/data/ports/net";

export type PriceRequest = { symbol: string; assetType: "crypto" | "equity" };
export type Quote = { price: number; prevClose: number | null };

/**
 * What an alert is about.
 *
 * The column is authoritative because the ticker cannot answer: `AMD` is an
 * equity in this ledger and `isEquityTicker` returns false for it, since US
 * tickers carry no exchange suffix. Asking the shape of the string would send
 * an AMD alert to Binance, which may well answer — with an unrelated token's
 * price. Firing on the wrong number is worse than not firing.
 *
 * `null` means the row predates the column. Those rows were all created when
 * only Binance existed, so crypto is the truthful default; the suffix test is
 * kept as a courtesy for a European ticker somebody added by hand.
 */
export function assetTypeOf(alertAssetType: string | null, symbol: string): "crypto" | "equity" {
  if (alertAssetType === "equity" || alertAssetType === "crypto") return alertAssetType;
  return isEquityTicker(symbol) ? "equity" : "crypto";
}

/**
 * Live price and previous close per symbol, each in its own native currency —
 * the same currency the asset page prefills a target from, so a number typed
 * there is the number compared here.
 *
 * A symbol that cannot be priced is absent from the result. It is never zero
 * and never `NaN`: a caller comparing against a target must be able to tell
 * "no price" from "a price below the target".
 */
export async function priceSymbols(
  net: Net,
  requests: PriceRequest[],
  provider: string | null,
  apiKey: string | null,
): Promise<Record<string, Quote>> {
  const out: Record<string, Quote> = {};
  const crypto = requests.filter((r) => r.assetType === "crypto").map((r) => r.symbol);
  const equity = requests.filter((r) => r.assetType === "equity").map((r) => r.symbol);

  if (crypto.length > 0) {
    const prices = await fetchPricesSafe(net, crypto);
    for (const symbol of crypto) {
      const price = prices[symbol];
      if (price === undefined) continue;
      let prevClose: number | null = null;
      try {
        const daily = await fetchKlines(net, { symbol, interval: "1d", limit: 2 });
        prevClose = daily.length >= 2 ? daily[daily.length - 2]!.c : null;
      } catch {
        // A missing previous close is not a missing price; percent-move skips
        // this symbol, price-target does not need it.
      }
      out[symbol] = { price, prevClose };
    }
  }

  if (equity.length > 0) {
    // `quotes()` already returns price, prevClose and currency in the venue's
    // own currency, and already omits what it could not fetch.
    const quotes = await makeEquitySource(net, provider, apiKey).quotes(equity);
    for (const [symbol, q] of Object.entries(quotes)) {
      out[symbol] = { price: q.price, prevClose: q.prevClose ?? null };
    }
  }

  return out;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run apps/web/src/lib/alert-pricing.test.ts`
Expected: PASS, all five cases.

- [ ] **Step 5: The column and the migration**

In `apps/web/prisma/schema.prisma`, on `Alert`:

```prisma
  symbol        String? // null for portfolio-scoped alerts
  /// What `symbol` names. Recorded rather than inferred: a US ticker carries
  /// no exchange suffix, so AMD is indistinguishable from a coin by shape,
  /// and guessing sends the alert to the wrong price source.
  assetType     String   @default("crypto") // "crypto" | "equity"
```

From `apps/web`:

```bash
npx prisma migrate dev --name add-alert-asset-type
```

Then from the repository root: `npx prisma generate`.

Read the generated SQL. A defaulted column on an existing table should be one
`ALTER TABLE ... ADD COLUMN ... NOT NULL DEFAULT 'crypto'`. The two existing
alerts are `indicator` on `BTCUSDT`; the default is right for both.

- [ ] **Step 6: Rewrite the two evaluator branches**

`evalPriceTarget` — replace `fetchPricesSafe(deps().net, [a.symbol])`:

```ts
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  const quotes = await priceSymbols(
    deps().net,
    [{ symbol: a.symbol, assetType: assetTypeOf(a.assetType, a.symbol) }],
    settings?.equityProvider ?? null,
    settings?.equityApiKey ?? null,
  );
  const price = quotes[a.symbol]?.price;
  if (price === undefined) {
    return { alertId: a.id, fired: 0, skipped: 0, error: `no price for ${a.symbol}` };
  }
```

`evalPctMove` — build the request list once, and pair each symbol with the pair
or ticker it is actually priced under:

```ts
  const kind = assetTypeOf(a.assetType, a.symbol ?? "");
  const symbols = a.symbol ? [a.symbol] : await heldSymbols(a.portfolioId);
  ...
  // Binance prices pairs; a held symbol names the asset. An equity is priced by
  // its ticker and must not be pushed through `pricingPair`, which would turn
  // ASML.AS into ASML.ASUSDT.
  const requests = symbols.map((s) => {
    const type = a.symbol ? kind : heldType.get(s) ?? "crypto";
    return { symbol: s, keyed: type === "equity" ? s : pricingPair(s), assetType: type };
  });
  const quotes = await priceSymbols(
    deps().net,
    requests.map((r) => ({ symbol: r.keyed, assetType: r.assetType })),
    settings?.equityProvider ?? null,
    settings?.equityApiKey ?? null,
  );
  for (const r of requests) {
    const q = quotes[r.keyed];
    if (!q || q.prevClose === null) continue;
    const hit = evaluatePctMove(params, q.prevClose, q.price);
    ...
  }
```

This also removes the per-symbol `fetchKlines` call inside the loop — the
previous-close lookup now happens once inside `priceSymbols`.

- [ ] **Step 7: Teach `heldSymbols` what it is returning**

```ts
/**
 * Held positions and what each one is, so the caller knows which price source
 * to use. Cash is excluded: a EUR balance is a positive quantity under a symbol
 * Binance would happily answer for as `EURUSDT`, and a percent-move alert would
 * then fire on the euro.
 */
async function heldSymbols(
  portfolioId: string | null,
): Promise<{ symbols: string[]; types: Map<string, "crypto" | "equity"> }> {
  if (!portfolioId) return { symbols: [], types: new Map() };
  const rows = await prisma.transaction.findMany({
    where: { portfolioId, assetType: { not: "cash" } },
  });
  const types = new Map<string, "crypto" | "equity">(
    rows.map((t) => [t.symbol, t.assetType === "equity" ? "equity" : "crypto"]),
  );
  const txs: Tx[] = rows.map((t) => ({
    symbol: t.symbol, side: t.side as TxSide, quantity: t.quantity,
    price: t.price, fee: t.fee, time: Number(t.time),
  }));
  return {
    symbols: computeHoldings(txs).filter((h) => h.quantity > 0).map((h) => h.symbol),
    types,
  };
}
```

Update `evalPctMove`'s call site to destructure both.

- [ ] **Step 8: Typecheck, run the full suite, commit**

```bash
npm run typecheck && npx vitest run && npm run lint
```
Expected: clean, all pass, lint at exactly 21.

```bash
git add apps/web/src/lib/alert-pricing.ts apps/web/src/lib/alert-pricing.test.ts \
        apps/web/src/app/api/cron/evaluate/route.ts apps/web/prisma
git commit -m "Price an alert through the source that actually lists it"
```

---

### Task 2: A real equity alert fires, end to end

**Files:**
- No source changes unless this finds one. Evidence.

**Interfaces:**
- Consumes: everything from Task 1.

**Why this task exists as its own gate:** the spec's §5 closing note records that
the last alert regression survived a check that "exercised only `indicator`
alerts on `BTCUSDT`, which keep their pair" — the one path that could not break.
Task 1's unit tests use `FakeNet`. Neither proves an equity alert fires against
the real Yahoo. This does.

- [ ] **Step 1: Copy the database and start a second server**

```bash
cp apps/web/prisma/dev.db /tmp/equity-alerts.db
npm run build && DATABASE_URL="file:/tmp/equity-alerts.db" npm run start -- -p 3001
```

Build and restart in the **same** command with nothing else in it.

- [ ] **Step 2: Raise a target that must fire immediately**

Against the copy, on a holding you know the price of — take `ASML.AS`'s last
close from `/api/history/ASML.AS?assetType=equity&range=1m` and set a target
*below* it, so the alert has to fire on the first evaluation:

```bash
curl -s -X POST http://localhost:3001/api/alerts \
  -H 'content-type: application/json' \
  -d '{"kind":"price_target","symbol":"ASML.AS","assetType":"equity",
       "params":{"direction":"above","price":1}}'
```

- [ ] **Step 3: Evaluate, and read the summary properly**

```bash
curl -s http://localhost:3001/api/cron/evaluate | jq .
```

Expected: the entry for this alert reports **`fired: 1`**. `ok: true` proves
nothing — the route answers `ok: true` while pricing nothing at all, which is
how the last regression went unnoticed.

If it reports `error: "no price for ASML.AS"`, the provider call failed; check
which provider is configured in Settings before assuming the branch is wrong.

- [ ] **Step 4: Check the event, and that it is one-shot**

```bash
curl -s http://localhost:3001/api/alerts | jq '.alerts[] | select(.symbol=="ASML.AS")'
```

Expected: `enabled: false` — a price target disables itself after firing. Run
`/api/cron/evaluate` again: `fired: 0`, no second event. Idempotence comes from
the `(alertId, barTime, signal)` unique constraint, and this is the check that it
held.

- [ ] **Step 5: Check the currency is the venue's, not converted**

The recorded `price` on the event must be `ASML.AS`'s euro price, matching the
figure the asset page shows and prefills — around €1,489, not around $1,600.
A converted figure means the equity branch went through a display-currency path
it should not touch. **This is the check the parity harness structurally cannot
make**: a proportional shift under a tolerance looks like ordinary price drift.

- [ ] **Step 6: Check a US ticker — the case the spec would have broken**

```bash
curl -s -X POST http://localhost:3001/api/alerts -H 'content-type: application/json' \
  -d '{"kind":"price_target","symbol":"AMD","assetType":"equity",
       "params":{"direction":"above","price":1}}'
curl -s http://localhost:3001/api/cron/evaluate | jq .
```

Expected: `fired: 1` at AMD's real USD price (~457 on 2026-08-24), **not**
whatever `AMDUSDT` returns from Binance. Compare it against
`/api/history/AMD?assetType=equity` on the same server.

- [ ] **Step 7: Check the coin path did not regress**

The two pre-existing `indicator` alerts on `BTCUSDT` must still evaluate. Run
`/api/cron/evaluate` and confirm they report a summary without an `error`.

- [ ] **Step 8: Stop the second server, by port**

```bash
kill "$(lsof -t -i:3001)"
```

- [ ] **Step 9: Record what was checked**

No code commit if nothing changed — but if any step above found a bug, fix it
with its own failing test in `alert-pricing.test.ts` first.

---

### Task 3: Alerts across the seam

**Files:**
- Modify: `packages/data/src/client/data-client.ts` (two optional methods, `AlertDto`, `NewAlertInput`, `ClientCapabilities`)
- Modify: `packages/data/src/client/http-client.ts`
- Modify: `packages/data/src/client/client-contract.ts`
- Modify: `packages/data/src/client/stub-client.test.ts`
- Modify: `apps/web/src/app/api/alerts/route.ts` (accept `assetType`)

**Interfaces:**
- Produces:
  ```ts
  export type AlertDto = {
    id: string; kind: "indicator" | "price_target" | "pct_move";
    symbol: string | null; assetType: "crypto" | "equity";
    portfolioId: string | null; timeframe: string;
    params: Record<string, unknown>; enabled: boolean; createdAt: number;
  };
  export type NewAlertInput = {
    kind: "price_target";
    symbol: string;
    assetType: "crypto" | "equity";
    params: { direction: "above" | "below"; price: number };
  };
  listAlerts?(): Promise<AlertDto[]>;
  createAlert?(input: NewAlertInput): Promise<AlertDto>;
  ```
  Task 4 consumes both.

**Why optional and not required:** dispatch runs through Home Assistant and Web
Push, neither of which exists inside an APK, and `data-client.ts`'s own header
sets the rule — *"if some implementations can and others structurally cannot, the
method is optional (`method?()`), never required-and-throwing."* A required
method an implementation may fail cannot be checked by the contract at all: the
suite either demands success, forcing the second implementation to pretend, or
accepts a throw, at which point it passes for something simply broken.

**Why `NewAlertInput` is narrowed to `price_target`:** decision 5. The sheet
offers a target and nothing else, and a union covering three kinds would be an
interface promising a screen that does not exist. The alerts page keeps its raw
`fetch` and its full form; it is allowlisted `"all"` and stays that way.

- [ ] **Step 1: Write the failing contract cases**

In `client-contract.ts`, add `alerts: boolean` to `ClientCapabilities` and:

```ts
    it("reports its alert capability honestly in both directions", () => {
      const client = makeClient();
      expect(typeof client.listAlerts === "function").toBe(capabilities.alerts);
      expect(typeof client.createAlert === "function").toBe(capabilities.alerts);
    });

    if (capabilities.alerts) {
      it("creates a price target and lists it back", async () => {
        const client = makeClient();
        const made = await client.createAlert!({
          kind: "price_target", symbol: "ASML.AS", assetType: "equity",
          params: { direction: "above", price: 1600 },
        });
        expect(made.symbol).toBe("ASML.AS");
        expect(made.assetType).toBe("equity");
        expect(made.enabled).toBe(true);
        const all = await client.listAlerts!();
        expect(all.map((a) => a.id)).toContain(made.id);
      });
    }
```

The presence check runs for **both** implementations and asserts absence as a
fact rather than letting a test quietly skip.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run packages/data/src/client`
Expected: FAIL — `alerts` is not on `ClientCapabilities`, and the methods do not
exist on either implementation.

- [ ] **Step 3: The interface**

Add the two types and the two optional methods to `data-client.ts`, each with a
doc comment. On the methods:

```ts
  /**
   * Absent where alerts cannot be raised. Dispatch runs through Home Assistant
   * and Web Push, and an APK has neither — so `LocalClient` will not implement
   * these, and a screen must feature-detect before drawing the control. Same
   * rule and same reasoning as `sendTestNotification`; the argument is in this
   * file's header.
   */
  listAlerts?(): Promise<AlertDto[]>;
  createAlert?(input: NewAlertInput): Promise<AlertDto>;
```

`sendTestNotification` was the only optional member, and the header says the bar
for a second is high because optionality is a branch in every screen that touches
it. Write down here that these two clear it: they are a whole capability the
device cannot have, not a convenience.

- [ ] **Step 4: `HttpClient`**

```ts
    listAlerts(): Promise<AlertDto[]> {
      return send<{ alerts: AlertDto[] }>("GET", "/api/alerts").then((d) => d.alerts);
    },

    async createAlert(input: NewAlertInput): Promise<AlertDto> {
      const d = await send<{ alert: AlertDto }>("POST", "/api/alerts", { body: input });
      return d.alert;
    },
```

`HttpClient` is the last file that knows about response envelopes; keep the
unwrapping here and nowhere else.

- [ ] **Step 5: The stub**

`stub-client.test.ts` builds its client from the services over `MemoryStore`.
There is no alerts service and there will not be one — the routes are permanently
server-only. So the stub **omits both methods** and passes
`{ alerts: false, testNotifications: false }`. That is the point of Step 1's
presence check: absence is asserted, not skipped.

Add a line to the file's header recording what this showed — that the interface
survived a second implementation which genuinely cannot raise an alert.

- [ ] **Step 6: The route accepts `assetType`**

In `apps/web/src/app/api/alerts/route.ts`, add to each member of the
discriminated union:

```ts
    assetType: z.enum(["crypto", "equity"]).optional(),
```

and to the `create` data: `assetType: d.assetType ?? "crypto"`. Add `assetType`
to the `GET` mapping so `listAlerts` gets it back.

- [ ] **Step 7: Run and commit**

```bash
npx vitest run packages/data && npm run typecheck && npm run lint
```
Expected: contract green against `HttpClient` and the stub; lint at 21.

```bash
git add packages/data/src/client apps/web/src/app/api/alerts/route.ts
git commit -m "Let a screen raise an alert without naming a route"
```

---

### Task 4: The alert sheet

**Files:**
- Create: `packages/ui/src/AlertForm.tsx`
- Create: `packages/ui/src/alert-fields.ts`
- Create: `packages/ui/src/alert-fields.test.ts`
- Modify: `apps/web/src/app/portfolio/[symbol]/page.tsx:374-400`

**Interfaces:**
- Consumes: `NewAlertInput`, `createAlert` from Task 3; `Sheet` from the merged
  §1 work; `pricingPair` from `packages/core/src/symbols.ts`.
- Produces: nothing later depends on.

**Where the tests are, and why:** `@testing-library/react` is not installed,
there is no jsdom environment, and this repo has zero component tests. The pure
logic goes in `alert-fields.ts` where plain Vitest reaches it — the same split
`tx-fields.ts` already established in the merged §1–§4 work. The markup is
verified by hand in Step 6, not by a test that does not exist.

- [ ] **Step 1: Write the failing test**

`packages/ui/src/alert-fields.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { toNewAlert } from "./alert-fields";

describe("toNewAlert", () => {
  it("submits the pair for a coin — an alert addresses a Binance market", () => {
    expect(toNewAlert({ symbol: "ETH", assetType: "crypto", direction: "above", price: "3000" }))
      .toEqual({ kind: "price_target", symbol: "ETHUSDT", assetType: "crypto",
                 params: { direction: "above", price: 3000 } });
  });

  it("submits the bare ticker for an equity", () => {
    expect(toNewAlert({ symbol: "ASML.AS", assetType: "equity", direction: "below", price: "1400" }))
      .toEqual({ kind: "price_target", symbol: "ASML.AS", assetType: "equity",
                 params: { direction: "below", price: 1400 } });
  });

  it("refuses a price that is not a positive number", () => {
    for (const price of ["", "0", "-5", "abc"]) {
      expect(toNewAlert({ symbol: "ETH", assetType: "crypto", direction: "above", price }))
        .toBeNull();
    }
  });
});
```

The first two cases are the ones worth having: they pin the asymmetry that
decision 1 of the symbol spec created, and it is exactly the kind of thing that
looks arbitrary six months later and gets "simplified" into a bug.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run packages/ui/src/alert-fields.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement `alert-fields.ts`**

```ts
import { pricingPair } from "@/core/symbols";
import type { NewAlertInput } from "@/data/client/data-client";

export type AlertFields = {
  symbol: string;
  assetType: "crypto" | "equity";
  direction: "above" | "below";
  price: string;
};

/**
 * `Alert.symbol` holds a market, not an asset — the documented exception to
 * "a stored symbol is an asset, not a pair" (`boundary.test.ts`), because an
 * alert addresses something Binance lists. An equity is not on Binance, so its
 * ticker goes in unchanged; the evaluator reads `assetType` to know which.
 *
 * Returns null rather than throwing on bad input: the form disables its button
 * on null and has nothing to report that the field does not already show.
 */
export function toNewAlert(f: AlertFields): NewAlertInput | null {
  const price = Number(f.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  return {
    kind: "price_target",
    symbol: f.assetType === "equity" ? f.symbol.toUpperCase() : pricingPair(f.symbol),
    assetType: f.assetType,
    params: { direction: f.direction, price },
  };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run packages/ui/src/alert-fields.test.ts`
Expected: PASS, all three.

- [ ] **Step 5: `AlertForm.tsx`**

A direction `<select>` (Above / Below), a price input, and the same
"Use <price>" one-tap fill `TxForm` already carries — the target is almost always
set relative to the current price, and the currency must match the field, so take
it from the same `livePrice` the asset page already computes for `TxForm`.

Reuse `field()` and `Button`; do not re-type either. The primary button, the
secondary button and the form-field class were each re-typed across sixteen and
nine sites once and consolidated for exactly this reason (design-audit findings
#2 and #3).

Copy, per `BRAND.md`: sentence case, no exclamation marks. The control says what
happens — "Create alert", and afterwards the sheet closes and the row appears.

- [ ] **Step 6: Wire the asset page**

Replace the `Alert me` link to `/alerts?symbol=…` with a button that opens a
`Sheet`, mirroring the Add-a-transaction sheet directly above it:

```tsx
{client.createAlert && (
  <>
    <Button variant="secondary" onClick={() => setAlertOpen(true)}>
      <Bell size={12} aria-hidden />Alert me
    </Button>
    <Sheet open={alertOpen} onClose={() => setAlertOpen(false)} title="Alert me">
      <AlertForm symbol={symbol} assetType={resolvedType ?? "crypto"}
                 livePrice={lastClose} onSubmit={createAlert} error={alertError} />
    </Sheet>
  </>
)}
```

Three things to get right:

- **Feature-detect.** `client.createAlert &&` is not optional politeness; it is
  what makes the optional method safe, and what the settings screen already does
  for `sendTestNotification`.
- **`resolvedType` may be `null`** while the kind is still unknown — that
  nullability was added deliberately to fix the page flash, where guessing from
  the ticker made every renamed coin resolve as an equity and briefly drew
  another security's price. Do not reintroduce a guess here; render the button
  disabled, or not at all, until the kind is known.
- **The sheet must close on navigation.** `Sheet` handles Escape and the scrim;
  a route change is the third case, and the asset page is reachable from Markets
  where a user may tap straight through.

- [ ] **Step 7: Verify by hand**

`npm run dev`, then:

1. `/portfolio/ETH` — "Alert me" opens a sheet from the bottom. The price field
   prefills in USDT. Escape closes it; a scrim tap closes it.
2. Create a target above the current price. It appears on `/alerts`, with symbol
   `ETHUSDT`.
3. `/portfolio/ASML.AS?type=equity` — the same sheet. The prefill is in euros.
   Create a target; the alert lists as `ASML.AS`, **not** `ASML.ASUSDT`.
4. `/portfolio/AMD?type=equity` — create a target, and confirm it lists as `AMD`
   with `assetType: "equity"`. This is the case Task 1's ruling exists for.
5. `/alerts` still works, full form intact.

- [ ] **Step 8: Guards, lint, commit**

Run: `npx vitest run && npm run typecheck && npm run lint`

Expected: `screen-boundary.test.ts` and `boundary.test.ts` both pass with **no
new allowlist entry**. If either wants one, the wiring reached for a route
directly — that is the bug, not the guard. `boundary.test.ts` also forbids a new
`/api/` string literal in `packages/ui`; `AlertForm` must have none.

Lint at exactly 21.

```bash
git add packages/ui/src/AlertForm.tsx packages/ui/src/alert-fields.ts \
        packages/ui/src/alert-fields.test.ts \
        "apps/web/src/app/portfolio/[symbol]/page.tsx"
git commit -m "Raise a price alert from the asset's own page"
```

---

### Task 5: Close the loop

**Files:**
- Modify: `CLAUDE.md`, `docs/carried-forward.md`

- [ ] **Step 1: Full suite on the tree about to be integrated**

```bash
npx vitest run && npm run typecheck && npm run lint
```
Expected: all pass, typecheck clean, lint at exactly 21. A green run earlier in
the session only proves the tree it ran on.

- [ ] **Step 2: One last end-to-end pass against a copy**

Repeat Task 2 Steps 1–8 on a **fresh** copy, now with the sheet in place: raise
the alert through the UI rather than through `curl`, and confirm it fires. The
button and the evaluator have only ever been tested apart until this point.

- [ ] **Step 3: Documentation**

- `CLAUDE.md`: `Alert.assetType` in the schema list, and one line under
  "Alert evaluation" saying equities price through the configured provider.
- `docs/carried-forward.md`: move "**Alerts cannot fire for equities**" from
  "Designed, not built" into "Resolved", noting the `isEquityTicker` correction
  so the next reader of §5 does not implement the spec as written.
- The `heldSymbols` cash fix belongs in "Resolved" too — it was latent, not
  reported, and a note is the only trace it will leave.

```bash
git add CLAUDE.md docs/carried-forward.md
git commit -m "Write down that equity alerts work"
```

---

## Self-review

**Spec coverage.**

| §5 requirement | Task |
|---|---|
| `listAlerts?()` / `createAlert?()` optional on `DataClient` | 3 |
| Optional because HA and Web Push are absent in an APK | 3 (and its header note) |
| The asset page feature-detects | 4 Step 6 |
| `Alert.symbol` keeps the pair; equity submits the bare ticker | 4 Steps 1, 3 |
| `evalPriceTarget` learns equities | 1 Step 6 |
| `evalPctMove` learns equities | 1 Steps 6–7 |
| Native currency — the target is compared in the currency it was typed in | 1 Step 3, verified 2 Step 5 |
| The route stays server-only | unchanged; stated in Global Constraints |
| Price target only, no indicator alerts in the sheet | 3 Step 1 (`NewAlertInput` narrowed), 4 |
| Contract entries run against both implementations | 3 Step 1 |
| An equity alert fires against a scripted provider quote | 1 Step 1 |

**Type consistency.** `assetType` is `"crypto" | "equity"` on `Alert`, on
`AlertDto`, on `NewAlertInput`, on `AlertFields` and in `priceSymbols` — one
union, five places, spelled identically. It is deliberately **not** the port's
three-member `AssetType`: an alert cannot be about cash.

**Two departures from the spec, both flagged inline with their cost:**
`Alert.assetType` replaces the spec's `isEquityTicker` sniffing (Task 1's opening
section — the spec's approach mis-routes every US ticker in this ledger), and
`heldSymbols` gains a cash filter the spec does not mention (a latent bug that
becomes certain once the cash-and-income plan lands).

**What none of this catches.** Whether the provider's quote is *right*. Task 1's
tests script Yahoo through `FakeNet`, so an inverted currency or a stale field
passes every one of them. Task 2 Step 5 is the only check on that, and it is a
human comparing two numbers — which is why it names the expected figure rather
than saying "looks reasonable".
