# Alerts that fire without a server of your own — design

**Status:** approved, ready for planning · **Date:** 2026-08-25 · **Author:** Roy

Make price alerts work for someone who installs Contour from the Play Store and
never runs a server. Keep them working for someone who does.

Companion to `docs/superpowers/specs/2026-08-22-standalone-android-design.md`,
which put the app on a device with no server behind it and deliberately scoped
alerts *out* of v1. This is the piece that puts them back.

---

## 1. What is true today, measured

Checked against the live install on 2026-08-25. Three separate findings, and
together they explain why the owner has never received a notification.

**The server evaluator has never fired, for two independent reasons.**

- Nothing schedules `GET /api/cron/evaluate`. No crontab entry, no systemd
  timer, no external caller. `CLAUDE.md` says "wire this route to a real
  schedule"; it never was. Every alert's `lastEvaluated` is 2026-08-24 17:24,
  which is a manual call during an unrelated fix.
- No notifier is configured: `haUrl` unset, `haWebhookId` unset, **zero push
  subscriptions**. `makeNotifiers()` returns an empty array, so a firing signal
  would be written to `AlertEvent` with `delivered = false` and reach nobody.

**`AlertEvent` contains zero rows.** Nothing has ever fired, on any path.

**The on-device runner exists, is wired correctly, and is defeated by the
platform.** `apps/web/public/runner/alerts.js` is registered in
`capacitor.config.ts` on a fifteen-minute repeat, and `BackgroundAlerts.tsx`
copies rules into device storage whenever the app is open. It cannot be relied
on:

- **Doze defers it.** When the device is motionless, the screen has been off
  thirty minutes and it is not charging, Android suspends app-initiated network
  requests until a maintenance window. A quarter-hourly job whose whole purpose
  is an HTTP call is close to the worst case for that policy.
- **Capacitor says so.** The plugin's own documentation states the interval
  "may not be hit exactly", and `ionic-team/capacitor-background-runner#88` is
  titled *Task Runner does not run at intervals*.
- **The manufacturer layer is worse.** Samsung and Xiaomi add restrictions
  beyond stock Android. The owner's device is a Samsung.

**And only one of three configured alerts even reaches the runner.**
`BackgroundAlerts` filters on `a.symbol &&`, so the portfolio-scoped rule
(`symbol: null`) is silently dropped, and indicator alerts are excluded by
design. One rule survives: a ±5% move on `BTCUSDT`.

## 2. The door that is closed

The obvious fix for Doze is an exact alarm. It is not available:

- Android 14 stopped pre-granting `SCHEDULE_EXACT_ALARM`; it is denied by
  default.
- `USE_EXACT_ALARM` is a **restricted permission**. Google Play accepts it only
  where the app's core user-facing function *is* alarms, timers or calendar
  events. A portfolio tracker does not qualify, and an app declaring it without
  qualifying cannot be published.

What remains locally is a foreground service with a permanent notification —
user-hostile, and its own policy review. **Reliable on-device alerting is not
something this app can ship to the Play Store.** Something always awake has to
do the evaluating, which is what every comparable app already does.

## 3. Decisions, settled 2026-08-25

1. **A Cloudflare Worker on a cron trigger evaluates; FCM delivers.** No VPS,
   nothing of the author's to keep patched. Cron triggers are included on the
   Workers free plan.
2. **Rules live in the cloud, not only on the device.** The alternative — the
   cloud broadcasting "ETH moved 5%" and the phone deciding — keeps thresholds
   private but cannot express a price target: the cloud would not know the
   target, so it would have to push every move to every device and let the
   handset filter. Putting the rule where the evaluation happens is the honest
   shape.
3. **Portfolio-scoped rules go to the cloud too**, which means the set of
   symbols held is uploaded. Rejected: keeping them self-hosted only. The
   reasoning is the owner's and it is sound — for a Play Store user there was
   never a "my own server" option, and once data leaves the handset it lands on
   infrastructure the author operates either way. The disclosure is identical;
   only the hostname differs.
4. **Quantities, prices, values and cost basis are never uploaded.** A symbol
   list is a watchlist. A symbol list with quantities is a portfolio. The line
   sits between them and it is the one thing this design will not trade.
5. **Indicator alerts stay self-hosted.** The risk metric needs ~1,460 daily
   bars to warm up, the mobile spec already excludes it, its curves are fitted
   to Bitcoin, and #39 establishes that the whole indicator divides by zero in
   September 2027. Building cloud infrastructure for it would be building on a
   countdown.
6. **Both modes ship, and the app chooses.** *(Ruling, not asked for.)* A
   self-hoster's alerts should not phone home to the author's Cloudflare
   account — that is a different proposition from the one they opted into by
   self-hosting. `Settings` gains an alert backend: **Cloud** (default in a
   Play Store build) or **This server** (default when the app is served from an
   instance the user runs). The existing evaluator and Home Assistant path stay
   exactly as they are and become the second mode rather than dead code.

## 4. What is stored, and what is not

One row per rule, in Cloudflare D1. D1 rather than KV because the hot query is
"every rule for these symbols", which is a `GROUP BY` and not a key lookup.

```sql
CREATE TABLE rule (
  id            TEXT PRIMARY KEY,   -- generated on the device
  client_id     TEXT NOT NULL,      -- random per install; not an account
  token         TEXT NOT NULL,      -- FCM registration token
  kind          TEXT NOT NULL,      -- 'price_target' | 'pct_move'
  symbol        TEXT NOT NULL,      -- pricing pair for crypto, ticker for equities
  asset_type    TEXT NOT NULL,      -- 'crypto' | 'equity'
  direction     TEXT,               -- price_target only
  target        REAL,               -- price_target only
  threshold     REAL,               -- pct_move only
  enabled       INTEGER NOT NULL DEFAULT 1,
  last_fired_day INTEGER,           -- UTC day number; one notification per rule per day
  updated_at    INTEGER NOT NULL
);
CREATE INDEX rule_symbol ON rule(symbol) WHERE enabled = 1;
CREATE INDEX rule_client ON rule(client_id);
```

**Never stored:** quantity, price paid, fee, cost basis, portfolio value,
transaction history, portfolio names, anything identifying a person. There is
no account, no email, no password. `client_id` is a random identifier the
install generates and can discard.

A portfolio-scoped `pct_move` expands **on the device** into one row per held
symbol before syncing, so the server schema needs no portfolio concept at all.

## 5. How a tick works

One cron trigger, every five minutes.

1. `SELECT DISTINCT symbol, asset_type FROM rule WHERE enabled = 1`.
2. Crypto: one batched `GET /api/v3/ticker/price?symbols=[…]` against Binance,
   plus 25 hourly klines per symbol for the rolling-24h base — the same window
   `fetchCrypto24hAgo` uses, so a cloud alert and the app's own figure cannot
   disagree. Cache the base in KV for five minutes; it moves once an hour.
3. Equities: the configured provider. **Known gap** — Yahoo's cookie-and-crumb
   handshake (spec §4.2 of the Android design) is unsolved and blocks some
   endpoints. Equity alerts ship only once a provider path works from a Worker;
   crypto ships first.
4. Evaluate each rule with the *same pure functions the app uses* —
   `evaluatePriceTarget` and `evaluatePctMove` from `packages/core/src/alerts.ts`.
   They are pure, have no I/O and already run in three places; a fourth costs
   nothing and stops the cloud drifting from the app.
5. Group hits by token, send one FCM message per device per tick.
6. Write `last_fired_day`; a price target also sets `enabled = 0`, matching the
   one-shot behaviour the server evaluator already has.

## 6. The device side

- `@capacitor/push-notifications` for the FCM token, plus `google-services.json`
  in the Android build. New dependency; `@capacitor/local-notifications` stays
  for the self-hosted mode.
- The app syncs rules to the Worker whenever they change and on foreground,
  `PUT /rules` with the whole set for its `client_id` — idempotent, so a missed
  sync self-heals rather than needing a diff protocol.
- `DELETE /rules?client_id=…` removes everything. Play requires a data-deletion
  route and this is it; it must also be reachable from Settings, not only from
  a URL.
- **`runner/alerts.js` and `BackgroundAlerts.tsx` are deleted.** They are the
  path that has never worked, and leaving them beside one that does would mean
  two implementations of the same feature, one silently broken. Their removal
  is part of this work, not a follow-up.

## 7. Risks

**Binance rate-limits by IP, and Workers share egress addresses.** This is the
most likely way the design fails in production: a `429` or `418` caused by
other Cloudflare customers hitting the same endpoint. Mitigations, in order —
one batched request per tick rather than per rule; KV-cache the 24h base for
five minutes; fall back to a second source on 429; and, if it persists, a paid
IP or a different price provider. **This needs proving before launch, not
after**, and it is the first thing a plan should test.

**FCM tokens rotate and go stale.** Prune on `UNREGISTERED` from the send
response, or the table fills with dead rows and every tick pays for them.

**The free tier is a real ceiling**: 3 cron triggers, 10ms CPU per invocation
on the free plan. The CPU limit is survivable because the work is almost
entirely awaiting `fetch` and I/O wait does not count against it — but a large
rule set changes that, and nobody has measured where the knee is.

**Publishing makes this an operated service.** A $25 developer account, a
privacy policy, a Data Safety declaration covering symbols and device tokens,
and an availability expectation from people who did not choose this
architecture. That is a commitment, not a deployment.

## 8. Testing

- **The pure evaluators are already tested** and are reused unchanged; the
  Worker adds no new alert arithmetic to verify.
- **A rate-limit rehearsal** — hammer the Binance path from a deployed Worker
  at the intended cadence for a day before shipping. The one risk above that
  cannot be reasoned about, only observed.
- **A dedupe test**: a standing condition notifies once per UTC day, not every
  five minutes. This is the failure a user actually feels.
- **A stale-token test**: a revoked token is pruned rather than retried forever.
- **End to end on a real handset**, in Doze, overnight. The whole point is that
  a notification arrives when the phone has been face-down for eight hours,
  which is exactly the state no emulator reproduces.

## 9. Out of scope

- Indicator alerts (decision 5) — self-hosted only.
- Equity alerts until the Yahoo crumb gap is solved.
- Accounts, sign-in, cross-device sync of rules.
- Anything touching holdings. The portfolio stays on the phone.

## 10. Open decisions

- **Whether to publish at all**, and Phase 0 of `docs/strategy/2026-08-22-delta-exit.md`
  — five real Delta exports from strangers — remains ungated. It is cheaper to
  fail there than after a launch.
- **A privacy policy has to exist** and say what §4 says. There is still no
  `LICENSE` either (#41's sibling problem).
- **#41 blocks a public repository**: the owner's full portfolio backup is
  still readable from git history on `origin/main`.
