# Brand and layout guide

For anyone — human or agent — writing UI or copy for this app. It describes
what the app already is, not an aspiration. When a rule here and the code
disagree, the code is probably right and this file needs updating.

## The name

**Cairn.** A cairn is a pile of stones you build yourself to mark where you
have been and which way you are going. That is the app: your own record,
assembled transaction by transaction, on your own machine, showing where you
stand. It is short, says itself, has no fintech baggage, and the mark — stacked
stones — is already a bar chart.

Alternates considered: *Waterline* (how deep you are in — good for the risk
metric, long as a label), *Lodestar* (guiding star, slightly grand), *Peil*
(Dutch for gauge, opaque to everyone else).

Write it **Cairn**, never CAIRN or cairn mid-sentence. No tagline in the UI.

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
- **One question per page.** Portfolio: *what do I have and what has it done
  lately.* Insights: *how has it performed and why.* Chart: *the indicator.*
  More: *everything else.* If two pages answer the same question, one is wrong.
- **Progressive disclosure over density.** Rows expand or link; forms hide
  behind a button; secondary figures hide behind "Show details" on phones and
  appear inline on desktop.
- **Never block the screen on the network.** Show cached values immediately and
  say they are stale; let slow parts (charts, history) fill in behind.

## Colour

Dark only. Neutral surfaces, one accent, and colour reserved for meaning.

| Role | Token |
|---|---|
| Page background | `#0a0a0a` (`bg-neutral-950`) |
| Panel / card | `bg-neutral-900` |
| Border | `border-neutral-800` (quiet) · `border-neutral-700` (inputs) |
| Primary text | `text-neutral-100/200` |
| Secondary text | `text-neutral-400` |
| Muted / captions | `text-neutral-500` (the workhorse) |
| Action | `bg-blue-600` · active tab `text-blue-500` |
| Gain | `text-green-500` |
| Loss | `text-red-500` |
| Warning, degraded data | `text-amber-500` |
| Benchmark line | `#eab308` (yellow) against the portfolio's blue |

Green and red mean money moved, never "success" and "error". A destructive
button is red text, not a red block: it should read as serious, not alarming.

## Type and numbers

- **Geist Sans** for everything; **Geist Mono** for tickers, symbols and
  anything the eye scans in a column.
- Money always goes through the display-currency formatter — never a bare
  number with a hardcoded symbol. Locale follows currency (`de-DE` for EUR).
- Percentages: two decimals for returns, one for shares and quick reads.
  Always signed (`+1.42%`).
- Quantities: up to 8 decimals, never padded.
- Dates in prose use the reader's locale; dates in exports and inputs use ISO.

## Icons

Lucide, and only ever alongside a label — never a bare icon button except the
tab bar (which keeps its labels anyway) and the symbol picker's chevron.

`size={12}` inline with small text · `size={14}` in buttons · `size={16}` in
lists and fields · `size={20}` beside a page heading. Always `aria-hidden`;
the label carries the meaning.

## Components already established

Reuse these before inventing anything:

- **Stat tile** — label above value, optional `signed` for colour, `big` for
  headline figures, optional `sub` for a change badge.
- **Row-as-link** — icon, name and secondary line on the left, value and change
  on the right, `ChevronRight` at the end. Used for holdings.
- **Tabs** — underline style, count and subtotal in the label, only rendered
  when there is more than one meaningful tab.
- **Range picker** — small text buttons, active one filled `bg-neutral-800`.
- **Disclosure** — a text button that toggles a panel; used for Manage, stat
  details and the transaction form.
- **Empty state** — one muted sentence saying what to do, never an illustration.

## Anti-patterns

Things previously removed from this app. Do not reintroduce them.

- Admin controls on the portfolio page.
- A second navigation list duplicating the tab bar.
- The indicator advertised on the money screen.
- Provider or protocol names in user-facing copy.
- A spinner where a cached value could be shown.
- A percentage whose baseline makes it meaningless (all-time return against a
  first purchase) — show the absolute figure instead.
- Fake precision: a total that silently omits unpriced holdings without saying
  so.

## Checklist before shipping UI

1. Does it read on a 390 px screen without horizontal scroll?
2. Is the first screenful still data?
3. Does every number say what it is, and admit when it is unknown?
4. Colour used only for meaning, gain/loss the right way round?
5. Icons paired with labels, `aria-hidden` set?
6. Does anything block on the network that could show a cached value first?
7. Does this page still answer only its own question?
