# Store the asset, not the pair

Written 2026-08-24, after the owner said: *"I don't think I really bought
ETHUSDT."*

They are right, and the ledger agrees with them.

## The evidence

Every one of the 261 crypto transactions is stored under a USDT pair — 23
symbols, all suffixed. What those rows actually record is something else:

| How the trade settled | Rows |
|---|---:|
| Euros | 120 |
| Another coin — IOTA for ETH, DOT for BNB, XMR for BTC | 52 |
| Nothing (a transfer in) | 15 |
| Dollars | 74 |

Ethereum is the clearest case. Of its 113 rows, **not one is an ETHUSDT
trade**:

```
ETHUSDT  EUR  buy   46 rows   104.71 ETH
ETHUSDT  EUR  sell  10 rows    20.17 ETH
ETHUSDT  USD  buy    6 rows     4.21 ETH
ETHUSDT  USD  sell  43 rows    41.60 ETH
ETHUSDT  —    transfer_in 8     5.26 ETH
```

`USDT` is not a fact about the trade. It is the pricing convention the Delta
importer needed to look a price up, written into the column that is supposed
to say *what you own*. The `nativeCurrency` beside it already says what was
paid, and on **172 of 261 rows it disagrees with the symbol** — 120 settled in
euros, 52 in another coin. A further 15 are transfers that settled in nothing
at all, where `USDT` is not contradicted so much as meaningless.

So the bug is not that ETHEUR cannot be entered. It is that the symbol column
answers the wrong question.

## What changes

**`Transaction.symbol` becomes the asset.** `ETH`, `BTC`, `IOTA`. An equity
ticker is already an asset (`ASML.AS`) and a cash row is already a currency
(`EUR`) — neither moves. Only crypto loses a suffix it never earned.

**What was paid is already recorded.** `nativeCurrency`, `nativePrice` and
`nativeFee` exist and carry it. This change stops the symbol column
contradicting them; it does not add a concept.

**A pair becomes a pricing detail, resolved in one place.** Nothing stored
mentions a pair. When a price is needed, `pricingPair("ETH")` returns
`"ETHUSDT"` and lives beside the Binance source that is the only reason pairs
exist.

**Entry accepts any pair.** Typing `ETHEUR` in the transaction form records
asset `ETH`, `nativeCurrency: EUR`. Typing `IOTAETH` records asset `IOTA`,
`nativeCurrency: ETH` — which is what 52 rows already mean and cannot
currently be said. The pair is split on the way in and discarded.

## What it touches

Twenty-two files mention `USDT`; sixteen places either slice four characters
off a symbol or ask something for its base asset. They fall into three
groups:

1. **Storage and aggregation** — `portfolio.ts`, `valuation.ts`, `series.ts`,
   `insights.ts`. These get simpler: they stop calling `baseAsset()` because
   the symbol already is one.
2. **Pricing and charts** — `binance.ts`, `pricing.ts`, `/api/candles`,
   `/api/history`. These gain `pricingPair()` at the boundary.
3. **Strategy tooling** — the chart, the backtester, the alert evaluator.
   These are Binance-facing by nature and keep speaking pairs. `BTCUSDT` is
   the right symbol for a Binance kline request; it was never the right
   symbol for a holding.

`CoinIcon.baseAsset()` stays, because it must still read legacy strings and
equity tickers, but crypto stops needing it.

## Migration

One data migration, deterministic and reversible.

- Strip the quote suffix from `Transaction.symbol` where `assetType='crypto'`.
  All 23 symbols end in `USDT`; the inverse is appending it.
- Update `Alert.symbol` on the two rows that carry one. *Decision needed —
  see below.*
- Take a backup first. The existing export is the mechanism; it is already how
  the fee audit was verified.

**No positions merge.** Each of the 23 coins appears under exactly one pair,
so stripping the suffix cannot collide two holdings into one. This was checked
against the live database, and the migration should assert it rather than
assume it — if a future ledger holds both `ETHUSDT` and `ETHEUR`, merging them
is correct but must be visible.

**Round-tripping.** The backup and CSV exports carry symbols. Both need to
read old files and write new ones, or a restore silently reintroduces pairs.

## Decisions that need a person

1. **Do the strategy alerts follow?** `Alert.symbol` holds `BTCUSDT` on two
   rows. Those alerts evaluate Binance klines, so the pair is arguably correct
   there — but then two columns named `symbol` mean different things.
   *Recommendation: leave alerts on pairs and rename the field's meaning in a
   comment, because that is what they genuinely address.*
2. **What does the asset page URL become?** `/portfolio/ETHUSDT` today.
   `/portfolio/ETH` is the honest form, and old links break.
   *Recommendation: accept both, resolving a pair to its base.*
3. **Does the importer keep writing pairs?** It should not, but Delta's export
   speaks pairs, so the mapping moves into the importer.

## Out of scope

Widening `SymbolPicker` beyond USDT pairs. It is a separate, smaller change
and it is only safe *after* this one — offering `ETHEUR` today creates a
second ETH position that never sums with the first.

## Why this is worth doing

Not to enable a feature. The ledger currently records 172 trades under a name
that contradicts what was paid for them, and every figure
derived from it — cost basis, realised profit, the average cost the asset page
prints — is computed against that name. The arithmetic happens to be right
because `nativePrice` carries the truth. The label is wrong, and a label that
is wrong for a good reason is still the thing a person reads.
