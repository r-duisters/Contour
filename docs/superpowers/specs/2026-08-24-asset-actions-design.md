# Acting on an asset from its own page

> **The figures in this document are illustrative.** It described a repair to a
> real ledger, and the amounts, quantities and ticker have been replaced with
> invented ones that preserve the arithmetic the argument depends on. The
> reasoning is unchanged; the numbers are not anybody's positions.

**Status:** designed, not built. Decisions settled 2026-08-24.

## What prompted it

Four requests, in the user's words:

1. The "Add a transaction" screen should fold from the bottom like the menu.
2. That option should be on every coin and stock page, and so should an alert
   button, also folding from the bottom.
3. Other symbols like `ETHEUR` should be selectable.
4. The current price should be put into the form.

A fifth requirement fell out of checking whether (2) could be delivered: alerts
cannot fire for equities today, so the button would appear on stock pages and
do nothing. See §5.

## What is already true

Worth stating, because three of these make the work smaller than it looks and
one makes it larger.

- **The add form already appears on unheld pages** — the heading reads "Start a
  position" and the form is there. What (2) asks for is presentation, not
  availability.
- **`TxForm` already accepts `livePrice`**, documented as "offered as a one-tap
  fill", typed, and passed in from the asset page. It is never read. Request (4)
  is a feature that looks finished and is not.
- **The sheet mechanics exist but are welded to `MoreMenu`** — scrim, Escape,
  focus capture, body-scroll lock, safe-area inset, tab-bar clearance, the rise
  animation. Reusing them means extracting a primitive, not copying markup.
- **`NewTransactionInput` carries no currency.** Its own doc says "a manual
  entry takes the crypto/null defaults". The importer can record that a trade
  settled in euros; the form cannot. This is why (3) is not a picker change.

## Decisions, settled 2026-08-24

1. **A price typed against `ETHEUR` is stored natively** — `nativeCurrency:
   "EUR"`, `nativePrice: 2000`, plus the USD figure converted at *that trade's
   date*. Exactly what the Delta importer does for the 130 imported rows.
   Rejected: converting to USD and discarding the euro fact, which is the loss
   the symbol rename was undertaken to undo.
2. **Alert creation reaches the API through `DataClient`**, as optional methods,
   following `sendTestNotification`'s precedent. Rejected: allowlisting a raw
   `fetch` on the asset page — the allowlist records genuine impossibilities,
   and this would record a shortcut on an otherwise converted screen.
3. **The quote picker offers pairs that exist, in quotes the app knows** —
   Binance `exchangeInfo` filtered to `status: TRADING` and a quote in
   `QUOTE_ASSETS`. Rejected: every pair Binance lists (thin and exotic quotes),
   and a fixed list (would offer `ETHEUR` for coins where no such pair exists,
   pricing the entry at nothing).
4. **Equities are covered too.** `currencyForTicker` already knows `ASML.AS`
   trades in EUR, but a hand-typed price is stored as USD — overstating cost
   basis by roughly the exchange rate. The same native fields carry the fix.
5. **The alert sheet offers a price target only** — direction and price. The
   indicator alerts are Bitcoin-specific (the risk metric's curves are fitted to
   BTC), so offering them per-coin would invite alerts that cannot mean
   anything. The alerts page keeps the full form.
6. **The evaluator learns to price equities** (§5), so the button on a stock
   page does what it appears to.
7. **Cash and income can be entered by hand** (§6). Today they cannot: a manual
   entry has no `assetType`, so typing EUR records a *crypto* holding called
   EUR rather than cash.
8. **`income` becomes its own side, and carries a `sourceSymbol`.** It is a
   *cash* inflow attributed to a security — a Shell dividend is €120 of cash
   credited against `ACME.AS`, and the share count does not move. Rejected:
   a cash `transfer_in` distinguished only by `sourceSymbol` being set (cheaper,
   no new side, but income and a bank deposit stay the same kind of row); and
   cash with no attribution at all, which cannot answer the question that
   motivated the section.

   **This decision was revised.** An earlier draft used one `income` side for
   dividends, staking rewards *and* share grants. Checking Ghostfolio and
   Portfolio Performance against this codebase showed that was wrong twice
   over — see §6.

---

## 1. `Sheet` — one primitive, three users

**New:** `packages/ui/src/Sheet.tsx`.

```ts
export default function Sheet({ open, onClose, title, children }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}): React.ReactElement | null
```

Carries what `MoreMenu`'s sheet branch carries today and nothing else: the
scrim as a `<button>` so the dismiss gesture is reachable from a keyboard,
`role="dialog" aria-modal="true"` labelled by `title`, Escape from anywhere
including inside the panel, focus moved to the first control on open, body
scroll locked while open, `motion-safe:animate-[more-up_.16s_ease-out]`, and
`pb-[calc(env(safe-area-inset-bottom)+4rem)]` to clear the tab bar and the home
indicator.

`MoreMenu`'s sheet branch becomes a consumer. Its dropdown branch stays where it
is: that one is anchored to a nav control and these two are not.

**One presentation at every width** — a bottom sheet, `max-w-lg` and centred
horizontally on a desktop. `MoreMenu` has two presentations because it hangs off
a button in the nav bar; a form sheet has no anchor, and inventing a second
desktop treatment is a design decision nobody asked for.

## 2. Native currency for a manual entry

The substantive change, and the one that reaches an interface.

**`NewTransactionInput`** (`packages/data/src/client/data-client.ts`) gains three
optional fields, matching what `NewTransaction` on the `Store` port already has:

```ts
  /**
   * What the price and fee were actually paid in. Absent means the figures are
   * already USD, which is what every manual entry meant before this existed.
   */
  nativeCurrency?: string | null;
  nativePrice?: number | null;
  nativeFee?: number | null;
```

**Conversion belongs in the service.** `addTransaction(store, portfolioId, tx)`
gains a `Net` and, when the native fields are present, computes the USD `price`
and `fee` the rest of the app does its arithmetic on. The rate is taken **on the
trade's date**, not today's — a trade entered a week late must not be priced at
this morning's rate.

**The rule is not written twice.** `transfer.ts` already classifies currencies
to decide whether a rate comes from ECB or from Binance. Those sets move to
`packages/core/src/currencies.ts` and both paths read them. Note there are
already three overlapping lists — `FIAT` in `transfer.ts` (9 entries), `STABLES`
(7) and `FIAT_CURRENCIES` (10) in `delta-csv.ts`. The new code adds no fourth.
Reconciling the existing three against each other is deliberately **not** part of
this work.

The importer keeps its batched, per-currency range fetch: it prices many rows
across a date span, which is a different access pattern from one row on one day.
What is shared is the classification, not the fetching.

**The route** (`POST /api/portfolios/[id]/transactions`) extends its Zod schema
with the three optional fields and passes the `Net` from `deps()`.

## 3. The quote picker

**New source function**, `packages/data/src/sources/binance.ts`:

```ts
/** Quote assets Binance actually lists this base against, e.g. ETH -> [USDT, EUR, BTC, ...]. */
export function fetchQuotesFor(net: Net, base: string): Promise<string[]>
```

Reads `exchangeInfo`, keeps `status === "TRADING"` and `isSpotTradingAllowed`,
matches `baseAsset === base`, and filters the quote to `QUOTE_ASSETS`. Memoised
through `cached()` like its neighbours — `exchangeInfo` is a large response and
does not change within a session.

**New `DataClient` method:** `listQuotes(asset: string): Promise<string[]>`.
Required, not optional: a device build can answer it the same way.

**In `TxForm`:** for a coin, a `<select>` of the quotes, defaulting to `USDT`.
For an equity there is no picker — the currency is `currencyForTicker(symbol)`
and is shown as fixed text beside the price field. The form submits
`nativeCurrency` set to the chosen quote (or the ticker's currency), and
`nativePrice` set to what was typed.

`symbol` in the submitted transaction stays the **asset**. Picking `ETHEUR` does
not store `ETHEUR`; it stores `ETH` with `nativeCurrency: "EUR"`. That is the
whole point of the rename, and the picker is a statement about the price, not
about what is owned.

## 4. Price prefill

`livePrice` is finally read: a tap fills the price field.

The value comes from `getHistory(pair, kind, "1d")`'s last close, refetched when
the quote changes — so `ETHUSDT` prefills in USDT and `ETHEUR` in euros, always
consistent with the field's own label. For an equity, `history` returns the
provider's raw closes, which are already in the venue's currency.

**Not** the holding's `price`: that figure is in the *display* currency, and
putting it in a field that means something else is how a EUR number ends up
stored as USD — the exact bug §2 exists to fix.

Measured on the live ledger, 2026-08-24, with the display currency set to EUR:

| | `history` last close | holding's `price` |
|---|---|---|
| `AMD` | 457.58 (USD, native) | €389.13 |
| `ASML.AS` | 1489.40 (EUR, native) | €1489.00 |

The two agree for `ASML.AS` and differ by exactly the EUR/USD rate for `AMD`,
which is what makes this worth stating: a check done only against a European
holding would show the two sources agreeing and conclude either would do.

## 5. The alert sheet, and equities in the evaluator

**`DataClient`** gains two optional methods:

```ts
  /** Absent where alerts cannot be raised — see the note on sendTestNotification. */
  listAlerts?(): Promise<AlertDto[]>;
  createAlert?(input: NewAlertInput): Promise<AlertDto>;
```

Optional because dispatch runs through Home Assistant and Web Push, neither of
which exists inside an APK. The asset page feature-detects and does not draw the
button when they are missing, exactly as the settings screen does today.

**`Alert.symbol` keeps the pair** — decision 1 of the symbol spec — so the sheet
submits `pricingPair(symbol)` for a coin and the bare ticker for an equity.

**The evaluator learns equities.** `evalPriceTarget` and `evalPctMove` in
`apps/web/src/app/api/cron/evaluate/route.ts` price exclusively through Binance
today. They gain a branch: for a symbol that `isEquityTicker` recognises, price
through `makeEquitySource(net, provider, apiKey).quotes([symbol])`, which already
returns `price`, `prevClose` and `currency` in the **native** currency — the same
currency §4 prefills from, so a target typed on the page is the number the
evaluator compares against.

This route is server-only by design and stays that way; it is not part of the
seam and the mobile build never calls it.

**Related bug, already fixed** in `6cd1d55` and recorded here because it explains
why this section exists: `heldSymbols` fed bare assets to Binance after the
symbol rename, so every portfolio-scoped `pct_move` alert silently priced
nothing. The check that missed it exercised only `indicator` alerts on
`BTCUSDT`, which keep their pair.

## 6. Cash, income and employee shares

### What is true today, measured

Probed against the importer on 2026-08-24:

| Delta row | What happens now |
|---|---|
| `DIVIDEND` | **Skipped.** `unsupported type "DIVIDEND"` — the row never enters the ledger |
| `STAKING`, `REWARD`, `AIRDROP`, `INTEREST`, `MINING`, `INCOME` | `transfer_in` at price 0 |
| `DEPOSIT` (fiat) | cash `transfer_in` — works |

So dividends are not mis-recorded, they are **dropped**. Any dividend in a Delta
export was lost at import, which is one candidate for the ledger's missing
deposits (`docs/carried-forward.md`).

And **nothing can be added by hand**: `NewTransactionInput` carries no
`assetType`, so a manually typed EUR row is stored as a crypto holding named
EUR, not as cash.

### How other tools model this

Checked 2026-08-24, because the first draft of this section got it wrong.

**Ghostfolio** — the closest peer, also self-hosted — has six activity types:
`BUY`, `SELL`, `DIVIDEND`, `FEE`, `INTEREST`, `LIABILITY`. A `DIVIDEND` names a
symbol and does not change the position.

**Portfolio Performance** splits the problem in two, and the split is the useful
part:

- a **dividend** is a *cash* transaction **linked to a security**, credited to
  the reference account and counted as an inflow attributed to that security.
  The share count does not move.
- a **delivery (inbound)** is "the acquisition of a financial instrument without
  settlement via the reference account" — shares arrive, no cash leaves, and the
  delivery carries a value. This is exactly an employee share grant.

**We already have inbound delivery.** `portfolio.ts:9` documents `price` as
"For transfers this is the assumed cost-basis price", and `computeHoldings` adds
`quantity * price` to cost basis for a `transfer_in`. A staking reward or a share
grant recorded at its value needs no new concept at all — only a price where the
importer currently writes 0.

So the earlier draft was wrong in both directions: it proposed a new side for
cases already served, and modelled a dividend as plain cash, which loses the
attribution that was the whole reason for the side.

### The change

**`NewTransactionInput` gains `assetType?: "crypto" | "equity" | "cash"`**,
defaulting to `"crypto"` so every existing caller keeps its behaviour.

**`transfer_in` keeps its meaning and gains no new one.** Rewards and grants are
transfers with a price. What changes is only that the importer stops writing 0
when it knows better, and the form lets a price be typed.

**A new side, `income`, for cash attributed to a security.** It always increases
cash, never a position:

```
side: "income", assetType: "cash", quantity: 120,
nativeCurrency: "EUR", sourceSymbol: "ACME.AS"
```

`sourceSymbol` is nullable — bank interest has no source security.

**Cost basis is untouched by income.** A dividend is not a purchase; it must not
lower the average cost of the shares that paid it. This is the mistake to guard
against, because both rows mention the same symbol.

**The importer stops dropping dividends:** `DIVIDEND` and `DIVIDENDS` map to
`income` with `sourceSymbol` set from the row's base currency where the export
names one. `INTEREST` maps to `income` with no source. `STAKING`, `REWARD`,
`AIRDROP` and `MINING` stay `transfer_in` — they are deliveries, not cash — and
gain a price where the export gives one.

**The Ghostfolio export can finally be honest.** It currently flattens every row
to `BUY`/`SELL`, including income. With `income` it emits `DIVIDEND`, which the
target format has supported all along.

**Every consumer that switches on `side` must be taught the new one.** Counted
in `packages/core`, by number of places each file branches on it:

| File | Sites | What it decides |
|---|---|---|
| `portfolio.ts` | 8 | quantity, cost basis, realised P&L |
| `delta-csv.ts` | 7 | the import mapping itself |
| `ledger-audit.ts` | 5 | the underfunded/oversold findings |
| `insights.ts` | 5 | contributors, flows by year |
| `performance.ts` | 4 | the value series |
| `export.ts` | 2 | both export formats |
| `cash.ts` | 2 | running cash balances |
| `asset-info.ts` | 1 | per-asset summary |

This is the largest single risk in the spec: a consumer that silently ignores an
unknown side gives a figure that is right on one screen and wrong on another,
with nothing to announce the disagreement. All 34 sites are found by reading —
an unhandled `else` branch does not fail a test, it just answers wrongly.

`portfolio.ts` is the one to get right first: `income` must add nothing to
quantity or cost basis for the named symbol, which is not what either existing
branch does.

### The form

A "Cash / income" mode in `TxForm`, reached from the same sheet. It hides
quantity-and-price in favour of an amount and a currency for a cash row, and
offers `income` as a side wherever it makes sense.

### Existing rows are not migrated

The 15 crypto zero-price `transfer_in` rows are staking rewards and wallet
deposits and stay as they are: their cost basis of zero is correct for a
transfer, and re-pricing them needs a per-row decision about what each one was.

**Two rows are repaired, on the owner's instruction and separately from this
work.** *(Applied 2026-08-24. The figures below are corrected — see the two
notes at the end of this section, both found while doing it.)* 300 `ACME.AS`
on 2025-01-01 and 20 on 2026-01-09 are employee share programme grants — real
shares, right quantity, recorded at price 0. Priced at the nearest trading day
from the app's own history:

| Date | Shares | Trading day | Close | Value |
|---|---|---|---|---|
| 2025-01-01 | 300.0 | 2024-12-31 (New Year's Day is a holiday) | €25.005 | €7,501.50 |
| 2026-01-09 | 20 | 2026-01-09 | €25.00 | €500.00 |

Effect on the position: quantity unchanged at 1,500.00; cost basis €18,000.00 →
€26,001.50; average cost €12.00 → €17.33; **realised P&L €15,000.00 →
€12,500.00**; unrealised €35,000.00 → €29,498.50. The value of the holding does
not move — only the split between cost and gain. Realised plus unrealised falls
by exactly €8,001.50, the grant value, which is the invariant that confirms it.

**Correction 1 — the projected figures above were wrong.** An earlier draft
added €8,001.50 straight onto the cost basis and reported €34,798.47 with an
average of €21.71, and did not mention realised P&L at all. It cannot work that
way: the 2025-01-01 grant sits *before* the Feb and Mar 2026 disposals, so under
average-cost accounting those sells now consume basis at a higher average and
realise €2,500.00 less. The basis rises by €10,357.36, not by the full grant
value; the remainder comes out of realised profit. Any repair interleaved with
later sales has this shape.

**Correction 2 — the rows are `buy`, not `transfer_in`.** This section asserted
that `transfer_in` "already carries a cost-basis price, so this needs no new
feature". The first half is true and the second still holds, but the rows were
never transfers. That matters: `ledger-audit` debits a `buy` against its native
currency, so pricing them as buys reported €8,001 leaving a euro account that
never held it — the EUR shortfall went from €40,000.00 to €48,001.50. A grant is
an inbound delivery: shares arrive, no cash moves. The repair changes the side
as well as the price, and the audit then comes out byte-identical.

The average cost of €12.00 is the tell: Shell has not traded near €13 in the
five years of history the app holds. That figure exists only because 21% of the
position was recorded as free.

Whether zero or market-value-at-vest is correct depends on the scheme's tax
treatment, which is the owner's to establish. The dates are also approximate:
a grant dated 2025-01-01 did not vest on a market holiday, so €25.00 is the
closest honest price rather than the vest-day price.

This repair needs no new feature — `transfer_in` already carries a cost-basis
price. It is a two-row data fix, run against a copy first. Done in
`scripts/repair-share-grants.mjs`, which refuses unless it finds exactly one row
per grant, refuses a row already repaired, and refuses a total that is not
€8,001.50.

## Testing

- **Contract suite** entries for `listQuotes`, `listAlerts` and `createAlert`,
  run against `HttpClient` **and** the stub over `MemoryStore`. A method that
  only ever runs against `HttpClient` proves `HttpClient` agrees with itself.
- **A EUR trade stores both figures.** With the rate scripted on a `FakeNet`, a
  price of €2,000 on a past date stores `nativePrice: 2000`, `nativeCurrency:
  "EUR"`, and the USD figure for *that day*. A conversion that silently used
  today's rate fails this.
- **Parity between the two entry paths.** A hand-added `ASML.AS` trade and an
  imported one, same figures in, must produce the same cost basis. This is the
  test worth having: it is the assertion that §2 actually closed the gap rather
  than adding a second, differently-wrong path.
- **An equity alert fires.** A price target on `ASML.AS` evaluated against a
  scripted provider quote, proving the branch is reached — `FakeNet` throws on
  an unmatched URL, so a request that still went to Binance fails outright.
- **The sheet closes** on Escape, on a scrim tap, and on navigation.

**What tests will not catch:** whether the converted USD figure is *right*, as
opposed to merely present and stable. The rate lookup is scripted in tests, so a
sign error or an inverted rate passes everything. After this lands, add one EUR
trade by hand against a copy of the database and check the resulting cost basis
against the same trade imported through the CSV path.

## Out of scope

- **Repairing existing rows.** This changes what new entries can record. Any
  European equity added by hand before it is still stored at its native price
  treated as USD. Identifying and fixing those is a data question and needs the
  affected rows shown to a person first — several were imported, and those are
  already correct.
- **Reconciling the three currency lists** (§2).
- **Percent-swing alerts in the sheet** — decision 5. They exist and are
  portfolio-scoped; the alerts page is where they are raised.
- **The alerts page itself**, which keeps its full form.

## Sequencing

Four groups, in this order. The second cannot be split further, and
working out why is what corrected an earlier draft of this section.

**First — §1, the sheet.** Wholly independent: it moves existing forms into a
new container and changes no data. Ships alone.

**Second — §2, §3 and §4 together, as one unit.** The temptation is to ship the
prefill early, since it is a one-line read of a prop that already exists. That
would make things worse. Prefilling from `history` fills the price field with
the asset's *native* currency — 457.58 for AMD, which is USD and correct under
today's rules, but 1489.40 for `ASML.AS`, which is euros and would be stored as
dollars. Today that mistake requires someone to type a euro figure into a field
meaning dollars. With the prefill and without §2, it takes one tap. The picker
has the same shape: a form that submits `nativeCurrency` to a service that
ignores it silently records the wrong number.

**Third — §6, cash and income.** Now the largest section, and the only one with
a database migration. It goes last because the new side reaches 34 branch sites
across eight files in `packages/core`, and every one of them is arithmetic
someone reads as fact. Doing it alongside anything else makes a wrong figure
hard to attribute.

**Fourth — §5, the alert sheet and the evaluator.** Server-only, outside the
seam, and the place where a mistake is quietest: a broken evaluator reports
success while checking nothing, as it did this morning until someone asked a
question that happened to look at it.

The rule throughout is the one the symbol rename ran under: the app is correct
after every task, not only after the last one.

## Decisions that need a person

None. All six settled 2026-08-24.
