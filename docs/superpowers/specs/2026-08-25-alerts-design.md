# Alerts — design

**Status:** approved, ready for planning · **Date:** 2026-08-25 · **Author:** Roy

Ship alerts that work, for free, with nothing running anywhere but the phone —
and say plainly what they cannot promise. A cloud path is designed and left
unbuilt behind them.

Companion to `docs/superpowers/specs/2026-08-22-standalone-android-design.md`,
which scoped alerts out of the mobile build. This puts them back on the terms
the platform actually allows.

---

## 1. What is true today, measured

Checked against the live install on 2026-08-25. The owner has never received a
notification from this app, and there are three independent reasons.

**The server evaluator has never fired, twice over.** Nothing schedules
`GET /api/cron/evaluate` — no crontab, no timer, no caller; every alert's
`lastEvaluated` is a manual call during an unrelated fix. And no notifier is
configured: `haUrl` unset, `haWebhookId` unset, zero push subscriptions, so
`makeNotifiers()` returns an empty array and a firing signal would reach nobody.
**`AlertEvent` contains zero rows.**

**The device runner is wired correctly and defeated by the platform.**
`apps/web/public/runner/alerts.js` is registered on a fifteen-minute repeat and
`BackgroundAlerts.tsx` keeps it supplied. Doze suspends app-initiated network
requests when the device is motionless, screen off thirty minutes, off charge —
which is a quarter-hourly HTTP call's worst case. Capacitor's own docs say the
interval "may not be hit exactly"; `ionic-team/capacitor-background-runner#88`
is titled *Task Runner does not run at intervals*.

**And only one of three alerts even reaches it.** `BackgroundAlerts` filters on
`a.symbol &&`, so the portfolio-scoped rule (`symbol: null`) is silently
dropped; indicator alerts are excluded by design. One rule survives.

## 2. What the platform allows

Established by reading the policies rather than guessing, because three
plausible fixes turn out to be closed.

- **Exact alarms are closed.** Android 14 denies `SCHEDULE_EXACT_ALARM` by
  default, and `USE_EXACT_ALARM` is a restricted permission Play grants only
  where the app's core user-facing function *is* alarms, timers or calendars.
- **Requesting a battery-optimization exemption is closed.** Play policy
  prohibits apps from requesting exemption from Doze and App Standby "unless
  the core function of the app is adversely affected"; the acceptable list is
  fitness tracking, turn-by-turn navigation, VoIP and 24/7 IoT control. A
  portfolio tracker is not on it.
- **And the exemption would not have been enough anyway.** A whitelisted app
  "can use the network and hold partial wake locks during Doze and App
  Standby. **However, other restrictions like jobs being deferred, standard
  alarm triggers are still imposed.**" Whitelisting fixes network suspension,
  not scheduling — and the deferred job is exactly the mechanism the runner
  uses. The documented floor for an idle app is network access *roughly once a
  day*.
- **What remains open:** telling a user how to exempt the app themselves in
  Settings is documentation, not a permission, and is not restricted. It
  improves the odds; it guarantees nothing.
- **FCM high-priority messages are the only sanctioned way to wake a Doze'd
  device** — and they need a sender that is always awake, which v1 does not
  have. That is §7.

## 3. Decisions, settled 2026-08-25

1. **v1 is offline and best-effort.** No server, no cloud, no account, no
   recurring cost, no privacy policy for alerts, nothing to operate. It ships
   in days rather than weeks, which matches what this is: a free alternative
   for people leaving a subscription.
2. **Opening the app is the reliable path.** Every foreground evaluates every
   enabled rule. This is the one moment the OS guarantees us, so it carries the
   feature.
3. **Background checks are opportunistic and never promised.** They run when
   Android allows — typically while the phone is in use or charging. The app
   states this; it does not state an interval.
4. **CoinGecko's batched endpoint is the price source for alerts, and for the
   crypto day-change figure on screen.** One keyless call returns every coin
   and its 24-hour change: measured at **1,114 bytes for ten coins**, so an
   hourly check costs about **24 KB a day**. Data and battery stop being
   objections; only reliability remains one.

   It is the source for the *displayed* figure too, because otherwise the two
   disagree. Measured on 2026-08-25: Binance is one venue, CoinGecko a
   cross-venue average, and BTC read +0.91% against +1.20% — **0.29 points
   apart** at the same instant. A 5% alert firing while the screen shows 4.8%
   is the same defect as the window mismatch fixed that morning, wearing new
   clothes. Binance stays for candles, which CoinGecko's simple endpoint does
   not provide.
5. **No battery-exemption permission is declared.** A help screen explains the
   manual route in Settings and is honest that it improves odds rather than
   guaranteeing delivery.
6. **Portfolio-scoped rules expand on the device** into one check per held
   symbol, fixing the `symbol: null` drop that has silently disabled them.
7. **Equities and indicator alerts stay out.** Equities are blocked on the
   Yahoo cookie-and-crumb gap (Android design §4.2); the risk metric needs
   ~1,460 daily bars, is fitted to Bitcoin, and divides by zero in September
   2027 (#39).

## 4. What v1 does

- **On foreground:** evaluate every enabled rule against one batched CoinGecko
  call, post a local notification per hit.
- **In background:** the same evaluation, from whatever periodic mechanism the
  OS honours, at whatever cadence it honours it.
- **Dedupe:** one notification per rule per UTC day, in device storage — so a
  standing condition does not notify on every check.
- **Rules stay local.** Nothing about the portfolio leaves the phone. This is
  the property the whole app is built on and v1 does not spend it.
- The evaluation uses `evaluatePriceTarget` and `evaluatePctMove` from
  `packages/core/src/alerts.ts` unchanged — pure, already tested, already
  shared by three callers.

## 5. Saying what it cannot do

The failure this design must not repeat is the one that prompted it: **a month
of silence that looked like "no alerts triggered".** Two requirements, and they
are not optional polish.

- **A visible last-checked time.** The alerts screen shows when the last
  background check actually ran — "3 hours ago", or "not since yesterday".
  Silence becomes visible instead of ambiguous.
- **Copy that does not overclaim.** Alerts are checked *when you open the app*,
  and *sometimes* in the background. No interval is stated anywhere in the UI,
  because none can be kept.

The honest limit, stated in the app: **a target hit and reverted overnight can
be missed entirely.** For a long-term tracker that is a reasonable trade. For
anyone trading intraday it is not, and they should learn it from the app rather
than from experience.

## 6. What v1 deletes

`/api/cron/evaluate`, the Home Assistant notifier and the Web Push path stay —
they are the self-hosted route and they work when someone schedules them. What
goes is the *pretence* of a working background path: nothing is left that looks
like it delivers and does not. The runner is kept only because §4 uses it, and
only under the labelling of §5.

## 7. Later stage, designed and not built: cloud alerts

If people ask for alerts that arrive on time, the shape is known.

A Cloudflare Worker on a cron trigger evaluates and FCM delivers. FCM is free
with no message-count limit and no per-message charge, and its high-priority
messages are the documented exception to Doze. Send **notification payloads,
not data-only** — the system renders those itself, without needing the app to
wake and run, which is what the data-only failure reports in Doze come down to.

**Rules would live in the cloud**, because a price target cannot be expressed
otherwise: the cloud would not know the target, so it would have to push every
move to every device. Symbols, directions and thresholds leave the phone;
**quantities, prices and values never do.**

**Bring-your-own-key was evaluated and rejected.** It solves cost, which is not
the problem. It scales *worse*: Cloudflare's free plan allows **50 external
subrequests per invocation**, and BYOK needs one call per user per tick — a
ceiling near 50 users — where one shared batched call serves any number.
It also adds an onboarding cliff most users will not climb and puts the project
in the business of storing other people's API keys.

**Cost at scale is flat, not per-user**: everything except price data is free,
and price data batched across all users is one call per tick whatever the user
count. CoinGecko's Demo plan is "testing only" and would need the $35/month
tier for a published app.

**The unproven risk** is whether Binance and CoinGecko tolerate calls from
Cloudflare's shared egress addresses. Volume is not the issue — roughly 5
weight per minute against a 6,000 limit — poisoning by other tenants is. One
day's rehearsal from a deployed Worker settles it, and it is the first thing to
test if this stage is ever started.

Reliable alerts are also the most plausible thing this project could charge
for, which is what would fund the $35.

## 8. Testing

- **Overnight, on a real handset.** Leave a rule that must fire, face-down,
  off-charge, for eight hours. Record what arrived and when. This is the only
  test that measures the thing in question, and no emulator reproduces Doze.
- **The dedupe:** a standing condition notifies once per UTC day, not on every
  check.
- **The last-checked timestamp is truthful**, including when nothing has run.
- **A foreground check fires immediately** on opening the app with a rule
  already satisfied — the path that carries the feature.

## 9. Out of scope

- Equity alerts, until the Yahoo crumb gap is solved.
- Indicator alerts — self-hosted only.
- Any promise about background timing.
- Anything that sends the portfolio anywhere.

## 10. Open decisions

- **Whether to publish at all.** Phase 0 of `docs/strategy/2026-08-22-delta-exit.md`
  — five real Delta exports from strangers — is still ungated, and is cheaper
  to fail than a launch is.
- **#41 blocks a public repository:** the owner's full portfolio backup is
  still readable from git history on `origin/main`.
- There is still no `LICENSE`.
