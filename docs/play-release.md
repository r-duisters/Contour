# Publishing Contour on Google Play

What the repository already does, what a person has to do by hand, and the two
things that decide the timeline. Written 30 August 2026 against #61.

Read `docs/privacy-policy.md` alongside this: Play requires a hosted privacy
policy from **every** app, including one that collects nothing, and that file is
the text to host.

---

## The two things that will actually delay this

**1. The developer account's identity — now the critical path.** #68, and it is
blocked on a register change.

A **personal** account created after 13 November 2023 has no production access
until it has run a closed test with at least **12 testers opted in continuously
for 14 days**: twelve real Google accounts, each of which has to open the opt-in
link, press *Become a tester*, install from the Play Store, and stay opted in
for the whole fortnight. Google then asks how you recruited them and what
feedback you got, so a headcount alone does not pass.

An **organisation** account is exempt from all of that, and is the route taken
here. It needs a D-U-N-S number — already issued, **473999192**, so no request
and none of the up-to-30-day wait Google warns about — plus a register extract
and photo ID.

The cost that replaces the testers is an identity that cannot be edited
afterwards, and one trap worth stating twice: **hiding an address in the
national register does not hide it on Google Play.** Google displays the legal
address from the verified payments profile to satisfy EU trader-transparency
rules, regardless of what the register shows publicly. Only registering a
*different* address changes what Play publishes. And three records have to
agree — register extract, D&B profile, payments profile — while D&B does not
follow a register change on its own, so budget for a second correction with
Altares after the first. #68 carries the checklist.

**2. The source obligation.** Contour is AGPL-3.0. Distributing the binary
obliges you to offer the corresponding source to whoever receives it. The
repository is not public yet (#53, blocked on #41 and the PineScript licence
question), so the offer has to be satisfied another way for the first release.

`scripts/offline-tree.mjs` reports **0 PineScript-derived files reachable** from
the device build, so the offline subset can be published even while the whole
repository cannot. A source tarball of that subset, hosted anywhere stable and
named in the listing, discharges the obligation. Do not upload the binary before
the source it corresponds to is reachable.

---

## What is already done

- `assembleRelease` and `bundleRelease` both work, and both produce an
  **unsigned** artefact when no key is configured rather than falling back to
  the Android debug key.
- A signed release APK has been verified end to end with a throwaway key: no
  `debuggable` attribute, correct signer, backup rules intact after resource
  compilation.
- The manifest declares **no permission Play restricts**. Two were removed for
  this, and `scripts/android-manifest.test.ts` fails the build if either comes
  back — see "What the policy cost" below.
- `versionCode` is minutes since 2026-01-01, so it is monotonic and every build
  is distinguishable. Play rejects a re-used `versionCode`, so this is load
  bearing here as well as in the launcher's icon cache.

## What a person has to do

### 1. The account — #68

<https://play.google.com/console> — a one-off US$25 registration fee, and
identity verification. **Organisation**, for the reason above. Do this last: it
is the only step that locks something in, and every other item on this page is
independent of it.

### 2. The upload key

Play App Signing is mandatory for new apps: **Google holds the key that signs
what users install**, and the key you generate below is the *upload* key, which
only proves uploads come from you. That is a meaningful difference from a
sideloaded release — losing an upload key is recoverable through Play support,
whereas losing an app signing key would not be. Keep it safe anyway; a reset is
a support ticket and a wait.

Generate it outside the repository. Nothing in this project reads a key from
inside the tree, and `.gitignore` covers `keystore.properties`, `*.jks` and
`*.keystore` as a second line:

```bash
keytool -genkeypair -v \
  -keystore ~/contour-upload.jks \
  -alias contour-upload \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=Contour, O=Contour, C=NL"
```

It asks for a store password and then a key password. Use a password manager;
these are not recoverable. Then, in `android/keystore.properties` — untracked,
and the build reads it from there or from the environment:

```properties
storeFile=/home/<you>/contour-upload.jks
storePassword=<store password>
keyAlias=contour-upload
keyPassword=<key password>
```

For CI, set `CONTOUR_KEYSTORE`, `CONTOUR_KEYSTORE_PASSWORD`, `CONTOUR_KEY_ALIAS`
and `CONTOUR_KEY_PASSWORD` instead; the build prefers the properties file and
falls back to these.

### 3. Build the bundle

Play takes an Android App Bundle, not an APK:

```bash
npm run build            # the static export the shell bundles
npx cap sync android     # copy it into android/ and re-check the plugin list
npm run android:bundle   # → android/app/build/outputs/bundle/release/app-release.aab
```

`android:bundle` does **not** run the first two steps. Skipping them uploads
whatever web assets were last synced, which is the kind of mistake that ships a
month-old screen with a current version number.

Verify before uploading:

```bash
# Signed by your key, not the debug key
apksigner verify --print-certs android/app/build/outputs/bundle/release/app-release.aab
# No restricted permission survived the merge
grep -o 'android.permission.[A-Z_]*' \
  android/app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml \
  | sort -u
```

The second list should contain exactly: `ACCESS_NETWORK_STATE`,
`FOREGROUND_SERVICE`, `INTERNET`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`,
`USE_BIOMETRIC`, `USE_FINGERPRINT`, `WAKE_LOCK`. `FOREGROUND_SERVICE` and
`USE_FINGERPRINT` come from androidx (WorkManager and androidx.biometric); no
service in the merged manifest declares a `foregroundServiceType` and nothing
starts one, so neither needs a Play declaration.

**Never upload the wrapper.** Setting `CONTOUR_URL` builds *Contour LAN* — a
WebView onto a running server, with a different application id. It is a
development tool and it is not what this listing is for.

### 4. The Data safety form

Play defines *collect* as "transmitting data from your app off a user's device".
Against that definition Contour's honest answers are:

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **No** |
| Is all user data encrypted in transit? | Yes (every endpoint is HTTPS) |
| Do you provide a way for users to request data deletion? | Data never leaves the device; uninstalling removes it |

Everything a person enters stays in the app's private storage. There is no
account, no analytics SDK, no advertising SDK, no crash reporter and no server
belonging to this project.

**The one judgement call**, and it is worth making deliberately rather than by
default: the Google backup opt-in. When it is on, Contour writes an export into
a directory Android's backup service may copy to the user's own Google Drive.
Contour transmits nothing — Android does, to the user's own account, at the
user's explicit request — so under Play's definition this is not collection by
the app, and the form is answered "No" above. It is disclosed in plain words in
the privacy policy regardless, because "we do not collect anything" and "there
is a switch that copies your ledger to Drive" both being true is exactly the
kind of thing a person should read from us rather than discover.

If you would rather be conservative, declare *Financial info → other financial
info*, collected, not shared, optional, for app functionality. It costs a line
in the listing and no argument later.

### 5. The rest of the listing

- **Privacy policy URL** — required for every app. Host `docs/privacy-policy.md`
  somewhere public and stable and paste the URL. A public gist works while the
  repository is private.
- **App category** — Finance.
- **Content rating questionnaire** — no user-generated content, no ads, no
  purchases, no data sharing. It will come out at the lowest rating.
- **Target audience** — 18+, and not designed for children.
- **Financial features declaration** — Finance apps are asked what financial
  features they have. Contour is none of the listed ones: it does not trade,
  hold funds, lend, transfer money or handle cryptocurrency custody. It displays
  prices and records what its user typed. Answer accordingly; do not leave it
  blank.
- **Graphics** — a 512×512 icon, a 1024×500 feature graphic, and at least two
  phone screenshots. `scripts/generate-icons.mjs` is the only place the mark's
  geometry lives; generate from it rather than exporting by hand, so the store
  icon and the launcher icon cannot drift.
- **Ads** — declare none. There are none.

---

## What the policy cost

Two permissions were removed to make the app publishable, and it is worth
recording that neither was cosmetic and neither cost a feature.

**`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`** bought Android's one-tap "let this run
in the background" dialog, which the setup flow offered once. Play permits the
permission only where doze breaks the *core* function of the app, and Android's
own documentation lists the cases: calling apps, safety apps, task automation,
peripheral companions. A price-alert tracker is on none of them, and it would
not be honest to claim otherwise — the app checks alerts every time it is
opened, so doze delays them rather than breaking them.

What replaces it is the same destination one tap further away.
`BatteryOptimizationPlugin` now opens the battery-optimisation **list**, which
needs no permission, and reading the current state never needed one either. So
the screen still knows whether Android is throttling the background check and
still offers a way out; the person has to find Contour in a list to take it. The
copy says so.

**`SCHEDULE_EXACT_ALARM`** was never ours. `@capacitor/local-notifications` and
`@capacitor/background-runner` both declare it, because both can schedule a
notification for a time, and the manifest merger folds it in silently. This app
never schedules for a time — every `LocalNotifications.schedule` call omits the
`schedule` field, which posts immediately and sets no alarm. Play treats it as
restricted and expects a declaration naming an alarm-clock or calendar use case
this app does not have.

Removing it was **not** free, and the cost was nearly invisible.
`isExactNotification` defaults to `true` in `@capacitor/local-notifications`,
and the plugin tests that flag *before* it looks at whether a notification is
scheduled at all: with `canScheduleExactAlarms()` false, `schedule()` opens
Android's "Alarms & reminders" settings screen and posts nothing. So on Android
12 and above every alert would have become a settings screen. The fix is one
option on the call — `isExactNotification: false` — and
`scripts/exact-alarm.test.ts` pins it to every `schedule()` call, because
nothing else can catch it: it type-checks, builds and passes every other test,
and misbehaves only on a real phone at the moment an alert fires.

The half-hourly background check is unaffected either way.
`@capacitor/background-runner` schedules it with a WorkManager
`PeriodicWorkRequest`, which uses no alarm at all; the runner's own notification
path touches `AlarmManager` only for a notification with a `scheduleAt`, and
already falls back to `setAndAllowWhileIdle` when the permission is absent.

Both would have built, installed and run perfectly. The rejection would have
arrived weeks later from a review queue, which is why
`scripts/android-manifest.test.ts` now fails on either of them rather than
leaving it to be rediscovered.

---

## Still open

- The account identity (#68), blocked on a register change. Everything else on
  this page is independent of it and can proceed now.
- The source offer: publish the offline subset, or resolve #53.
- Instructions for lifting the background restriction per manufacturer (#67) —
  the user-facing cost of losing the one-tap battery dialog.
- `/api/app/download` still serves whatever the last build produced (#61's last
  loose end). Once Play is the channel, decide whether it serves the release
  build or stops advertising itself.
- The CI job builds `assembleDebug` and uploads it as an artefact. Its name does
  not say "debug". Either rename it or move it to the release variant.
