"use client";

import { useEffect } from "react";

/**
 * Registers the device for push, and hands the token to this server.
 *
 * Native only. In a browser the Web Push path in Settings does this job, and
 * in the APK that path cannot work at all — Android's WebView implements no
 * Push API and does not define `navigator.serviceWorker`. The two mechanisms
 * are exclusive by platform, which is why both exist.
 *
 * It runs on every launch rather than once. An FCM token is not stable: it
 * rotates when the app is restored to a new device, when data is cleared, and
 * occasionally on its own. Re-registering is an upsert, so the cost of doing
 * it every time is one request, and the cost of not doing it is silence
 * nobody can explain.
 */
export default function FcmSetup() {
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { Capacitor } = await import("@capacitor/core");
      if (!Capacitor.isNativePlatform() || cancelled) return;

      const { PushNotifications } = await import("@capacitor/push-notifications");

      // Android 13 and later post nothing without this.
      let status = await PushNotifications.checkPermissions();
      if (status.receive === "prompt" || status.receive === "prompt-with-rationale") {
        status = await PushNotifications.requestPermissions();
      }
      if (status.receive !== "granted" || cancelled) return;

      PushNotifications.addListener("registration", (token) => {
        // Fire and forget: a failure here costs this launch's registration,
        // and the next launch tries again.
        void fetch("/api/push/fcm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: token.value, label: "android" }),
        }).catch(() => {});
      });

      PushNotifications.addListener("registrationError", () => {
        // Nothing useful to do on the device. The absence shows up in Settings
        // as a device count of zero, which is the honest signal.
      });

      await PushNotifications.register();
    })();

    return () => { cancelled = true; };
  }, []);

  return null;
}
