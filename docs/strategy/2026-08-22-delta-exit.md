# Delta exit strategy

**Status:** draft for decision · **Date:** 2026-08-22 · **Author:** Roy

A free, local-first mobile portfolio tracker for people leaving Delta, built
from the app that already exists here.

---

## 1. The bet

Delta was acquired by eToro. Its users are tracking money they own inside an
app owned by a broker that would like to sell them something. Some of them
want out, and the thing that keeps them in is not features — it is the
transaction history they would have to abandon.

We already own the hard half of that exit. `src/lib/delta-csv.ts` is 286 lines
that map roughly eighteen Delta transaction types, normalise venue names,
treat fiat rows as cash rather than positions, and fall back through
quote-side pricing when the export is ambiguous. That parser is the part every
weekend script gets wrong.

**The bet in one sentence:** the portfolio never leaves the phone — a claim a
funded competitor cannot copy, because their business model requires the data.

That is the whole differentiator. Not more features than Delta, not prettier
charts. The one property that is structurally true here and structurally
impossible for anyone selling brokerage.

## 2. Why the shape is free, local-first, no infrastructure

Every previous version of this idea died on the same rock. A hosted service
asks people fleeing a data-hungry owner to hand their complete financial
history to a stranger — it inverts the motivation that brought them. Charging
them compounds it: this audience left partly over Delta's pricing.

Removing the server removes the contradiction, the cost base, the pressure to
monetise later, the multi-tenancy work, and the support surface, all at once.
It is not a compromise version of a bigger plan. It is the only version whose
promise is enforced by architecture rather than by a privacy policy.

## 3. Who it is for

**For:** a Delta user who wants their history somewhere else, tracks a modest
number of holdings across crypto and listed securities, and finds
self-hosting Ghostfolio more machine than they want to own.

**Not for:** multi-account wealth management, dividend and tax reporting,
automated trading, or anyone who needs an account they can log into from two
devices. Those are real needs. Ghostfolio serves the first two well and should
be recommended by name.

## 4. Scope

| In, for v1 | Out, for v1 |
|---|---|
| Delta CSV import | Alerts and push notifications |
| Holdings, value chart, per-asset pages | Home Assistant integration |
| Privacy mode | The risk-metric indicator, backtest, script analyser |
| Crypto prices with no key required | Dividends, income, tax reports |
| Equity prices via a free key the user pastes in | Accounts and platforms as first-class objects |
| Export: Ghostfolio CSV and JSON backup | Any account, login, or sync |

The strategy tools stay in the personal build. They are the reason this app
exists for its author and they are irrelevant to someone arriving from Delta.
Shipping them would confuse the pitch and double the support surface.

The export stays in deliberately. Someone should be able to leave this app the
same way they left Delta. That is the promise being made; it has to be
reciprocal.

## 5. Architecture

Two branches from one codebase.

- **Personal** — the app as it stands. Server, Prisma, Home Assistant,
  indicator, backtest. Unchanged.
- **Public** — local-first, no server, no accounts.

### What ports unchanged

Of the 38 TypeScript files in `src/lib` (tests included), exactly one —
`webauthn.ts` — imports server-only code, alongside `db.ts`, which is the
Prisma client itself. The indicator, the backtester, the portfolio maths, the
Delta parser, insights, performance, display formatting and the exporters are
all pure functions with no I/O, covered by 193 tests.

The discipline of keeping `run(bars)` pure is what makes this migration a
port rather than a rewrite.

### What has to change

| Concern | Now | Public build |
|---|---|---|
| Storage | Prisma + SQLite on a server | SQLite on the device |
| API | `/api/*` routes | Direct function calls |
| Cross-origin | Server-side fetch | `CapacitorHttp` — native requests, no CORS |
| Auth | Password + passkeys, `Settings` row `id: 1` | Device lock only |
| Equity prices | Provider + key in server settings | Same fields, stored on device |

Two details decide the feasibility.

**Native HTTP is what makes zero-infrastructure possible.** A browser cannot
call Yahoo's quote endpoint — it needs a cookie-and-crumb handshake and sends
no CORS headers. `CapacitorHttp` issues the request natively and sidesteps the
restriction entirely. A pure PWA cannot do this; the native shell is load-
bearing, not a convenience.

**Bring-your-own-key already exists.** Settings has `equityProvider` and
`equityApiKey`, with Twelve Data and Alpha Vantage free tiers already wired.
Crypto works out of the box with no key; stocks ask for a free one. No
licensing cost, no relay to run.

The singleton assumption is not a problem to solve — 20 reads of
`Settings` where `id: 1` are correct forever when there is exactly one user
per install.

## 6. Sequencing

### Phase 0 — Prove the parser. **This is a gate.**

Collect five or more real Delta exports from people who are not the author.
Reddit, the Ghostfolio community, anywhere Delta users gather. Run each
through `parseDeltaCsv` and count unmapped rows.

The parser has only ever seen one person's export. Other people have
exchanges it has never met and columns it has never parsed. If it is 80%
right rather than 99% right, the entire premise — *bring your history, it
just works* — collapses, and no amount of good architecture rescues it.

**Pass:** under 1% unmapped rows across every file, with no per-user
special-casing. **Fail:** stop here. A week spent now de-risks a month.

### Phase 1 — Strip to a local-first core

Fork the public branch. Remove alerts, Home Assistant, the indicator, the
backtester and the analyser. Replace Prisma with device SQLite. Collapse the
API routes into direct calls.

### Phase 2 — Price layer on native HTTP

Move every outbound request to `CapacitorHttp`. Verify the Yahoo crumb flow
works natively. Make the missing-key state for equities explicit and
unembarrassed.

### Phase 3 — Import, export, first run

The import screen is the product's front door and deserves more care than any
other surface: show what was read, what was skipped and why, before anything
is written. Confirm the Ghostfolio and JSON exports still round-trip.

### Phase 4 — Distribution

GitHub Releases first — no gatekeeper, no fee. F-Droid next, because it
reaches exactly the privacy-minded audience this is aimed at. Play Store last
if at all: a one-off fee, a privacy policy, and review processes that treat
finance apps with extra suspicion.

## 7. Risk register

Ranked by what actually kills the project, not by likelihood.

**R1 — The parser does not generalise.** *High impact, unknown likelihood.*
The single biggest unknown, which is why Phase 0 is a gate rather than a task.
Mitigation: real exports before any rewrite work begins.

**R2 — Price sources are unofficial.** *High impact, moderate likelihood.*
Yahoo's endpoints are undocumented and can change without notice; CoinGecko's
free tier is rate-limited. Mitigation: the provider abstraction already
exists, bring-your-own-key already works, and a broken source must degrade
honestly — "no price" and excluded from totals, never a silent zero.

**R3 — Background alerts are not possible without a server.** *Medium impact,
certain.* Android throttles periodic work; real push needs infrastructure.
Mitigation: scope alerts out of v1 and say so plainly in the README rather
than letting someone discover it.

**R4 — Support load arrives whether or not money does.** *Medium impact, high
likelihood.* "It didn't import my Kraken rows" comes with free software too.
Mitigation: a stated policy on day one — see open decisions.

**R5 — Two branches drift.** *Low impact, high likelihood.* Shared pure
modules diverge, and a fix lands in one build only. Mitigation: keep `src/lib`
identical across both and let the branches differ only in shell and routes.

## 8. What success looks like

Deliberately not downloads or stars.

- **Phase 0:** five or more real exports parse cleanly.
- **v1:** one person who is not the author imports their history and gets
  totals matching what Delta showed them, within rounding.
- **Six months:** any unprompted issue filed by a stranger. One real user
  who stayed is the whole bar.

## 9. When to stop

Written now, while it is cheap to be honest.

- The parser cannot clear the Phase 0 gate without special-casing individual
  users' files.
- Equity pricing breaks in a way bring-your-own-key cannot cover.
- The migration impulse evaporates — eToro backs off, Delta improves, and
  nobody is actually looking to leave.
- Maintenance stops being interesting. This is unpaid work with no obligation
  attached; the point at which it feels like a duty is the point it has
  stopped being worth doing.

Any one of these is sufficient. Archiving with a clear README is a respectable
outcome, not a failure.

## 10. Open decisions

These need a call before Phase 1, and none of them are technical.

- **Licence.** There is no `LICENSE` file in the repository today. Without
  one, nobody may legally use or fork it, which contradicts everything above.
- **Support policy.** "Open an issue" or "no support, patches welcome"? Either
  is fine; deciding after the first complaint is not.
- **Name.** Does the public app keep Contour, or does the personal build keep
  it while the public one takes a name that says what it is for?
- **Public repository or public builds only.** Open source invites
  contribution and scrutiny; it also invites the support load in R4.
- **Does the public build ever get the strategy tools?** Recommendation: no.
  Not in v1, and probably not later.

---

*Canonical copy. This document is the source of truth; any published version
is a rendering of it.*
