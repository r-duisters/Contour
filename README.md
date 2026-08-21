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

1. **Env**: copy `.env.example` to `.env`, fill `SESSION_SECRET`/`CRON_SECRET`
   (`openssl rand -hex 32`) and VAPID keys (`npx web-push generate-vapid-keys`).
2. **Build & run**: `npm run build && npm run start` (port 3000). Example systemd unit:

   ```ini
   [Unit]
   Description=Trader
   After=network.target

   [Service]
   WorkingDirectory=/home/roy/Trader
   ExecStart=/usr/bin/npm run start
   Restart=on-failure
   User=roy

   [Install]
   WantedBy=multi-user.target
   ```

3. **Reverse proxy (Caddy)** — automatic Let's Encrypt:

   ```
   trader.example.com {
       reverse_proxy localhost:3000
   }
   ```

4. **First run**: open the domain → you're redirected to `/setup` → set the app password.
5. **Cron** (alert evaluation every 5 minutes):

   ```
   */5 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://trader.example.com/api/cron/evaluate
   ```

6. **Install on iPhone**: open the site in Safari → Share → *Add to Home Screen*.
   Then Settings → *Enable notifications* (Web Push needs the installed app, iOS 16.4+).
   Home Assistant keeps working as a second notification path.

## Android app (Capacitor shell)

A thin native wrapper so the tracker runs as a real Android app. It does not
bundle the site: the WebView loads the running Trader server, so the phone app
and the browser always show the same thing.

```bash
# point the shell at your server (defaults to http://192.168.2.5:3001)
export TRADER_URL="https://trader.example.com"
npm run android:sync
npm run android:build     # android/app/build/outputs/apk/debug/app-debug.apk
```

Building needs a JDK 21 and the Android SDK (platform 35+, build-tools 35).
Point Gradle at them with `android/local.properties` (`sdk.dir=/path/to/Sdk`)
and `JAVA_HOME`.

Install the APK by copying it to the phone and opening it (allow installs from
unknown sources), or over USB with `adb install -r app-debug.apk`.

`cleartext` is enabled automatically while `TRADER_URL` is plain http, which is
what makes a LAN address work. Once the app is on HTTPS this switches itself
off, and passkey login starts working in the shell too.
