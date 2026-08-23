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

The mark is a summit drawn as its own level curves: two nested contour lines
around a peak, the outer in white at 35% opacity and the inner in the accent
blue (`#3b82f6`). The curves are level curves — what the name means — and the
blue sits on the summit so the brand colour lands on the subject rather than
the container.

Four details are load-bearing, each of them a failure found by drawing it:

- **The outer curve stays quiet.** The app frames the mark in a circle twice —
  the unlock disc in `BiometricLock`, and Android's adaptive mask, which most
  launchers render round and which cannot be overridden. A curve at that
  frame's weight and brightness competes with it and reads as a misalignment;
  a dim hairline is clearly subordinate, so the nesting reads as deliberate.
  **Weight and contrast decide this, not whether the shape is closed** — an
  earlier version of this rule banned closed containers outright and was
  wrong.
- **White at 35%, not a flat grey.** The outer curve blends with whatever sits
  behind it; the login card is translucent over an animated backdrop.
- **The blue is on the summit.** Putting it on the outer frame makes the frame
  the loudest thing in the mark.
- **It rises.** The summit points up; a descending or inverted mark reads as a
  loss whatever the colour.

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
| Max width | full | `max-w-5xl` — every primary screen, and `TopNav`. `max-w-xl` settings · `max-w-4xl` forms |
| Headings | `text-xl` | `text-2xl` |
| Body bottom padding | `pb-20` (clears the tab bar) | `pb-0` |

The bottom padding is applied once, by the shell in `layout.tsx`, not by each
page. A page that adds its own is doubling it.

Portfolio, Insights, Ledger and Chart share one column, and `TopNav` shares it
too, so the mark sits directly above the page label. Per-type widths were tried
and abandoned: they put the widest shell around the holdings *list* and the
narrowest around the ledger's five-column *table*, and on a desktop the four
screens visibly failed to line up. A page whose content genuinely wants less
room still narrows inside the column rather than shrinking the shell.

The chart is the one exception, and only half of one: its bar takes the column
so the eyebrow aligns, while the two panes keep the whole window. Letterboxing
1460 daily bars to match a text column would cost the page the thing it exists
to show.

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
- **Shared units, not copies.** `StatTile` is the labelled figure,
  `RangePicker` the timeframe control, `PageLabel` the page identity,
  `StaleNote` the "these figures are from a moment ago" line, `EmptyState` the
  muted one-liner standing in for absent rows, `Button` the filled action, and
  `field()` the class every text input, date, number and select wears. Each existed three to thirteen times over with small
  differences before it was extracted; a new local copy is a bug, not a
  variation, and `packages/ui/src/shared-units.test.ts` now fails the build
  rather than waiting for the next audit to count them.
  - `Button` is `variant="primary"` (blue) or `"secondary"` (neutral), with
    `block` for a full-width submit. It always dims when disabled — that used
    to be a coin flip decided by which line the class was copied from — and
    has no hover state, because this guide never gave it one.
- **Never block the screen on the network.** Show cached values immediately and
  say they are stale; let slow parts (charts, history) fill in behind.

## Colour

Dark only. Every surface is painted explicitly; nothing relies on the
browser's colour scheme — `globals.css` sets the ground to `#0a0a0a`
unconditionally. It did not until 2026-08-23: the properties defaulted to
white and went dark only under `prefers-color-scheme`, so a machine set to
light drew every one of these tokens on the wrong ground. This section used to
claim no component read those properties; `body` did. A light mode is tracked
as issue #12 and is a palette, not a ground.

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

Three consequences that an audit of the strategy screens had to correct:

- **A state is not a gain.** An enabled alert, a saved file, a completed
  action: none of these are green. They take the accent or stay neutral.
- **A direction is not a sign.** A buy is not a gain and a sell is not a
  loss, so the backtest's trade list colours the cash movement, not the side.
- **The analyser's severities map onto the app's meanings**, not onto a
  generic red/amber/green ladder: a warning is amber (the degraded-data
  colour), information is blue, a suggestion is neutral. Red is reserved for
  money lost, so a red lint row read as a loss.

Green and red mean money moved, never "success" and "error". A destructive
button is red text, not a red block: serious, not alarming. Sign-colour
helpers take the number, not a boolean, so zero reads neutral — a portfolio
that has made exactly nothing has not made a gain.

Chart series take hex, not classes, because `lightweight-charts` accepts
strings. Grid `#171717`, axis text `#d4d4d4`, ground `#0a0a0a`. This listed
two greys for the grid until an audit found one chart of three using the
other — a guide that offers a choice is a guide that produces drift.

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
- **A figure that is not the owner's money is the one exception**, and it is
  narrow: the backtest simulates in whatever asset the pair is quoted in, so
  its equity is neither in the display currency nor worth masking. It is
  grouped, carries no symbol at all rather than a wrong one, and the screen
  says what it is denominated in. Never reach for this to dodge the layer on
  an actual holding.
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
- **The indicator chart is the exception, deliberately.** `/chart` draws
  candlesticks, which cannot be curved, and a risk metric read against the
  fixed threshold lines it plots at 0.25 and 0.80. Curving would bend the line away from levels
  the whole strategy is defined by, and thinning would drop the bar a signal
  fired on. It keeps its axis, its raw points and its straight segments.

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
  secondary line. It sets `tabular-nums` itself; tiles are always in a grid,
  so no call site should be adding it.
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
- **`PageLabel`** — how a page says which page it is: an 18px icon in
  `text-neutral-500` beside the page label. Every screen uses it and no screen
  leads with a large title. Four of them once did it four different ways — a
  title here, a subtitle there, an icon at two sizes in two greys, and no
  identity at all on the chart. The icon comes from the nav's mapping in
  `TabBar`/`TopNav`, never a second list.
- **Top bar** — `PageLabel` on the left, circular icon buttons on the right.
  The page label is subordinate to the value beneath it. The row is each
  page's own: the portfolio hangs a picker and an add button off it, the chart
  keeps it inside a bordered bar so the panes lose no height, and a page with
  no controls just renders the label. Only the label pair is shared.
- **Disclosure** — a text button that toggles a panel. Used for Manage, the
  transaction form and closed positions.
- **Empty state** — `EmptyState`: one muted sentence saying what to do, never
  an illustration. Say the thing to do, not merely that there is nothing:
  "No passkeys yet — add one above to unlock with a fingerprint", not "No
  passkeys yet". Where nothing can be done, say why it is empty in words the
  reader can act on later — "Nothing has gained yet", not "Nothing here yet".
  Padding belongs to the caller: an empty state stands in for rows, so it
  takes the spacing of the rows it replaced.

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

On Android the window is also marked `FLAG_SECURE` while the app is
backgrounded, so the recents card shows a blank rather than whatever was on
screen. That snapshot is taken by the system and predates any toggle, so it
cannot be solved in the web layer.

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
  Three exceptions survive on purpose, and they share a reason — each is doing
  a job a flat fill cannot: the sentiment scale runs red through neutral to
  green because the value it encodes is continuous; the login backdrop is
  deliberate art on the one screen with no data to show; and the symbol
  picker's dropdown casts a shadow because a popover has to float above the
  content it covers. A card still never does.
- A mark that reads as a checkmark — that is a verification badge — or one
  that points downward, which reads as a loss whatever its colour.
- A mark whose own container matches the weight or brightness of the frames
  the app puts around it. The unlock disc and Android's adaptive mask are both
  circles; a ring may nest inside them, but only a quiet one.
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
