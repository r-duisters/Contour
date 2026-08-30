# Contour — privacy policy

Last updated: 30 August 2026.

Contour is a portfolio tracker that runs entirely on your phone. This policy
describes what it does with your information. It is short because the app does
very little.

## What Contour collects about you

**Nothing.** Contour has no account, no sign-in, no analytics, no advertising,
no crash reporting and no telemetry. There is no Contour server. Nobody
operating Contour — including its author — receives your portfolio, your
transactions, your settings, your device identifiers or anything else about
your use of the app.

## Where your data lives

Everything you enter — portfolios, transactions, prices you have looked at,
settings — is stored in a database inside the app's own private storage on your
phone. Android prevents other apps from reading it. Uninstalling Contour
deletes it.

## What Contour sends to other people

To show prices, Contour asks public market endpoints for them. It sends no
account, no identifier and nothing about you; it sends the request, and those
services see your device's IP address, as they would for any web page you open.

- **Binance** — cryptocurrency prices.
- **Yahoo Finance, Twelve Data or Alpha Vantage** — share prices, whichever you
  have chosen in Settings.
- **Frankfurter (European Central Bank data)** — exchange rates.

**A price request names what you ask about.** Asking Binance for the price of a
coin tells Binance that somebody at your IP address is interested in that coin,
and asking for exactly the set you hold tells it the composition of your
portfolio. Contour offers a setting — *Settings → Privacy → Hide which coins you
hold from Binance* — that asks for the whole market instead and picks yours out
on the phone, so nothing about your holdings is expressed in the request. It
costs more data. It is your choice, and it is off by default.

Share prices have no equivalent, because no provider publishes every listing at
once. If you hold shares, the provider you have chosen learns which ones when it
is asked for their prices.

## Google backup

Android can back up an app's data to your Google Drive. **Contour is excluded
from that by default.** One directory is eligible for backup and it is empty
until you switch on *Settings → Privacy → Include a copy in Google backup*.

If you switch it on, Contour writes an export of your transactions into that
directory, and Android's backup service — not Contour — may copy it to the
Google account on the phone. It is subject to Google's terms and privacy policy
from that point. Switching the setting off deletes the file, so there is nothing
left to copy.

Contour never sends this file anywhere itself, and switching the setting on is
the only way any of your data leaves the phone.

## Notifications

Alerts you create are evaluated on the phone and posted by Android's local
notification system. They are not push notifications: no message passes through
Google, Firebase or any other service, and no server knows an alert exists.

## Children

Contour is not directed at children and collects nothing from anyone.

## Permissions

- **Internet** — to fetch prices.
- **Notifications** — to post the alerts you have set up.
- **Biometric / fingerprint** — to unlock the app, if you turn that on. The
  check happens in Android; Contour never sees a fingerprint.
- **Run at boot, wake lock, network state** — to re-schedule the background
  price check after a restart.

Contour asks for no location permission, no contacts, no storage access, no
camera and no microphone.

## Changes

If this policy changes, the date at the top changes with it, and the previous
versions remain in the project's git history.

## Contact

Open an issue on the project's repository, or email the address listed there.
