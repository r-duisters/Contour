# Markets tab, and the chart as a destination — design

2026-08-24. Approved by the owner; mockup at
`https://claude.ai/code/artifact/2f4a9a4f-3b90-4e8d-9f60-107034504cca`.

Two changes that depend on each other. The chart on a holding becomes a way
into the detailed chart, which frees the fourth tab for a page answering
**what is the market doing today**.

## 1. What the data can do

Tested against the live endpoints rather than assumed, 2026-08-23.

| Category | Movers | Largest | Verdict |
|---|---|---|---|
| Crypto | Binance `/api/v3/ticker/24hr` — every pair, one call, no key | CoinGecko `/coins/markets` — cap and 24h together | ships |
| Stocks | Yahoo saved screeners `day_gainers` / `day_losers` | same response carries `marketCap` | ships |
| ETFs | filtered screener returns **401 Invalid Crumb** | net assets behind the same wall | **dropped** |

ETFs are out. They could only have been a list chosen by hand with no ranking
behind it and no honest way to call it "top". The 401 is the same
cookie-and-crumb gap recorded in the standalone-Android spec §4.2; if that is
ever solved, ETFs become possible and this decision should be revisited.

## 2. Two things only live data showed

- **A losers list with no losers.** At a $50m volume floor, all five weakest
  liquid crypto pairs were *positive*. At $10m, four of five were genuinely
  down. A column headed "Top losers" showing gains is worse than nothing, so
  the headings are **Up today** and **Down today** and each renders only rows
  that moved that way — an empty column is a true statement.
- **Pegged coins crowd the bottom.** EURI and RLUSD surfaced among the weakest
  at −1.0% and −0.0%. A volume floor does not remove them; an explicit
  exclusion list does.

## 3. The page

One question: *what is the market doing today.* Category first, because crypto
and equities do not compare. Then the extremes, then the weight.

- Segmented control: **Crypto · Stocks**.
- **Up today** / **Down today**, five rows each, only genuine movers.
- **Largest by market cap** — a ranked table with price, day change and cap.
- Rows the owner holds carry a **held** marker. This is the one thing the page
  can say that a public market site cannot.
- Every row opens the existing asset page, so nothing new is designed for
  "what is this thing".
- Icons through `CoinIcon`, which already falls back to coloured initials.

**Market prices do not obey privacy mode.** Every figure on a money screen goes
through `lib/display`, which masks when amounts are hidden — but Bitcoin's price
is not the owner's money. Masking it conceals nothing and makes the page
useless. Market figures format through a non-masking path; the `held` marker is
the only element that hides.

## 4. Cache freshness

One number for the page would be wrong: the three calls are not constrained by
the same thing. Stays in the vocabulary the app already speaks — 5, 15, 60.

| Call | TTL | Constraint |
|---|---|---|
| Binance `/ticker/24hr` | **60s** | Weight 80 of 6,000/min. The cheapest call in the app; one response covers every pair. |
| CoinGecko `/coins/markets` | **15 min** | The only call that can approach the free tier's ~10,000/month. Supplies rank and cap, which barely move. Returns no rate-limit headers, so the margin is designed in rather than reacted to. |
| Yahoo screeners | **5 min open, 60 min closed** | Matches the existing intraday TTL. Between 16:00 and 09:30 New York nothing changes, and it is an undocumented endpoint. |

**One freshness per screen.** Split TTLs would put a 60-second price beside a
15-minute one in the same table, so the ranked crypto table takes price and 24h
from the Binance response already in hand; CoinGecko contributes rank and cap
only. Seven of the top eight have a Binance USDT pair — USDT itself does not,
being the quote asset, and falls back to CoinGecko's price.

**TTL is a ceiling, not a rate.** `cached()` refreshes on demand; nothing polls.
No background job and nothing to schedule.

## 5. The chart as a destination

`/chart` already holds a symbol in state with a picker; it never reads one from
the URL. It will, and the sparkline on a crypto holding links to it.

- **Crypto only.** `/api/candles` is Binance, so an equity has no candles. The
  sparkline on a stock stays a picture — a dead tap is worse than no tap.
- **The chart keeps a home.** With the tab gone it belongs on More beside the
  backtest and the analyzer, where the rest of the strategy tooling lives.

### The risk pane off Bitcoin

Measured over 3,000 daily bars per pair:

| Pair | Inside 0–1 | Max | Sell signals |
|---|---|---|---|
| **BTC** | **99%** | 0.96 | **5** |
| BNB | 98% | 1.32 | 46 |
| ETH | 87% | 1.19 | 49 |
| LTC | 87% | 0.82 | 1 |
| XRP | 85% | 1.92 | 135 |
| ADA | 81% | 1.11 | 28 |

The shape travels; the scale does not. The damage is in the ladder, not the
line: the `> 0.95` sell tier has no latch and fires on every bar above that
level, so an asset whose ceiling is 1.92 sits up there for weeks and produces
135 sell signals where Bitcoin produces 5.

**Decision.** For a non-BTC symbol the risk line is drawn with the axis scaled
to the data and the **buy and sell markers are suppressed**, with the pane
labelled as calibrated for Bitcoin. "Where is this in its own range" is a fair
read of the curve; the thresholds are the part fitted to one asset.

Per-asset recalibration is issue #13, and is deliberately not in this work: the
curves encode diminishing returns over calendar time measured from Bitcoin's
genesis, and the 1,460-bar warm-up leaves roughly 1,500 usable bars to fit
three curves against.
