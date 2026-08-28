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
 * Set `CONTOUR_URL` to go back to the wrapper for a comparison; it is not the
 * shipping shape any more.
 */
const url = process.env.CONTOUR_URL;

const config: CapacitorConfig = {
  appId: "app.contour.local",
  appName: "Contour",
  webDir: "apps/mobile/out",
  ...(url
    ? { server: { url, cleartext: url.startsWith("http://") } }
    : {}),
  android: {
    // Match the app's own dark background so launches don't flash white.
    backgroundColor: "#0a0a0a",
  },
};

export default config;
