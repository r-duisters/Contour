# A public main repository, with the port as a private overlay

Written 2026-08-30. The counter-proposal to #53, which decided the opposite
direction — one private source of truth, a derived public export. That decision
was sound on the evidence it had. This argues the evidence changed.

Not yet decided. #53 remains the plan of record until this is accepted or
rejected.

## The question

Contour cannot go public as one repository, because `samples/risk-metric.pine`
is Oakley Wood's work and carries no licence, and `packages/core/src/indicator/`
transcribes its curves. NOTICE states that plainly and does not resolve it.

So something has to be held back. The question is *which side of the line the
main repository sits on* — and #53 and this document give opposite answers:

|  | #53 (derived export) | This (private overlay) |
|---|---|---|
| Source of truth | private | **public** |
| Public repo is | a build artefact | the repository |
| Held separately | everything web-only | **the port, and only the port** |
| A contributor's PR | re-applied by hand | merged |

## Why the direction is worth revisiting

Two measurements, neither of which was available when #53 was written.

**The unrelicensable part is frozen.** Commits touching
`packages/core/src/indicator/`, `packages/core/src/pinescript/` and `samples/`
in the last six months: **4**, and not one changed the maths — the most recent
was the mechanical extraction into `packages/core`. Everything else in
`packages/` and `apps/` saw **225** commits over the same period.

Isolating a component that never changes costs nothing after the day you do it.
Isolating the component you work in daily is a tax on every change. #53 isolates
the daily one: the derived export has to be regenerated, re-verified and
re-released for every one of those 225 commits.

**The line is narrower than the tooling assumes.** `offline-tree.mjs` matches
`/indicator|pinescript|backtest/`, which is the right conservatism for a script
that must not miss anything. But NOTICE is specific, and it names two things:

- `samples/risk-metric.pine` — Oakley Wood's script.
- `packages/core/src/indicator/` — "the three sub-metrics and their hard-coded
  time curves are transcribed from it".

Those curves live in `indicator/index.ts`. `primitives.ts` (sma, ema, rma,
stdev, crossover…) and `resample.ts` are generic technical-analysis maths that
mirror Pine's *language built-ins* rather than anything of his;
`packages/core/src/pinescript/` is a linter this project wrote *for* PineScript,
not a derivative of any script; `backtest.ts` is a generic DCA simulator.

**Establishing where the line actually falls is a task below, not an assumption
here.** But if it falls where NOTICE puts it, the private overlay is *two
files*.

## Task 0: ask, before building any of this

NOTICE already says it: "If you intend to redistribute this repository,
resolving that with the original author is the honest first step."

An email to Oakley Wood asking for permission to publish the port under AGPL
costs an afternoon and may make this entire document unnecessary. Nothing below
should be built before that has been tried and has failed or gone unanswered.
It is also, independently, the right thing to do.

## The seam

`run(bars: Bar[]) → { signals, series }` — already named in CLAUDE.md as "the
load-bearing contract", already the single entry point, already consumed by
exactly five call sites:

| Consumer | What it uses `run()` for |
|---|---|
| `apps/web/src/app/api/risk/route.ts` | the whole route |
| `apps/web/src/app/api/backtest/route.ts` | the whole route |
| `apps/web/src/app/api/cron/evaluate/route.ts` | `kind === "indicator"` alerts only |
| `apps/web/src/app/chart/page.tsx` | the risk pane and the signal markers only |
| `packages/core/src/indicator/*.test.ts` | the port's own tests |

This is the pattern the codebase already has a name for. `sendTestNotification`
is optional on `DataClient` because Home Assistant does not exist inside an APK;
the settings screen feature-detects it and draws nothing when it is missing. The
risk metric becomes the same kind of thing: **a capability that can be absent**,
not a dependency that must be present.

## What a public build loses, exactly

Less than "the strategy tooling", because the degradation is per-feature rather
than per-page:

**Kept.** The entire portfolio tracker — holdings, valuation, history, ledger,
insights, markets, import and export, both web and device builds. The
candlestick chart, which does not need `run()`. Price-target and percent-move
alerts, which are the two kinds the device build uses. The PineScript analyzer,
which is this project's own work.

**Absent.** The risk pane and its signal markers on the chart. The backtester.
`/api/risk`. Alerts of `kind: "indicator"`.

Alert kinds are already a closed enum — `["indicator", "price_target",
"pct_move"]` — so the absent one is a value the form does not offer and the
evaluator does not branch to, rather than a code path to delete.

## Two mechanisms

**A. Optional private package.** The public repo declares
`@contour/risk-metric` as an optional dependency and imports it through a
loader that returns `null` when it is absent. The owner's builds install it from
a private registry (GitHub Packages); a contributor's `npm install` simply does
not get it.

*For:* clean, standard, the absence is a first-class state. *Against:* a
registry to run, and a package to version.

**B. Private git submodule** at `packages/core/src/indicator/`, with a stub
committed in the public repo at a path the submodule shadows.

*For:* no registry, no publishing step, works with a private GitHub repo today.
*Against:* submodules confuse contributors, and shadowing a tracked path with a
submodule is an arrangement git makes awkward.

**Recommendation: A.** The loader it requires is a dozen lines and it makes
"absent" explicit in the type system, which is what stops the public build
silently half-working.

## What survives, and what this costs

**Survives.** All seven cross-build guards, because `apps/web` and
`apps/mobile` both live in the public repo — which is the objection that decided
#53 and does not apply here. `contract-coverage.test.ts`,
`local-client.test.ts`, `store-contract.ts`, `more-menu.test.ts`,
`shared-units.test.ts`, `icon-buttons.test.ts`, `links.test.ts` all keep both
halves of their input.

**Costs.**

1. The owner's own build stops being the same artefact as the public one, so
   "works on my machine" gains a new way to be true. A CI job must build the
   public repo *without* the overlay, or the absent path rots unexercised.
2. `offline-tree.mjs` and its test need rewriting: the question becomes "does
   anything outside the overlay import the port", which is a different and
   simpler graph query.
3. The public web app ships with a visible gap where the risk pane was. That is
   a product decision, not a technical one, and it is the real cost of this
   direction.

## Staging

Each stage is useful on its own and none commits to the next.

1. **Ask the author.** If yes, stop; publish everything.
2. **Establish the line.** Decide, and write into NOTICE, exactly which files
   are derived. If it is only `index.ts` and the `.pine` file, say so — the
   conservative regex in `offline-tree.mjs` can stay conservative while NOTICE
   is precise.
3. **Make the risk metric optional in place**, in this repository, with the
   loader and the feature detection. No repo split yet. The public path becomes
   exercisable and testable immediately, and every guard still runs.
4. **Split**, once stage 3 has been running long enough that the absent path is
   known to work. The extraction is then mechanical.
5. **Publish**, which needs #41 settled regardless of direction.

Stage 3 is the load-bearing one and the only one with real engineering in it.
It is also worth doing on its own merits: a codebase where the one
legally-encumbered component is behind a feature-detected seam is easier to
reason about than one where it is imported directly by five call sites.

## Open

- Where the derivation line actually falls (stage 2). Possibly a question for a
  lawyer rather than for us.
- Whether shipping the public web app without a risk pane is acceptable, or
  whether the chart page should be absent entirely rather than partially.
- Whether the device build is affected at all. It reaches none of this today —
  `offline-tree.mjs` reports zero — so on the evidence it is not, and the
  Android release is unblocked by this either way.
