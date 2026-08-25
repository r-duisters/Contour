# Running the alert evaluator

Contour's evaluator is a route, not a daemon. `GET /api/cron/evaluate` is
stateless and idempotent — it reads every enabled alert, prices it, and
dispatches anything new through the configured notifiers. Something has to
call it.

Until 2026-08-25 nothing did, which was one of the two reasons this app had
never delivered an alert. The other was that no notifier was configured, so a
firing signal was written to `AlertEvent` with `delivered = false` and reached
nobody. **`AlertEvent` had zero rows.**

## The scheduler

```bash
docker compose -f docker-compose.alerts.yml up -d
docker compose -f docker-compose.alerts.yml logs -f
```

It reads `CRON_SECRET` from `.env` at the repository root — a file `.gitignore`
already covers, mirroring the value in `apps/web/.env`. The evaluator refuses
an unauthenticated request, so the secret is not optional.

The container schedules and nothing else. **It never touches the database**,
which is deliberate: the process holding a year of transactions should not be
restarted to change a timer.

A tick logs what actually happened:

```
[alerts] 13:04:09 ok  fired=0
```

`fired` and not `ok`, because the route answers `{"ok": true}` whether or not
anything was priced — that is how a broken evaluator went unnoticed for a
month. A failure prints the status and the body.

Interval defaults to 900 seconds. `INTERVAL_SECONDS` in `.env` changes it.

## Delivery still needs configuring

The scheduler makes the evaluator run. It does not make an alert arrive.
`makeNotifiers()` returns an empty array unless one of these exists:

- **Home Assistant** — set `HA URL` and the webhook ID in Settings, then build
  an automation with a Webhook trigger whose action notifies your device.
  Preferred if you already run HA: it fans out to mobile push, Telegram and
  whatever else, and needs no long-lived token because webhook endpoints are
  unauthenticated by design. Keep `HA_URL` on a trusted network.
- **Web Push** — the VAPID keys are already set; subscribe once from the app.

**Send test** in Settings fires a synthetic signal through everything
configured, and is the fastest way to find out whether delivery works before
waiting for a real one.

## What will and will not fire

| Rule | On your own server |
|---|---|
| `indicator` on a Binance pair | works — the server has the 1,460 bars it needs |
| `price_target` on a coin | works |
| `pct_move` on a coin | works |
| `pct_move` portfolio-wide | works for the crypto held; **equities are silently skipped** |
| anything on an equity | **never fires** — see #19 |

An equity alert fails because `pricingPair` turns `ASML.AS` into
`ASML.ASUSDT`, which Binance rejects; the price lookup drops it without
complaint. Teaching the evaluator to price equities through the configured
provider is #19.

Cash is excluded from portfolio-wide rules on purpose. A `EUR` balance is a
positive quantity, and `pricingPair` makes it `EURUSDT` — a real Binance
market — so without the filter a portfolio-wide swing rule would page you
about the euro as though you held it.

## Note on the app itself

The container restarts with the Docker daemon; **the app does not**. It runs as
a bare `npm run start`, so a reboot leaves the scheduler knocking on a door
nobody answers — visibly, in the logs, but knocking. Putting the app under the
same supervision is worth doing and is not done here.

## Reaching the Android app directly (FCM)

Home Assistant is not required. Neither is Web Push — and in the APK it cannot
work at all: Android's WebView implements no Push API and does not define
`navigator.serviceWorker`, so the toggle in Settings has nothing to talk to.
Firebase Cloud Messaging is the mechanism that reaches the installed app, and
it is the only one that reaches a device the system has put to sleep. A
high-priority message wakes it, grants a brief wakelock and some network, then
lets it fall back to idle.

Everything is wired. Two files are not, because only you can produce them.

**1. `google-services.json`** — Firebase console → add an Android app with
package `app.contour.local` → download → put it at `android/app/google-services.json`.
Nothing else in Gradle needs touching: Capacitor's template already applies the
Google plugin when that file exists, and skips it with a log line when it does
not.

**2. A service account** — Firebase console → Project settings → Service
accounts → *Generate new private key*. Put the whole JSON on one line in
`apps/web/.env`:

```
FCM_SERVICE_ACCOUNT='{"project_id":"…","client_email":"…","private_key":"-----BEGIN PRIVATE KEY-----\n…"}'
```

Absent, `makeFcmNotifier()` returns null and the notifier is skipped — the same
way absent VAPID keys skip Web Push. Nothing breaks; nothing arrives either.

Then rebuild the APK (`npx cap sync android && ./gradlew assembleDebug`) and
open it once. The app registers on every launch and upserts the token, because
FCM tokens rotate — on restore to a new device, on cleared data, and sometimes
on their own. `GET /api/push/fcm` answers how many devices are registered,
which is the quickest way to check the handshake worked before waiting on a
real alert.

**Both channels can run at once**, and on different devices they have to: HA
fans out to whatever it knows about, Web Push reaches a browser or installed
PWA, FCM reaches the APK. `dispatch` marks an event delivered if any of them
succeeded.
