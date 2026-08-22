# Contour — design system

Derived from the shipped code, not from an aspiration. Where this file and the
code disagree, the code is probably right and this file needs updating.
`BRAND.md` is the authority on name, voice and copy; this file is the authority
on tokens, components and layout. Read both before designing.

---

## Product context

A private portfolio tracker for **one person, on their own hardware** — a
self-hosted alternative to Delta by eToro. Crypto and listed securities side by
side, priced in the currency the owner actually spends (EUR or USD). It also
runs one trading indicator (a PineScript port), which is a feature, not the
identity.

Two consequences decide most design arguments:

- **No customers, no funnel.** Nothing persuades, upsells or celebrates. There
  is no onboarding to optimise and no engagement to drive. No empty-state
  illustrations, no confetti, no "You're all set!".
- **The owner is the only reader.** They know what a cost basis is. Never
  explain finance to them — explain *this app's* choices when they are not
  obvious.

### Jobs to be done

| Job | Screen |
|---|---|
| What do I have, and what has it done lately? | `/portfolio` |
| How has it performed, and against what? | `/insights` |
| What is this one asset, and what did I do in it? | `/portfolio/[symbol]` |
| Is the indicator saying anything? | `/chart` |
| Everything else — alerts, settings, import/export, scripts | `/more` |

**One question per page.** If two pages answer the same question, one is wrong.

### Architecture

Next.js App Router, TypeScript, Tailwind v4 (CSS-first, no `tailwind.config`),
Prisma + SQLite, `lightweight-charts` v5. Wrapped in Capacitor for Android;
the shell loads the same web app over the LAN, so **every screen must work in a
WebView** — no passkeys, no Web Push, no hover-only affordances.

Root layout wraps all pages in `BiometricLock` (an overlay, never a replacement
for children) with a `TabBar` below and `pb-20 md:pb-0` on the content.

---

## Colour

**Dark only.** Every surface is painted explicitly; nothing relies on the
browser's colour scheme. Note that `globals.css` still carries Next.js's
light/dark scaffolding and an `Arial` body font — both vestigial, both
overridden by hardcoded classes throughout. Do not design against those tokens.

| Role | Value | Tailwind |
|---|---|---|
| Page ground | `#0a0a0a` | `bg-neutral-950` |
| Raised surface (cards, tiles, inputs) | `#171717` | `bg-neutral-900` |
| Hairline / divider | `#262626` | `border-neutral-800` `divide-neutral-800` |
| Input border | `#404040` | `border-neutral-700` |
| Primary text | `#fafafa` | `text-white` `text-neutral-100` |
| Secondary text | `#a3a3a3` | `text-neutral-400` |
| Label / caption | `#737373` | `text-neutral-500` |
| Footnote / hint | `#525252` | `text-neutral-600` |

`text-neutral-500` is the single most-used class in the app — labels dominate.

### Semantic

| Meaning | Value |
|---|---|
| Accent, interactive, the mark, "you" on a chart | `#3b82f6` (`blue-500` / `bg-blue-600` for buttons) |
| Gain | `#22c55e` (`text-green-500`) |
| Loss | `#ef4444` (`text-red-500`) |
| Benchmark / "them" on a chart | `#eab308` (`yellow-500`) |
| Caution, unreliable figures | `text-amber-500` |

Rules:

- **Green and red mean direction, never decoration.** Never colour a neutral
  figure. A downward shape is not made acceptable by being blue — the mark
  rises for this reason.
- Sign-colour helpers take a number, not a boolean, so zero stays neutral.
- Chart series colours live as hex in the chart components because
  `lightweight-charts` takes strings, not classes.

---

## Type

Geist Sans and Geist Mono, loaded in `layout.tsx` as `--font-geist-sans` /
`--font-geist-mono`.

| Use | Class |
|---|---|
| Page heading | `text-xl md:text-2xl font-semibold` |
| Section heading | `text-sm font-semibold uppercase tracking-wide text-neutral-400` |
| Body / row content | `text-sm` |
| Labels, captions, metadata | `text-xs` |
| Footnotes | `text-[11px] text-neutral-600` |
| Tickers, quantities, dates in tables | `font-mono` |

Sentence case everywhere: "Add transaction", never "Add Transaction".
British spelling in prose ("realised") — but never rename code identifiers to
match.

---

## Layout

**Mobile first, and mobile means a 390px phone held one-handed.**

| | Phone | md and up |
|---|---|---|
| Page shell | `px-3 py-4` (data-dense) or `px-4 py-5` | `p-8` |
| Max width | full | `max-w-xl` settings · `max-w-3xl` lists · `max-w-4xl` forms and detail · `max-w-5xl` insights · `max-w-6xl` portfolio |
| Bottom padding | `pb-20` (clears the tab bar) | `pb-0` |

Spacing scale in practice: `gap-1` `gap-2` `gap-3`, `px-2` `px-3`, `py-1`
`py-2`, `mb-2` `mb-4` `mb-6`. Nothing larger — density is the point.

Corners are `rounded` (4px) for surfaces and `rounded-full` only for avatars,
asset icons and pills. No large radii, no shadows anywhere: depth comes from
the `neutral-900`-on-`neutral-950` step plus a hairline border.

Structural rules:

- **The first screenful is data.** Administration, settings and destructive
  actions live behind More. A control not read every day does not belong on
  `/portfolio`.
- **Progressive disclosure over density.** Rows expand or link; forms hide
  behind a button; secondary figures hide behind "Show details" on phones and
  appear inline on desktop.
- **Never block the screen on the network.** Render cached values immediately
  and say they are stale; let charts and history fill in behind a skeleton
  (`animate-pulse` on a bordered box of the final height, so nothing jumps).
- Long tables paginate at 10 rows rather than scrolling forever, and the
  calculation always runs over the full set even when the view shows a page.

---

## Components

| Component | Contract |
|---|---|
| `ContourMark` | The logo. A rising price line and a parallel offset of itself, flat `#3b82f6`. Geometry is duplicated in `scripts/generate-icons.mjs` — change both, then re-run it. |
| `CoinIcon` | Asset icon. Circular; equity logos clipped with `object-fit: cover` on a white disc; failures tracked per-URL, never a sticky global flag. Served through `/api/icon` so no third party learns the holdings. |
| `TabBar` | Fixed bottom nav on phones. The reason every page carries `pb-20`. |
| `ValueChart` / `ComparisonChart` / `PriceChart` | `lightweight-charts` areas and lines. Curved, thinned to ~1 point per 3px, auto-fitted, `vertTouchDrag: false` so the page scrolls instead of the chart. |
| `TxForm` | Add a trade. Takes `lockedSymbol` on an asset page so the ticker cannot be got wrong. |
| `PrivacyToggle` / `usePrivacy` | Privacy mode. First item in the More menu. |
| `BiometricLock` | Fingerprint overlay. Must overlay, never replace children — replacing them strips the SSR HTML from every page. |
| `AssetInfoPanel` | Background, stats, sentiment, headlines. Loads after the position, and renders nothing at all rather than an error. |

### Formatting

All figures go through `src/lib/display.ts` — `money()`, `quantity()`,
`percent()`. Never format inline: privacy mode masks at this layer, and
anything bypassing it leaks amounts.

---

## Privacy mode

A first-class state, not a nicety. When on, every amount and quantity renders
as `•••••` while percentages, tickers and shares stay visible, so the app can
be read on a train. **Any new screen must be designed twice — with figures and
without.** Chart price axes hide with the amounts; the shapes stay.

---

## Motion

Almost none, deliberately. `animate-pulse` on loading skeletons and
`transition-opacity` on hover-revealed controls is the whole vocabulary. No
page transitions, no entrance animations, no number tickers. Charts animate
only because the library redraws them.

Hover-only affordances (`md:opacity-0 md:group-hover:opacity-100`) must be
`md:`-gated — there is no hover on the phone, which is the primary target.

---

## Voice in the interface

- **Say what a number is, not how it was computed.** "no live price", never
  "no Binance USDT market". Provider names belong in Settings.
- **Be honest about uncertainty.** An unpriced holding shows "—" and is excluded
  from totals with a note saying how many. Never substitute zero for unknown.
  Never clamp a negative balance to look tidy.
- **Name the caveat where the number is**, not in a help page.
- **Destructive buttons say what they destroy**: "Delete portfolio…". A trailing
  ellipsis means a confirmation follows.

---

## Anti-patterns (each removed once already)

- Light-mode surfaces, or relying on `prefers-color-scheme`.
- Card shadows, large radii, gradient fills. A gradient logo was tried and
  dropped.
- Marketing furniture: hero sections, feature grids, testimonials, CTAs.
- Explaining finance to the owner.
- Formatting money inline instead of via `display.ts` (defeats privacy mode).
- Charts that swallow vertical touch drags.
- A checkmark-shaped mark — it reads as a verification badge.
