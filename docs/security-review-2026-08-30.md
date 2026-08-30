# Security and privacy review — 2026-08-30

Contour's pitch is that a portfolio does not leave the phone. This is a review
of whether the shipped artefacts keep that promise, weighted towards the
standalone APK because that is the build the promise is about.

Everything below was checked against **the built APK and the source**, not
against the documentation. Where a claim rests on something I could not run,
it says so.

**Two findings are serious and both are one-line fixes in the manifest.** The
rest is either sound, or a limit of the design that the docs currently
overstate.

## What holds up

- **No analytics, crash reporting or telemetry of any kind.** No Firebase, no
  Sentry, no Crashlytics, no Segment — checked against the Gradle files and
  every `package.json`. The stated direction is kept.
- **No location permission.** It was pulled in transitively by
  `@capacitor/background-runner` and is removed with `tools:node="remove"`;
  `aapt2 dump badging` confirms it is absent from the built APK. The permission
  set is `INTERNET`, `ACCESS_NETWORK_STATE`, `POST_NOTIFICATIONS`,
  `USE_BIOMETRIC`/`USE_FINGERPRINT`, and four that the background alert check
  needs (`SCHEDULE_EXACT_ALARM`, `RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK`,
  `FOREGROUND_SERVICE`) plus `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`.
- **Logos are bundled, not fetched.** 274 PNGs ship inside the APK, so no icon
  CDN learns which assets are held. This is the one egress the project closed
  deliberately and it stayed closed.
- **No remote content in the WebView.** `server.url` is unset for the
  standalone build, so the bridge is only ever exposed to local assets.
  External links carry `target="_blank"` and leave for the system browser.
- **API keys never reach an error message.** `CapacitorNet` logs origin and
  path but never the query string, because provider credentials travel as query
  parameters and two routes hand `e.message` back to the caller. That is a
  control that had to be thought of.
- **Web auth is properly built.** scrypt with a per-password random salt and
  `timingSafeEqual`; session cookies `httpOnly`, `sameSite=lax`, `secure` when
  the request arrived over https; a 429 on repeated login attempts; middleware
  matching everything except `_next/static` and `_next/image`, with a short
  explicit public list. `.env` is git-ignored and no `.env` is tracked.

## Findings

### H1 · The portfolio database is eligible for Google Drive backup

`android/app/src/main/AndroidManifest.xml` sets `android:allowBackup="true"`,
and there is **no `fullBackupContent` and no `dataExtractionRules`** — `ls
android/app/src/main/res/xml/` returns only `config.xml` and `file_paths.xml`.

That is the Android default, and the default is: everything in the app's data
directory, the SQLite database included, is eligible for Android Auto Backup —
which uploads to the user's Google Drive.

So an app whose entire premise is that the portfolio stays on the device ships
configured to copy that portfolio, unencrypted, to Google. Backup is
transport-encrypted and tied to the user's account, so this is not an exposure
to strangers; it is an exposure to exactly the party the product says is not
involved.

**Fixed and verified on an emulator**, 2026-08-30. Both rules files now exclude
every domain and include one empty directory for the opt-in of issue #60. The
verification was a controlled pair, because an empty backup proves nothing on
its own — a backup that never ran is also empty:

| build | on-device database | backup result |
|---|---|---|
| rules removed | `contourSQLite.db`, 45,056 B | **4.45 MB blob** containing `db/contourSQLite.db` *and* the WebView's Local Storage |
| rules in place | the same file | no blob; `PFTBT: Transport rejected backup … skipping` |

The blob is what would have reached Google Drive, and it carried more than the
database: the WebView's Local Storage holds the app's price and valuation
cache.

**Original fix, for the record:** `android:allowBackup="false"`, or a
`dataExtractionRules` that excludes the database. The first is more honest about the product's claim; it
also means a phone-to-phone migration must go through the app's own export,
which is the mechanism the design already provides.

### H2 · The shipped APK is a debug build, signed with the Android debug key

`aapt2 dump xmltree` reports `android:debuggable=true`, and `apksigner
--print-certs` reports `CN=Android Debug, O=Android, C=US`.

**Confirmed on the emulator**, 2026-08-30: `adb shell run-as
app.contour.standalone ls -la databases/` lists `contourSQLite.db` and its
size, without root. That is the whole of it — one command, no exploit.

Two consequences. `debuggable` lets `adb shell run-as app.contour.standalone`
read the app's private data — including the unencrypted database — on any
device with USB debugging on, **without root**, and lets a debugger attach to
the running process. And the debug signing key is the conventional one with
publicly documented passwords; a debug-signed APK is not something to
distribute or to build an update path on.

**Fix:** a release build with a real keystore before the APK is offered to
anyone. This matters more once the public repository lands.

### M1 · Fetching prices discloses the portfolio, by construction

This is not a defect. It is the gap between what the code does and what the
documentation says, and the documentation is the part that is wrong.

- **Binance** receives the exact set of held coins in a single request:
  `GET /api/v3/ticker/price?symbols=[…]`.
- **Yahoo** receives one request per held equity:
  `GET /v8/finance/chart/{symbol}`.
- The background runner does the same, every 30 minutes, with the app closed —
  reaching `api.binance.com`, `query1.finance.yahoo.com` and
  `finance.yahoo.com`.

The full egress list from the shipped bundle is `api.binance.com`,
`query1`/`query2`/`feeds`/`fc.finance.yahoo.com`, `api.coingecko.com`,
`api.frankfurter.dev`, `api.alternative.me`, and — only if the user configures
them — `api.twelvedata.com` and `www.alphavantage.co`. Every other host found
in the bundle (`nextjs.org`, `react.dev`, `w3.org`, `json-schema.org`,
`github.com`, `gnu.org`, `www.tradingview.com`) is licence text, a type
declaration or a credit link, not a request.

Two things sharpen this. The User-Agent is a fixed, distinctive string —
`Contour/1.0 (+self-hosted portfolio tracker)` — which is honest but narrows
the anonymity set to "Contour users". And Yahoo's cookie-and-crumb handshake
means those per-symbol requests carry a cookie that persists in the app's jar,
so they correlate over time rather than arriving as unlinked one-offs.

**What is true:** the portfolio's *values*, quantities, cost bases and history
never leave the device. **What is not true:** that nothing about the portfolio
leaves it. The set of tickers does, necessarily, to anyone who prices them.

**Fix:** state it. `CLAUDE.md` line 65 says "Nothing about the portfolio leaves
the phone", which is too strong — the README does not make the claim at all.
The honest version names what does leave and why it cannot not.

If the composition matters more than the convenience, the options are decoy
symbols, batching everything through one provider, or a proxy the owner runs —
all real costs, none obviously worth it, and all decisions for a person rather
than defaults to change quietly.

### M2 · The database is unencrypted, and SQLCipher is already in the APK

`apps/mobile/src/lib/deps.ts` opens the connection with `false` for encryption
and `"no-encryption"` for the mode. The reasoning in the comment is sound as
far as it goes — "a key this app invented would have to live beside the data it
protects" — but the APK ships `libsqlcipher.so`, so the capability is present
and unused, and Android has somewhere to put a key that is not beside the data:
the Keystore, which can hold a key the app cannot export and which can be gated
on device unlock.

On a locked, non-rooted, non-debuggable phone the current position is
defensible. It stops being defensible in combination with H1 and H2, each of
which produces a copy of the file somewhere the device lock does not reach.

**Fix:** fix H1 and H2 first — they are cheaper and they remove the paths that
make this matter. Then reconsider encryption on its own merits.

### L1 · The biometric lock does not protect the data

`BiometricLock` is an overlay over a page that has already rendered. It stops a
person picking the phone up and reading the screen, which is what it is for and
what its comments claim. It does not gate the database, so it contributes
nothing against any of H1, H2 or M2. Worth stating plainly so it is not
mistaken for data protection.

### L2 · FileProvider paths are broader than needed

`res/xml/file_paths.xml` declares `<external-path path="."/>` and
`<cache-path path="."/>` — Capacitor's defaults, covering the whole of external
storage and the whole cache directory. The provider is not exported and grants
are per-URI, so this is not an exposure by itself; it is more surface than the
export feature needs.

### L3 · The cron bearer token is compared with `===`

`apps/web/src/app/api/cron/evaluate/route.ts` compares
`header === \`Bearer ${cronSecret}\``, which is not constant-time. Over a
network, against a JavaScript string comparison, this is not practically
exploitable, and the route is on a trusted network by design. Noted for
completeness rather than as something to fix now.

## Not tested

- **The traffic was not captured.** The egress list is derived from the code
  and from strings in the shipped bundle, so anything reached by a dependency
  rather than by this code would not appear in it. The emulator can now answer
  this — boot it with `-http-proxy` — and has not been asked yet.

  H1 and H2 *were* since observed on it. `scripts/emulator.sh` runs an Android
  16 image at the S24's 1080×2340 at 3x; it uses `sg kvm` so it works in a
  shell that started before the group was granted.
- **No dependency vulnerability scan.** `npm audit` and a Gradle equivalent are
  worth running separately; they answer a different question from this review.
- **The web app was reviewed second and less deeply.** It is designed for a
  trusted network — the Home Assistant webhook is unauthenticated by design,
  which is a property of webhooks and documented as such.

## In order

1. `android:allowBackup="false"` (H1). One line, and the largest single gap
   between what the app claims and what it does.
2. A release keystore and a non-debuggable build (H2), before the APK is
   offered to anyone.
3. Correct the privacy claim in `CLAUDE.md` (M1) so it says what is true:
   values stay, tickers go. The README makes no such claim and needs nothing.
4. Revisit database encryption (M2) once 1 and 2 have removed the paths that
   make it urgent.
