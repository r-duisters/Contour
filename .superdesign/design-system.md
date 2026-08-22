# Contour — design system

**`BRAND.md` in the repo root is the authority.** It holds the tokens, the
type scale, the component contracts, the chart conventions and the
anti-patterns. Pass it as a `--context-file` alongside this file on every
Superdesign command; this file only adds what a design agent needs and
BRAND.md does not carry.

Two documents restating the same values is how they drift. Values live there,
not here.

---

## Product context for a design agent

A private portfolio tracker for **one person, on their own hardware** — a
self-hosted alternative to Delta by eToro. Crypto and listed securities side
by side, priced in the currency the owner actually spends (EUR or USD).

Two consequences decide most design arguments:

- **No customers, no funnel.** Nothing persuades, upsells or celebrates. No
  onboarding to optimise, no engagement to drive, no empty-state
  illustrations, no confetti.
- **The owner is the only reader**, and they know what a cost basis is. Never
  explain finance to them — explain *this app's* choices when they are not
  obvious.

## Screens and what each answers

| Route | Question |
|---|---|
| `/portfolio` | What is it worth, and what has it done over the chosen period? Value and change, nothing else. |
| `/insights` | How has it performed, and what is the position? Benchmarks, allocation, contributors, and the accounting figures. |
| `/portfolio/[symbol]` | What is this one asset, and what did I do in it? |
| `/chart` | What is the indicator saying? A feature, not the app's identity. |
| `/more` | Everything not read daily. |
| `/ledger` | *Designed, not built.* What went in, what came out, what it cost. Has no route and no place in the tab bar yet. |

## Technical constraints a draft must respect

- **Mobile first at 390px.** The Android shell is a Capacitor WebView, so no
  passkeys, no Web Push, and no hover-only affordances.
- Next.js App Router, Tailwind v4 (CSS-first — there is no `tailwind.config`).
- A fixed bottom `TabBar` on phones; every page carries `pb-20 md:pb-0`.
- **Charts are canvas.** A Superdesign draft can only mock them as a static
  shape. Judge layout from a draft; never judge a chart from one.

## Working notes for this canvas

- **The portfolio target is implemented.** The code leads and the draft
  follows: sync the draft down to the code, not the reverse, unless
  deliberately exploring a change.
- **Verify generations against the reproduction.** Every generation in this
  project has quietly dropped content it was told to keep — the ranges, the
  secondary figures, the periods behind a "More" button that was left with
  nothing behind it. Diff before accepting.
- **Hand-authored imports cost nothing.** `import-design-draft --into <id>`
  keeps version history and spends no credits; prefer it for deterministic
  edits. It rejects `{}` in inline handlers as an unresolved JSX expression,
  so write brace-free JavaScript.
