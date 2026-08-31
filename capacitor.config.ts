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
 * "Contour" against `app.contour.local` / "Contour LAN". Sharing one id would
 * mean each install replaced the other, and replacing the device build leaves
 * the phone showing an empty portfolio, since its database is its own and
 * starts empty.
 *
 * The device build carries the plain name and the wrapper takes the qualifier,
 * which is the right way round: the wrapper exists to compare against. The ids
 * did not move when the names did — `app.contour.standalone` is what Android
 * installs by, and renaming that would orphan the database rather than rename
 * anything.
 *
 * `android/app/build.gradle` reads the same variable and must agree with this;
 * it is the half Android actually installs by, and it also names the launcher
 * icon, the recents card and the deep-link scheme.
 */
const url = process.env.CONTOUR_URL?.trim() || undefined;

const config: CapacitorConfig = {
  appId: url ? "app.contour.local" : "app.contour.standalone",
  appName: url ? "Contour LAN" : "Contour",
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
      // Named here as well as under LocalNotifications, and that is not a
      // duplicate: the two plugins post through different code and each reads
      // `smallIcon` from its own config. Set on one only, half the alerts this
      // app sends wear the right mark and half wear Android's generic "i" —
      // which is what both did before, since neither was set.
      smallIcon: "ic_stat_contour",
    },
    LocalNotifications: {
      /*
       * The mark, without its tile.
       *
       * A status-bar icon keeps only its alpha channel; Android discards the
       * colours and tints what is left. The blue disc has alpha everywhere, so
       * pointing this at the app icon posts a solid white blob. The mark alone
       * is the same drawing with the part that cannot survive removed —
       * `scripts/generate-icons.mjs` writes it, from the same geometry as every
       * other surface.
       *
       * Absent, both plugins fall back to `android.R.drawable.ic_dialog_info`.
       */
      smallIcon: "ic_stat_contour",
    },
  },
  ...(url ? { server: { url, cleartext: url.startsWith("http://") } } : {}),
  android: {
    // Match the app's own dark background so launches don't flash white.
    backgroundColor: "#0a0a0a",
  },
};

export default config;
