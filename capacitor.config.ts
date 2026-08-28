import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The shell bundles `apps/mobile`'s static export and runs with no server.
 *
 * It used to point `server.url` at the running Contour instance and load the
 * web app over the LAN — a wrapper that answered "does this feel right as a
 * native app" before the local-first work was worth starting. Phase 4 made
 * that unnecessary: the same services now run against a SQLite database on
 * the device, so there is nothing left for the shell to fetch a UI from.
 *
 * **This is a different app from the one the LAN wrapper produced**, and the
 * differences are not accidents:
 *
 * - Its data is its own. The device database starts empty; a portfolio comes
 *   over as a backup file, not by reaching the server.
 * - No login, no passkey, no `SESSION_SECRET`. The device lock is the lock.
 * - No alerts, and so no `BackgroundRunner` block. Alerts need the alerts
 *   routes, Home Assistant, web-push and FCM — every one of them server-only
 *   by design. Leaving the runner configured would have pointed it at a
 *   `runner/alerts.js` this bundle does not contain, and given it a key store
 *   no one writes rules into.
 * - No strategy tooling: chart, backtest, analyze and the PineScript library
 *   all need the filesystem or a server-side Binance proxy.
 *
 * Set `CONTOUR_URL` to build the wrapper instead. The two are **different
 * applications and install side by side**: `app.contour.standalone` /
 * "Contour Standalone" against `app.contour.local` / "Contour". Sharing one
 * id would mean each install replaced the other, and replacing the wrapper
 * leaves the phone showing an empty portfolio, since the standalone build's
 * database is its own and starts empty.
 *
 * `android/app/build.gradle` reads the same variable and must agree with this;
 * it is the half Android actually installs by, and it also names the launcher
 * icon, the recents card and the deep-link scheme.
 */
const url = process.env.CONTOUR_URL?.trim() || undefined;

const config: CapacitorConfig = {
  appId: url ? "app.contour.local" : "app.contour.standalone",
  appName: url ? "Contour" : "Contour Standalone",
  // The wrapper serves its UI from the running app, so its bundle is the web
  // app's public directory — which is also where `runner/alerts.js` lives.
  webDir: url ? "apps/web/public" : "apps/mobile/out",
  ...(url
    ? {
        server: { url, cleartext: url.startsWith("http://") },
        plugins: {
          /**
           * Wakes every quarter hour to check price alerts with the app
           * closed. Android treats the interval as a target, not a promise.
           *
           * Only the wrapper gets it. Alerts need the alerts routes, Home
           * Assistant, web-push and FCM, all of which live on the server, so
           * in the standalone build this would wake on a schedule to read a
           * key store nothing writes rules into.
           */
          BackgroundRunner: {
            label: "app.contour.local.alerts",
            src: "runner/alerts.js",
            event: "alertCheck",
            repeat: true,
            interval: 15,
            autoStart: true,
          },
        },
      }
    : {}),
  android: {
    // Match the app's own dark background so launches don't flash white.
    backgroundColor: "#0a0a0a",
  },
};

export default config;
