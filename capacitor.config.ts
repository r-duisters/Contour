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
 - Alerts are its own. It has no alerts routes, no Home Assistant and no
 *   web-push — all server-only by design — but a price target and a daily move
 *   need none of that, so it evaluates them itself and posts a local
 *   notification. Both builds run a `BackgroundRunner`, each against its own
 *   copy of `runner/alerts.js` inside its own `webDir`, under its own label so
 *   two installs cannot dispatch into each other.
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
  /**
   * Wakes on a schedule to check price alerts with the app closed.
   *
   * Android treats the interval as a target and not a promise: a
   * battery-optimised phone may never grant the job at all, which is why the
   * app's setup flow offers to lift that restriction, and why the check that
   * is guaranteed still runs on every foreground.
   *
   * The label is per-app because the two builds install side by side. A shared
   * label would let one build's foreground pass write rules the other build's
   * job then evaluates, against a portfolio it has never seen.
   *
   * Half an hour rather than the wrapper's quarter: a check is two requests
   * for coins and one per share, and doubling the gap halves that against a
   * schedule Android already declines to honour precisely.
   */
  plugins: {
    BackgroundRunner: {
      label: url ? "app.contour.local.alerts" : "app.contour.standalone.alerts",
      src: "runner/alerts.js",
      event: "alertCheck",
      repeat: true,
      interval: url ? 15 : 30,
      autoStart: true,
    },
  },
  ...(url ? { server: { url, cleartext: url.startsWith("http://") } } : {}),
  android: {
    // Match the app's own dark background so launches don't flash white.
    backgroundColor: "#0a0a0a",
  },
};

export default config;
