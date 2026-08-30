This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Deployment (public domain + PWA)

1. **Env**: copy `apps/web/.env.example` to `apps/web/.env`, fill `SESSION_SECRET`/`CRON_SECRET`
   (`openssl rand -hex 32`) and VAPID keys (`npx web-push generate-vapid-keys`).
2. **Install & generate**: `npm install`, then `npx prisma generate` (needed once on a fresh
   clone, before the app will run).
3. **Build & run**: `npm run build && npm run start` (port 3000). Example systemd unit:

   ```ini
   [Unit]
   Description=Contour
   After=network.target

   [Service]
   WorkingDirectory=/home/roy/Trader
   ExecStart=/usr/bin/npm run start
   Restart=on-failure
   User=roy

   [Install]
   WantedBy=multi-user.target
   ```

4. **Reverse proxy (Caddy)** — automatic Let's Encrypt:

   ```
   contour.example.com {
       reverse_proxy localhost:3000
   }
   ```

5. **First run**: open the domain → you're redirected to `/setup` → set the app password.
6. **Cron** (alert evaluation every 5 minutes):

   ```
   */5 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://contour.example.com/api/cron/evaluate
   ```

7. **Install on iPhone**: open the site in Safari → Share → *Add to Home Screen*.
   Then Settings → *Enable notifications* (Web Push needs the installed app, iOS 16.4+).
   Home Assistant keeps working as a second notification path.

## Android app

The app runs on the phone with no server behind it. The same services that
answer an HTTP request on the desktop run against a SQLite database on the
device, so the portfolio, the ledger, insights and markets all work with the
network off — prices are simply absent, and say so.

```bash
npm run build --workspace @contour/mobile
npx cap sync android
npm run android:build     # android/app/build/outputs/apk/debug/app-debug.apk
```

### What the phone app does not do

It is a different application from the desktop one, not a window onto it, and
the gaps are deliberate rather than unfinished:

- **Its data is its own.** The device database starts empty. A portfolio
  arrives as a backup file through More → import; it is not read from the
  server, and changes made on the phone stay on the phone. There is no sync.
- **No alerts.** They need the alerts routes, Home Assistant, web-push and
  FCM — all server-side. Alerts remain a desktop feature.
- **No login or passkey.** There is no session and no `SESSION_SECRET`; the
  device lock is the lock, falling back to the PIN. An app whose lock it
  cannot itself reset is the point.
- **No strategy tooling.** The chart, backtester, PineScript analyzer and
  script library need the filesystem or a server-side Binance proxy.
- **Equity background is thin.** Yahoo's cookie-and-crumb handshake needs a
  response header the portable `Net` does not expose, so an equity's
  information panel states its absence rather than showing an empty box.

### Two apps, side by side

The wrapper did not go away, and the two install alongside each other rather
than replacing one another:

| | Standalone | Wrapper |
|---|---|---|
| Built by | the commands above | `CONTOUR_URL=http://…` set first |
| Application id | `app.contour.standalone` | `app.contour.local` |
| Launcher name | Contour | Contour LAN |
| Data | its own, on the device | the server's |
| Works offline | yes, without prices | no |
| Alerts | no | yes, foreground and background |

They carry different application ids deliberately. With one id each install
would replace the other, and replacing the wrapper leaves the phone showing an
empty portfolio — the standalone database is its own and starts empty. Having
both on the phone is also the only way to compare them.

```bash
# the wrapper, exactly as it behaved before Phase 4
export CONTOUR_URL="http://192.168.2.5:3001"
npx cap sync android && npm run android:build
```

`android/app/build.gradle` reads the same variable to pick the id, the launcher
name, the recents-card label and the deep-link scheme, so the two halves cannot
drift apart. Both write to `app-debug.apk`, so copy one aside before building
the other.

Building needs a JDK 21 and the Android SDK (platform 35+, build-tools 35).
Point Gradle at them with `android/local.properties` (`sdk.dir=/path/to/Sdk`)
and `JAVA_HOME`.

Install the APK by copying it to the phone and opening it (allow installs from
unknown sources), or over USB with `adb install -r app-debug.apk`.

`cleartext` is enabled automatically while `CONTOUR_URL` is plain http, which
is what makes a LAN address work in that mode.

### Installing a new build on the phone

Every change now needs a new APK: the app is bundled, so nothing is live from
the server any more. That is the cost of it working with the network off.

```bash
npm run android:build          # writes android/app/build/outputs/apk/debug/
```

Then on the phone, open **More → Install the latest build**, which streams that
APK from the running server. Android asks once for permission to install from
the browser. The build keeps the same app id, so it upgrades in place and
nothing is lost.

Over USB instead: `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`

## Licence

**AGPL-3.0-or-later.** The full text is in [LICENSE](LICENSE); [NOTICE](NOTICE)
carries the copyright line and the exceptions.

Two things worth knowing before you copy anything out of here:

- **`samples/risk-metric.pine` is not mine to license.** It is Oakley Wood's
  "Risk Metric Strategy", bundled for reference, and it carries no licence of
  its own. `packages/core/src/indicator/` is a port of it — the sub-metrics and
  their time curves are transcribed verbatim, which is the only reason the
  figures match TradingView. NOTICE says so in full.
- **Section 13 is why AGPL and not GPL.** Modify this and let other people use
  it over a network, and you owe those users your source. Running it unmodified,
  or running it for yourself, asks nothing of you.

The TradingView attribution rendered on the More page satisfies Lightweight
Charts' Apache-2.0 terms, and is why every chart sets `attributionLogo: false`.
It is not decoration; removing it without replacing it is a breach.
