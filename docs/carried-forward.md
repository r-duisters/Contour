# Carried forward

> **The figures in this document are illustrative.** It described a repair to a
> real ledger, and the amounts, quantities and ticker have been replaced with
> invented ones that preserve the arithmetic the argument depends on. The
> reasoning is unchanged; the numbers are not anybody's positions.

Work that is known about and not done. Written 2026-08-23, after Phases 1–3 of
the standalone-Android restructure landed.

**Why this file exists.** Each phase ran with a progress ledger that recorded
findings, deferrals and the decisions taken along the way, and each ledger was
deleted when its phase merged — the process treats git history as the record.
That is right for *what changed*, and wrong for *what was deliberately not
changed*. Phase 4's plan has to be written from the second list, so it needs to
survive somewhere other than a conversation.

This is an index first. Where something is already documented properly, the
entry points at it rather than restating it — a second copy of a rule is a copy
that drifts.

---

## Already documented, in the code that has to obey it

Do not restate these here. They live where the person who trips over them will
be standing.

| Gap | Where it is written |
|---|---|
| `Net` cannot do Yahoo's cookie-and-crumb handshake. Remedy decided: cookie-jar semantics, not header reading — `Set-Cookie` is unreadable in browser `fetch`, so a header contract is one only Node could keep | spec §4.2, "Known gap" |
| `DataClient` has no export method: the filename lives in a `Content-Disposition` header `Net` does not expose, and a device has no anchor to click | `packages/data/src/client/data-client.ts`, "Export is deliberately absent" |
| Four `/api` URLs live in HTML attributes — `CoinIcon`'s `<img src>` and three export anchors. Each is allowlisted with what Phase 4 must supply | `packages/core/src/boundary.test.ts`, `ALLOWED_API_LITERALS` |
| Which endpoints are deliberately never converted, and why | `CLAUDE.md`, and the header comment in `settings/page.tsx` |
| Seven design-audit findings, all resolved | `docs/design-audit-2026-08-23.md` |
| A possible light mode, and what it would actually cost | GitHub issue #12 |

The allowlist entries are the best of these: the guard fails if a fifth `/api`
literal appears, and each existing one carries a written reason, so the debt is
visible and cannot grow quietly.

---

## Bugs, verified 2026-08-23

### `mqttBrokerUrl` and `mqttTopicPrefix` cannot be set

Both are columns, both are on `Store.Settings`
(`packages/data/src/ports/store.ts:55-56`), and neither appears in the `PUT`
schema in `apps/web/src/app/api/settings/route.ts`. Read-only fields with no
writer. Either wire them up or drop them; MQTT is listed in `CLAUDE.md` as a
viable alternative to the Home Assistant webhook that was never implemented.

---

## Designed, not built

**Equity alerts.** `docs/superpowers/specs/2026-08-24-asset-actions-design.md`
§5 is implemented — see Resolved below. §6 — cash and income — is built; see Resolved below.

**Two corrections to §6**, found while planning it, recorded so the next reader
does not re-derive them:

1. §6 counts 34 branch sites across eight files and calls that "the largest
   single risk". It is really **twelve**, and `asset-info.ts` has **none** — its
   apparent hit is Yahoo's analyst-recommendation keys (`"buy"`, `"sell"`,
   `"hold"`), the same words in a different vocabulary.
2. **Every service already filters cash out** before reaching `tradeStats`,
   `flowsByYear`, `flowsByBar` or `computeHoldings`. So no screen could show a
   wrong figure on the day `income` landed — and a test that only exercises the
   services would pass whether or not the pure functions were right. That is why
   `income.test.ts` calls them directly.

---

## Untested on a device

The Android back button was fixed by registering an `OnBackPressedCallback` in
`MainActivity` — Capacitor 8 ships no back handling and `@capacitor/app` is not
installed, so the system default applied and back finished the activity from
any screen. The Java compiles and the WebView history it walks was verified in
a desktop browser, where client-side routes do accumulate entries and `back()`
moves through them.

**Nobody has pressed the button.** There is no emulator or device in the
development environment, so the one thing that would confirm the fix — a back
press on a phone — has not happened. Worth ten seconds the next time the APK
is installed.

The standalone APK built on 2026-08-28 is that moment: it is the first build
that is worth installing for reasons other than testing this, and it carries
the same `MainActivity`. Alongside it, three things only a handset can settle:
that the app opens and runs in aeroplane mode with prices absent rather than
zero; that an alert fires within a second of the app opening (Task 11); and
that a rule left overnight, face-down and off-charge, either arrives or shows
its silence on the last-checked line (Task 12).

~~The splash-icon sizing rule was measured on one phone.~~ **Settled
2026-08-30**: an Android 16 emulator at the same 1080×2340 and 480dpi — AOSP
rather than One UI — draws the disc at 336 device pixels, exactly 112.0dp, and
exactly centred. The rule in `docs/android-launch.md` is Android's rather than
Samsung's.

---

## Still blocked on the Yahoo crumb

- Yahoo's cookie-and-crumb gap now blocks a third Markets category as well as
  the equity half of `/api/asset/[symbol]`. The predefined screeners behind
  Crypto and Stocks need no crumb; every ETF screener does, and answers 401
  without one. Solving the gap (spec §4.2) unlocks ETFs on Markets for free —
  the service already takes a category, and the page already switches on one.

---

## Performance, for Phase 4 rather than now

**Insights issues many requests per paint.** Seven `client.*` call sites, which
a Phase 3 task measured at 13 requests on first paint and 12 more per benchmark
change, sequenced in pairs.

This gets *worse* on a device, not better: `LocalClient` makes the series half
free because that data is local, and leaves the benchmark half on the network.
Half the screen will be instant and half will wait on a mobile connection.

**Still unmeasured on hardware.** The APK now exists, so this is measurable
rather than predicted, and the measurement is the next step — not a fix.

**`cached()` is no longer a Phase 4 risk.** It was an unbounded `Map` with
time-bucketed keys and no eviction, which was fine on a server that restarts
and would have grown for as long as the app stayed installed. It now holds a
thousand entries and evicts by expiry; `cache.test.ts` pins the bound.

---

## Deferred review findings

Reconstructed from commit messages and code comments; the ledgers that held the
full list are gone, so **treat this as incomplete**. Nothing here blocked a
merge.

- **`packages/ui` still calls global `fetch` in three components** —
  `PortfolioManager`, `SymbolPicker`, `AssetInfoPanel` were converted, but the
  portability guard covers `packages/core` and `packages/data` only for the
  fetch rule. Named in `boundary.test.ts`.
- **`scripts/` is unlinted.** It is not a workspace, so the lint loop misses it.
- **21 pre-existing lint errors** — 7 `react-hooks/set-state-in-effect` in
  `packages/ui`, 14 in `apps/web`. All predate Phase 1 and were deliberately
  left; `npm run lint` therefore exits non-zero by design.
- **`cached()` never evicts.** `packages/core/src/cache.ts` is an unbounded
  `Map` with time-bucketed keys, so a long-lived process accumulates entries
  indefinitely. Harmless on a server that restarts; a device process lives for
  weeks.
- **Four different "record missing" behaviours** survive across the services,
  each faithful to the route it replaced. `DataClient` normalises them at its
  own boundary, but the services below still disagree.
- **The lint loop hardcodes three workspace names**, so `apps/mobile` will be
  skipped silently when it lands.
- **`/api/setup` reads and writes the settings row through Prisma directly.**
  Deliberate — see the ruling in the route — but it is the one converted-era
  route that still bypasses the port.

---

## Decisions that need a person

From `docs/strategy/2026-08-22-delta-exit.md` §10. The first blocks the rest.

1. ~~**There is no `LICENSE` file.**~~ Resolved 2026-08-28: AGPL-3.0-or-later,
   with `NOTICE` carrying the copyright line and the exceptions. Section 13 is
   why AGPL rather than GPL — a modified version run as a service owes its
   users the source.

   ~~**It left one thing behind.**~~ **Resolved 2026-08-30, and it was never
   real.** NOTICE said `samples/risk-metric.pine` was Oakley Wood's work and
   the port derived from it. It is not, and the error blocked publishing this
   repository for months.

   His "Risk Metric" is a twenty-line *indicator*: one sub-metric,
   `(close − 1460d SMA) / 1460d stdev`, normalised by `−35.64·ln(t) + 1008.1`,
   against four flat lines. The file here is a *strategy* with three
   sub-metrics, different coefficients (`−38.12·ln(t) + 1078.5` for the one
   that corresponds), latched entries, tiered exits, sizing and a trading
   window. Only the idea behind metric 1 is his.

   The mistake was reading a bare `// Oakley Wood` header — naming the lineage
   — as naming the author. Both files were rewritten to say what is actually
   true; NOTICE now records the lineage as an acknowledgement rather than a
   disclaimer. **The repository can go public in full.** #41 is the only thing
   still in the way.
1b. **The purged backup is still retrievable, and GC will not fix it.** The
   history rewrite held — `main` is clean — but the blob is reachable from
   `refs/pull/25|35|37/head`, which GitHub keeps permanently. Verified 2026-08-29
   by fetching a pull ref into a fresh clone and getting all 150,272 bytes.
   A support request must name those refs; a plain garbage collection correctly
   changes nothing. Details and the text to send are in #41. **Settle before the
   repository goes public, not after.**
2. Support policy — stated on day one, not after the first complaint.
3. ~~Whether the public app keeps the name Contour.~~ Resolved 2026-08-29: it
   keeps the name.
4. **Public repository, or public builds only — and if a repository, which
   one.** Explored 2026-08-29; `scripts/offline-tree.mjs` computes the answer
   from the real import graph rather than from directory names.

   The offline app is a strict subset: 135 source files, 780 KB, reaching
   **no** indicator, PineScript or backtest file. So an offline-only repository
   sheds decision 1's licence question entirely — the port is simply not in it.
   The script exits non-zero if that ever stops being true.

   **But a second repository is not a second working copy.** Seven guards
   compare the two builds against each other, and each would lose half its
   input in a split: `more-menu.test.ts` (every web destination considered for
   the device, or a written reason), `contract-coverage.test.ts` and
   `local-client.test.ts` (one interface, two implementations),
   `store-contract.ts` (`MemoryStore` and `PrismaStore`), and
   `shared-units.test.ts`, `icon-buttons.test.ts` and `links.test.ts`, which
   all scan both apps. `client-contract.ts` says the point itself: a contract
   that only ever runs against one implementation proves that implementation
   agrees with itself.

   So: **one source of truth, and a derived public repository** — generated
   from this one and never edited in place. CI runs the cross-app guards here,
   before the export; the public repo is an output, the way the APK is. A
   hand-maintained fork is the option that looks cheapest and is the one that
   drifts.
5. Whether the mobile build ever gets the strategy tools. Recommendation on
   record: no. Reinforced by 4: they are the licence question, and the offline
   build already reaches none of them.

---

## Resolved since the ledgers were written

Kept so a reader of an old note does not chase them.

- **Alerts fire for equities** (2026-08-29, #19/#20/#21). `/api/cron/evaluate`
  priced everything through Binance, so an alert on `ASML.AS` saved, listed and
  never evaluated — silently, because `fetchPricesSafe` omits what it cannot
  price. `apps/web/src/lib/alert-pricing.ts` now asks each venue for its own
  half, and `Alert.assetType` records the kind rather than sniffing it: a US
  ticker carries no exchange suffix, so `AMD` would otherwise go to Binance as
  `AMDUSDT` and could fire on an unrelated token's price. Verified end to end
  against a copy of the database: an ASML.AS target fired at 1494.4, which is
  what Yahoo says.

  The asset page asks for the alert itself now, through optional
  `listAlerts`/`createAlert` on `DataClient` — optional for the same reason
  `sendTestNotification` is, since dispatch needs a server the device build
  does not have.

- **Dividends were dropped at import** and **cash could not be added by hand**
  (spec §6). Both fixed 2026-08-27. `income` is a side of its own: a cash row
  attributed to a security through `sourceSymbol`, which never moves a
  position. The importer reads Delta's `DIVIDEND`/`DIVIDENDS`/`INTEREST`, the
  form has a Cash mode, and a delivery (`STAKING`, `AIRDROP`, Delta's own
  `INCOME`) now keeps the price the export names instead of being zeroed.
  Three things the real Delta sample taught that the spec had not anticipated:
  a dividend row's `Base amount` is **empty** (so the income branch has to sit
  above the base-amount guard, or the row is lost as malformed rather than as
  an unsupported type), the security is in the base column while the money is
  in the quote columns, and **a dividend carries a withholding** — kept in
  `fee`, with `cashBalances` crediting the difference.

- The two Shell employee-share grants were recorded at price 0, so 21% of the
  position was held at no cost and the average cost read €12.00 — a price Shell
  has not traded near in the five years of history the app holds. Repaired
  2026-08-24 by a one-off script, since removed — it was hard-coded to one
  ledger's rows and would do the wrong thing against any other: 300 shares at the 2024-12-31
  close (€25.005) and 20 at the 2026-01-09 close (€25.00), €8,001.50 in all.
  **Two columns changed, not one.** The rows were stored as `buy`, and a
  purchase spends money — pricing them as buys told `ledger-audit` that
  €8,001 left a euro account that never held it, taking the reported EUR
  shortfall from €40,000.00 to €48,001.50. They are inbound deliveries, so the
  side is now `transfer_in`; the audit is byte-identical before and after.
  Cost basis €18,000.00 → €26,001.50, average cost €12.00 → €17.33, realised
  P&L €15,000.00 → €12,500.00, unrealised €35,000.00 → €29,498.50. The
  holding's value did not move, and realised plus unrealised fell by exactly
  €8,001.50. **The design doc's projected figures were wrong** — it added the
  grant value straight onto the cost basis, but the 2025 grant sits before the
  Feb and Mar 2026 sells, so under average-cost those disposals now consume
  basis at a higher average and realise €2,500.00 less. §6 has been corrected.

- A manual transaction could not say which currency its price was in — the
  form's figure silently meant USD, so a European stock typed at its euro price
  was stored as dollars. Fixed 2026-08-24: the input, the route and the service
  carry `nativeCurrency`/`nativePrice`, converted at the trade's own date.
  Existing rows are untouched; any hand-added European equity predating this is
  still overstated by roughly the exchange rate.
- The symbol column recorded a pricing pair rather than the asset owned — 130
  of 200 crypto rows carried a `nativeCurrency` contradicting the `USDT` in
  their own symbol. Migrated 2026-08-24: 200 crypto rows, 23 symbols renamed,
  cost basis and realised P&L identical to the cent. `Alert.symbol` keeps its
  pair by design, and both `/portfolio/ETH` and `/portfolio/ETHUSDT` resolve.
- `RequestFailedError` could not distinguish a refused request from an
  unreachable one — fixed in Phase 3, and `Net` now throws a typed error
  carrying the distinction.
- The asset page ignored the portfolio selected on `/portfolio` and defaulted
  to the first — fixed in `86b8b2a`. It is how a scratch-portfolio test deleted
  a real transaction.
- `PATCH` on a transaction zeroed the fee, because Zod applies a default
  through `.partial()`. Fixed 2026-08-23: the route parses a `TxPatch` whose
  `fee` has no default, so an absent field stays absent. **The data was
  audited before the fix and no row was damaged** — all 400 transactions
  reconcile against the 2026-08-21 backup with no fee changed, and no row
  shows the `fee=0` with `nativeFee>0` signature the bug would leave. The
  regression test asserts `TxPatch.parse({}) === {}`, which catches the next
  default added to `TxInput` rather than only this one.
- `/ledger` and `/portfolio/[symbol]` blocked on a bare `Loading…` where a
  cached value existed — design-audit finding #1, fixed 2026-08-23. The three
  screens that render a valuation now share one cache, and each says when its
  figures are from.
- The primary button, the secondary button and the form-field class were
  re-typed across sixteen and nine sites — design-audit findings #2 and #3,
  fixed 2026-08-23 with `Button` and `field()`. Whether a button dimmed when
  disabled is no longer a coin flip.
- `backtest` padded a quantity to six decimals outside the display layer —
  finding #7, fixed the same day.
- Nine empty states varied in tier, spacing and helpfulness — finding #6,
  fixed 2026-08-23. `EmptyState` owns the tier; four sentences now say what to
  do. Verified against an emptied copy of the database, not the real one.
- An undocumented third heading tier was spelled three ways — finding #4,
  fixed 2026-08-23 as `SubHeading`. That closes the design audit: all seven
  findings resolved.
- The app rendered on a white ground for anyone whose machine was set to light
  — fixed in `584ef15`.

## Publishing on Play, and what it costs

The channel is Google Play (decided 2026-08-30). `docs/play-release.md` is the
procedure; two things from it belong here because they are decisions, not steps.

**Two permissions were removed to be publishable**, and the app lost no
feature. `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` bought the one-tap "run in the
background" dialog; Play permits it only where doze breaks an app's core
function, and a price-alert tracker is not on Android's list of those. The
plugin now opens the battery-optimisation *list* instead — same destination, no
permission, one tap further away, and the copy says so.
`SCHEDULE_EXACT_ALARM` was never ours: two Capacitor plugins declare it and the
merger folded it in, but every `LocalNotifications.schedule` call here omits the
`schedule` field, so nothing in this app sets an alarm.
`scripts/android-manifest.test.ts` fails on either of them now, because both
would otherwise build, install and run perfectly and be caught weeks later by a
review queue.

Removing the exact-alarm permission was nearly a silent regression, and the
shape is worth remembering: `isExactNotification` defaults to `true` in
@capacitor/local-notifications, and the plugin checks that flag *before* it
checks whether anything is scheduled — so every immediate notification would
have opened Android's "Alarms & reminders" screen instead of posting.
`scripts/exact-alarm.test.ts` pins the option that avoids it. Nothing else in
the repository could have caught it: it type-checked, built, and passed every
other test, and it misbehaves only on a physical Android 12+ phone at the moment
an alert fires.

**#67 is the user-facing half of the same cost.** Without the one-tap dialog,
lifting battery optimisation is something a person does themselves, and on
Samsung, Xiaomi, Huawei, Oppo and Vivo there is a *second*, proprietary
restriction on top of doze that no Android API can read or request. The app
cannot detect it and must not claim to.

**The timeline is not a code problem.** A personal Play account created after
13 November 2023 has no production access until it has run a closed test with
12 testers opted in for 14 continuous days. Nothing in this repository shortens
that. The other gate is the AGPL source offer: the binary cannot go out before
its corresponding source is reachable, and since #53 is blocked, that means
publishing the offline subset — which `scripts/offline-tree.mjs` confirms
reaches 0 PineScript-derived files.

