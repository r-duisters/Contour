# Design audit — 2026-08-23

Read-only sweep of all twelve screens and the twenty shared components against
`BRAND.md`. No code changed.

The headline: **the app is far more consistent than a quick look suggests.**
Page shells, colour, type scale, mono usage, icon accessibility and destructive
styling are clean across the board. What varies is the tier *below* the
documented rules — the places `BRAND.md` never got specific enough to be
checkable.

## What is already right

Worth stating, because these are the expensive things to fix later and none of
them needs fixing:

- **Page shells** — all twelve conform. Correct padding pair, correct
  `min-h-screen md:min-h-[calc(100vh-3.5rem)]`, correct max-width per page
  type, and no page adds its own `pb-20`.
- **Section headings** — one idiom, `text-sm font-semibold uppercase
  tracking-wide text-neutral-400`, used in eight files with no drift.
- **Type scale** — nothing below 11px anywhere.
- **Monospace** — every use is an identifier: ticker symbols, rule ids,
  PineScript source, alert expressions. No figures in mono.
- **Icons** — 26 of 26 lucide icons carry `aria-hidden`.
- **Destructive actions** — all three are red *text* with an underline, never a
  red block.
- **Money** — every money screen formats through `lib/display`.

---

## Findings

Ordered by what a user would notice, not by effort.

### 1. Two screens show a spinner where a cached value exists — RESOLVED 2026-08-23

`BRAND.md` names this an anti-pattern and prescribes the alternative: *"Show
cached values immediately and say they are stale."*

`/portfolio` does exactly that — it reads a cached valuation from local
storage, renders it at once, and marks it *"Showing values from …"*
(`portfolio/page.tsx:117-120, 307-309`).

Nothing else does. `/ledger:92` and `/portfolio/[symbol]:201` both block on a
bare `Loading…` with no cached fallback, and both display figures that were on
screen moments earlier.

**Resolved.** All three screens now share one cached valuation through
`useCachedValuation`, derived at render rather than copied into state, and
each says when its figures are from via `StaleNote`. Verified with the API
throttled: cold shows `Loading…`, warm shows the full figures at 1.5s.

**Why it matters more than it looks:** on a phone on a slow connection this is
the difference between an app that feels instant and one that feels broken —
and it is the screen behaviour Phase 4 inherits, where the data is local and
only the prices are remote.

### 2. The primary button is written out thirteen times in six spellings — RESOLVED 2026-08-23

**Resolved.** `packages/ui/src/Button.tsx`, with a `secondary` variant for the
three `bg-neutral-700` buttons the audit did not count. All sixteen call sites
converted; every filled button now dims to 0.5 when disabled, verified in the
browser. The login form's implicit submit is explicit now, since the component
defaults to `type="button"`.


There is no button component. Every screen re-types the string, and they have
drifted:

| Spelling | Uses |
|---|---|
| `bg-blue-600 text-white rounded px-3 py-1 text-sm inline-flex items-center gap-1` | 5 |
| `bg-blue-600 disabled:opacity-50 text-white rounded px-3 py-1 text-sm` | 4 |
| `bg-blue-600 disabled:opacity-50 … inline-flex items-center gap-1` | 1 |
| `bg-blue-600 text-white rounded px-3 py-1 text-sm` | 1 |
| `w-full bg-blue-600 disabled:opacity-50 … px-3 py-2 text-sm` | 1 |
| the circular add button (`w-16 h-16 rounded-full`) | 1 |

Whether a button dims while disabled is currently a coin flip: six have
`disabled:opacity-50`, seven do not. That is a visible behavioural difference,
not just a class-string difference.

`BRAND.md` lists the components already extracted and says *"a new local copy is
a bug, not a variation"* — but a button is not among them, so nothing was
being violated. The gap is in the guide.

### 3. The input class string is duplicated verbatim three times — RESOLVED 2026-08-23

**Resolved.** Nine sites, not three — the count missed the `<select>`s and
`backtest`'s two variants. `field()` in `packages/ui/src/field.ts` takes the
per-site extras (`uppercase`, `w-24`, `w-36`) so real differences stay visible.
A constant rather than a component, because the callers are not one element.


`alerts/page.tsx:96` and `TxForm.tsx:63` declare an identical
`const input = "bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm"`,
and `SymbolPicker.tsx:73` inlines the same string again.

This one *is* covered by the anti-pattern list. Three copies is how the other
shared components started.

### 4. An undocumented third heading tier, used three ways

`BRAND.md` documents two: the page label and the section heading. A third
exists below them, spelled differently each time:

- `text-xs uppercase tracking-wide text-neutral-500` — `insights:395`
- `text-xs font-semibold uppercase tracking-wide text-neutral-500` — `AssetInfoPanel:84`
- `text-xs font-semibold uppercase tracking-wide text-neutral-400` — `ledger:240`

Two axes vary independently — weight and colour — which is the signature of a
tier nobody decided on.

### 5. Two page-header idioms, with no rule for which applies — **RESOLVED 2026-08-23**

`/portfolio` uses the documented subordinate page label — small, uppercase,
`tracking-widest`, `text-neutral-500` — with the value dominating beneath it.

Every other screen uses a `text-xl md:text-2xl font-semibold` title.

Both are in `BRAND.md`; what is missing is when each applies. `/ledger` and
`/insights` both lead with figures and would plausibly qualify for the
portfolio treatment, so today the choice looks arbitrary rather than principled.

This is a **product decision, not a cleanup** — it changes how three screens
read. It wants an answer before it wants an edit.

**Resolved.** The owner chose the eyebrow everywhere, and named the chart as
the worst offender — it had no page identity at all. `PageLabel` now carries
the icon-and-label pair; the row around it stays each page's own, because the
portfolio's controls and the chart's bordered bar are real differences rather
than drift. The ledger's subtitle went: its sentence already lives in this
guide as the question the page answers. Written into `BRAND.md`, so the next
screen inherits it instead of re-inventing it. (`32dbe30`)

### 6. Empty states vary in tier, spacing and helpfulness

Nine empty states. Eight use `text-sm text-neutral-500`; `portfolio/[symbol]:330`
uses `text-xs`. Padding is `py-2`, `py-4`, `py-2 mb-6`, or nothing.

More substantively, `BRAND.md` asks for *"one muted sentence saying what to
do."* Some do:

- *"No holdings yet — add a transaction below."*
- *"No alerts yet — build one above and press Create."*

Several do not:

- *"Nothing here yet."* (`insights:414`)
- *"No portfolio yet."* (`insights:178`)
- *"No priced holdings."* (`insights:291`)

### 7. One quantity bypasses the display layer — RESOLVED 2026-08-23

**Resolved.** `backtest/page.tsx` renders `quantity(t.units)`, which stops the
padding to six decimals and brings the figure under privacy mode.


`backtest/page.tsx:112` renders `{t.units.toFixed(6)}`. `BRAND.md` says
quantities go up to eight decimals and are **never padded**, and that formatting
goes through `lib/display`'s `quantity()`.

Narrow, and the backtest is the one screen with a documented exemption for its
*equity* figure — but that exemption is about currency, not about padding a
quantity.

---

## Deliberately not findings

- **`describe()` in `alerts/page.tsx:195` renders a raw target price.** It reads
  as part of an expression (`BTCUSDT ≥ 4200`), which `BRAND.md` explicitly
  assigns to mono as an identifier. Arguable either way; the open question is
  whether privacy mode should mask it, which is a product call.
- **`PortfolioManager`'s separate portfolio selection.** A third independent
  selection state, but administering a portfolio and viewing one may genuinely
  be different concepts. Product decision.
- **The backtest's unsymbolled equity figure.** A documented, deliberate
  exception.

## Suggested order

1. **#1 (loading states)** — the only finding a user feels rather than sees.
2. **#3 (input copy)** and **#2 (button)** — extract both; #3 is already an
   anti-pattern and #2 removes the `disabled` coin flip.
3. **#7 (quantity)** — one line.
4. **#6 (empty states)** — pick one tier, then rewrite the three unhelpful
   sentences.
5. **#4 (third tier)** — decide it, then write it into `BRAND.md` so it becomes
   checkable.
6. **#5 (page headers)** — decide first; it changes how three screens read.

Findings 2, 3 and 4 also want a line in `BRAND.md` afterwards. A rule that is
not written down is one the next screen will re-invent, which is how all four
of these started.
