# Brand and layout guide

For anyone — human or agent — writing UI or copy for this app. It describes
what the app already is, not an aspiration. When a rule here and the code
disagree, the code is probably right and this file needs updating.

## The name

**Contour.** A contour line joins points of equal value, and a field of them is
how a gradient is drawn on a flat page — which is what this app does to a
portfolio. It descends from the app's first name, Nabla (∇, the gradient
operator), and keeps that idea while dropping a word already used by a
healthcare company and a crypto-forex platform.

Write it **Contour**. Never "Contour App", never a tagline.

The mark is a rising price line inside four crop marks: the corners in the
accent blue (`#3b82f6`), the line in white (`#fafafa`). Four details are
load-bearing, each of them a failure found by drawing it:

- **The container is partial, never closed.** The app frames the mark in a
  circle twice — the unlock disc in `BiometricLock`, and Android's adaptive
  mask, which most launchers render round and which cannot be overridden. A
  ring, ellipse or any closed round shape of its own puts a ring inside a
  ring, which reads as a misalignment rather than a design. Corners never
  approach the frame's edge, so they survive circle, squircle and square.
- **Corners, not a frame.** Lengthen the arms far enough and they close into a
  rectangle, which is the same failure as a ring plus a checkbox reading.
- **Two colours, not one.** The frame carries the brand and the line carries
  the data. White also holds the strongest contrast against the near-black
  ground, which is what keeps the line legible at 24px.
- **It rises, and it is price action** — a rise, a pullback, a stronger rise.
  A descending mark reads as a loss whatever the colour, and a straight
  diagonal is a claim the app does not make.

**Green, amber and red are unavailable to the mark.** They mean gain, degraded
data and loss everywhere else in the app; a permanently green logo asserts
"up" as a brand claim, and an amber one collides with the warning state.

The mark lives in two places that must stay in step: `ContourMark.tsx` for the
screen, and `scripts/generate-icons.mjs` for every icon file. Change one and run
`node scripts/generate-icons.mjs` to redraw the rest.

## What the app is

A private portfolio tracker for one person, on their own hardware. Crypto and
listed securities side by side, priced in the currency the owner actually
spends. It also runs one trading indicator, which is a feature of the app, not
its identity.

Two consequences that decide most design arguments:

- **No customers, no funnel.** Nothing persuades, upsells or celebrates. There
  is no onboarding to optimise and no engagement to drive.
- **The owner is the only reader.** They know what a cost basis is. Do not
  explain finance to them — explain *this app's* choices when they are not
  obvious.

## Voice

Plain, exact, unhurried. Full sentences in explanatory text; bare labels
everywhere else.

- **Say what a number is, not how it was computed.** "no live price", never
  "no Binance USDT market". Provider names belong in Settings, nowhere else.
- **Be honest about uncertainty.** An unpriced holding shows "—" or "no price"
  and is excluded from totals, with a note saying how many. Never substitute
  zero for unknown. Never clamp a negative balance to make it look tidy.
- **Name the caveat where the number is.** "Value movement over the period.
  Money added or withdrawn in that time counts towards it." — on the figure,
  not in a distant help page.
- **British spelling** for prose ("realised", "unrealised") — but keep code
  identifiers as they are; do not rename fields to chase this.
- Sentence case for headings and buttons: "Add transaction", not "Add
  Transaction".
- Destructive buttons say what they destroy: "Delete portfolio…", "Remove
  CSV-imported transactions…". Trailing ellipsis means a confirmation follows.

## Layout

Mobile first, and mobile means a 390 px phone held one-handed.

| | Phone | md and up |
|---|---|---|
| Page shell | `px-3 py-4` (data-dense) or `px-4 py-5` | `p-8` |
| Max width | full | `max-w-xl` settings · `max-w-3xl` lists · `max-w-4xl` forms · `max-w-5xl` insights · `max-w-6xl` portfolio |
| Headings | `text-xl` | `text-2xl` |
| Body bottom padding | `pb-20` (clears the tab bar) | `pb-0` |

Rules that keep it coherent:

- **The first screenful is data.** Administration, settings and destructive
  actions live behind More. If a control is not read every day, it does not
  belong on the portfolio page.
- **One question per page.** Portfolio: *what is it worth and what has it done
  over the chosen period* — value and change, nothing else. Insights: *how has
  it performed, and against what* — benchmarks, allocation, contributors,
  activity. Ledger: *what went in, what came out, what it cost* — cost basis,
  unrealised, realised, fees, cash, net invested by year, and the January
  valuation. Chart: *the indicator.* More: *everything else.* If two pages
  answer the same question, one is wrong.
- **Progressive disclosure over density.** Rows expand or link; forms hide
  behind a button; timeframes beyond the everyday five hide behind "More" on
  phones and appear inline on desktop.
- **Shared units, not copies.** `StatTile` is the labelled figure and
  `RangePicker` is the timeframe control, everywhere. Both existed three or
  four times over with small differences before they were extracted; a new
  local copy is a bug, not a variation.
- **Never block the screen on the network.** Show cached values immediately and
  say they are stale; let slow parts (charts, history) fill in behind.

## Colour

Dark only. Every surface is painted explicitly; nothing relies on the
browser's colour scheme. The CSS custom properties in `globals.css` are
vestigial Next.js scaffolding — no component reads them, so do not design
against them.

| Role | Token |
|---|---|
| Page ground | `#0a0a0a` (`bg-neutral-950`) |
| Raised surface — card, tile, input | `bg-neutral-900` |
| Hairline, divider | `border-neutral-800` · `divide-neutral-800` |
| Input border | `border-neutral-700` |
| Primary text | `text-white` · `text-neutral-100` |
| Secondary text | `text-neutral-400` |
| Label, caption — the workhorse | `text-neutral-500` |
| Footnote | `text-neutral-600` |
| Action, accent, the mark, "you" on a chart | `#3b82f6` — `bg-blue-600` for buttons, `text-blue-500` for active |
| Gain | `text-green-500` (`#22c55e`) |
| Loss | `text-red-500` (`#ef4444`) |
| Warning, degraded data | `text-amber-500` |
| Benchmark, "them" on a chart | `#eab308` |

Green and red mean money moved, never "success" and "error". A destructive
button is red text, not a red block: serious, not alarming. Sign-colour
helpers take the number, not a boolean, so zero reads neutral — a portfolio
that has made exactly nothing has not made a gain.

Chart series take hex, not classes, because `lightweight-charts` accepts
strings. Grid `#171717`/`#1f1f1f`, axis text `#d4d4d4`, ground `#0a0a0a`.

## Type and numbers

**Geist Sans** for everything, values included. **Geist Mono** is for
*identifiers and code only* — ticker symbols, rule ids, PineScript source,
alert expressions. Both are loaded in `layout.tsx` and
exposed as `--font-geist-sans` / `--font-geist-mono`. Never set a
`font-family` on `body` that competes with them — an `Arial` fallback sat
there for months and silently beat both, so the app downloaded two fonts and
rendered in neither.

| Use | Class |
|---|---|
| Headline figure | `text-[34px] md:text-[42px] font-semibold tracking-tight` |
| Page label | `text-sm font-semibold uppercase tracking-widest text-neutral-500` |
| Section heading | `text-sm font-semibold uppercase tracking-wide text-neutral-400` |
| Body, rows | `text-sm` · row primary `text-base` |
| Any figure in a column | add `tabular-nums` |
| Labels, metadata | `text-xs` |
| Sub-lines, chart annotations | `text-[11px]` |

**Nothing below 11px.** A 10px control was drawn once and rejected: it fails
on a 390px phone held at arm's length.

Numbers:

- **The currency symbol leads**, always — `€142.580,42`, never `142.580,42 €`.
  `Intl` puts it last for a euro in a German locale, which reads as an
  afterthought down a column, so `money()` places it by hand while grouping
  and the decimal mark still follow the locale.
- **Figures are set in the sans face with `tabular-nums`**, not in mono.
  Monospace was doing one useful job — keeping digits in a column from
  shuffling — and `font-variant-numeric` does that job without the typewriter
  texture. Any right-aligned numeric column gets it: holding values, table
  cells, chart annotations.
- **Format through `lib/display`.** `money()`, `quantity()`, `percent()`,
  `axisMoney()`. A bare number with a hardcoded symbol bypasses privacy mode,
  which is the whole reason the layer exists.
- Percentages: two decimals for returns, one for shares and quick reads.
  Always signed.
- Quantities: up to 8 decimals, never padded.
- Dates in prose use the reader's locale; dates in exports and inputs use ISO.

## Charts

`lightweight-charts`, one convention across all of them.

- **Curved lines** (`lineType: LineType.Curved`), and **thin dense series** to
  roughly one point per three pixels. Curving alone does nothing when there
  are more points than pixels: the all-time view packed 3,455 points into
  360px and the drawn line travelled twelve times the width it spanned.
  Averaged into buckets, never sampled — a dropped point takes a peak with it.
  First and last observations pass through exactly, so the endpoint always
  equals the figure printed beside the chart.
- **A price axis only where the level is read.** The portfolio value chart and
  the Insights comparison hide it: the value is printed above the chart, and
  the axis spent a fifth of a 390px screen restating it. The asset price chart
  keeps it — a price chart is read against its levels and its trade markers —
  with `axisMoney()` compact labels, so `€142.580,42` becomes `€143k`.
- **Where the axis is hidden, label the high and low** in the chart's corners.
  A shape without a scale can flatter or alarm: a 2% wobble and a 40%
  drawdown draw the same curve. (`createPriceLine` does not solve this — its
  label renders on the axis that was removed.)
- **`vertTouchDrag: false`** on every chart, or the page cannot be scrolled
  past it on a phone.
- Fit to content on load and on data change; never leave the viewport drifted
  off the data.

## Icons

Lucide. `size={12}` inline with small text · `size={14}` in buttons ·
`size={16}` in circular icon buttons and lists · `size={18–20}` beside a page
label. Always `aria-hidden`; the label carries the meaning.

A bare icon button is allowed only where the target is unmistakable and an
`aria-label` is set: the top bar's add and insights controls, and the tab bar
(which keeps its text labels anyway).

## Components already established

Reuse these before inventing anything. A new local copy is a bug, not a
variation — every one of these existed three or four times over with small
differences before it was extracted.

- **`ContourMark`** — the logo. Geometry is duplicated in
  `scripts/generate-icons.mjs`; change both, then run it.
- **`StatTile`** — labelled figure on a raised surface. `signed` for
  gain/loss colour and arrow, `big` for headline figures, `sub` for a
  secondary line.
- **`RangePicker`** — the timeframe control. Renders the canonical list in
  `lib/ranges.ts`; a screen narrows it with `only`, which is a filter over
  that list and never a second list of its own.
- **`CoinIcon`** — circular asset icon, proxied through `/api/icon` so no
  third party learns the holdings.
- **`TxForm`** — add a transaction. `lockedSymbol` fixes the asset on a
  detail page, where offering a picker invites recording against the wrong
  holding.
- **Holding row** — borderless, separated by space (`space-y-7`), 40px icon,
  then two aligned lines: name against value, ticker · quantity · share
  against the period change. No card, no chevron.
- **Top bar** — small uppercase label on the left, circular icon buttons on
  the right. The page label is subordinate to the value beneath it.
- **Disclosure** — a text button that toggles a panel. Used for Manage, the
  transaction form and closed positions.
- **Empty state** — one muted sentence saying what to do, never an
  illustration.

## Navigation

One structure, two renderings, never both visible at once.

- **Phone** — `TabBar`, fixed to the bottom, four slots: Portfolio, Chart,
  Insights, More. Every page carries `pb-20` to clear it.
- **`md:` and up** — `TopNav`, sticky at the top, the mark at the left and the
  destinations inline: Portfolio, Chart, Insights, Ledger, Alerts, then More.

**More is a phone compromise, not an idea.** It exists because four slots do
not hold the app's destinations; a wide screen has the room, so the desktop
bar lists them rather than mirroring the constraint. Reaching Settings should
not cost two clicks on a screen with space for it.

A page-level shortcut that duplicates a nav destination is `md:hidden` — the
portfolio's Insights button is there for the phone, where the tab bar has no
slot for Insights beyond its own.

Pages claim `min-h-screen md:min-h-[calc(100vh-3.5rem)]`: the top bar is
3.5rem, and a page claiming a whole viewport beneath it leaves that much dead
scroll on every desktop screen.

## Timeframes

One canonical list, in `lib/ranges.ts`. Everyday periods (1D 1W 1M 1Y All)
stay inline; the rest collapse behind **More** on a phone and sit inline from
`md:` up. **The selected period never collapses** — hiding the active choice
leaves a row with nothing selected, which reads as a bug rather than as
tidiness.

Screens may offer a subset. Insights starts at 1M because a time-weighted
return over a single day says nothing. A subset is a filter, never a second
list with its own spelling: four different spellings of the same control is
what this replaced.

## Privacy mode

A toggle at the top of More hides every amount — money and quantities — while
percentages, tickers and shares stay visible, so the app can be read in public
without showing what it is worth.

**Design every screen twice, with figures and without.** Anything revealing
size must respect it, including chart annotations and axis labels, not just
body text. Format through `lib/display` and it happens automatically.

## Motion

Almost none, deliberately. `animate-pulse` on loading skeletons and
`transition-opacity` on hover-revealed controls is the whole vocabulary. No
page transitions, no entrance animations, no number tickers.

Hover-only affordances must be `md:`-gated. There is no hover on the phone,
which is the primary target.

## Anti-patterns

Things previously removed from this app. Do not reintroduce them.

- A `font-family` on `body` that overrides the loaded Geist variables.
- Light-mode surfaces, or relying on `prefers-color-scheme`.
- Gradient fills and card shadows. A gradient logo was tried and dropped.
- A mark that reads as a checkmark — that is a verification badge — or one
  that points downward, which reads as a loss whatever its colour.
- A mark carrying its own closed container. The app already frames it in a
  circle in two places, one of which Android controls.
- Type below 11px.
- A control with nothing behind it. A "More" button was once generated with no
  hidden items; a dead control is worse than a missing one.
- A local copy of a shared component, or a second list backing a shared
  control.
- Admin controls on the portfolio page.
- A second navigation list duplicating the tab bar.
- The indicator advertised on the money screen.
- Provider or protocol names in user-facing copy.
- A spinner where a cached value could be shown.
- Money formatted inline instead of through `lib/display` — it defeats
  privacy mode.
- A percentage whose baseline makes it meaningless (all-time return against a
  first purchase) — show the absolute figure instead.
- Fake precision: a total that silently omits unpriced holdings without saying
  so.
- Marketing furniture of any kind — heroes, feature grids, testimonials, CTAs.

## Checklist before shipping UI

1. Does it read on a 390 px screen without horizontal scroll?
2. Is the first screenful still data?
3. Does every number say what it is, and admit when it is unknown?
4. Does the currency symbol lead, and does the figure go through `lib/display`?
5. Colour used only for meaning, gain/loss the right way round, zero neutral?
6. Icons paired with labels or given an `aria-label`, `aria-hidden` set?
7. Nothing below 11px, and every control has something behind it?
8. Does it use `StatTile` and `RangePicker` rather than a local copy?
9. Does it still read with every amount masked?
10. Does anything block on the network that could show a cached value first?
11. Does this page still answer only its own question?
