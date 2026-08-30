"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "./Button";
import {
  isBatteryExempt,
  requestBatteryExemption,
  requestNotifications,
  type NotificationPermission,
} from "./device-notifications";

/**
 * Whether alerts can reach this phone at all — and nothing about what they say.
 *
 * The Notifications section used to hold both: the permission, a paragraph
 * about the schedule, and the "tell me about big moves" switch. That switch is
 * an alert rule — it writes a row that appears in the alerts list and can be
 * paused there — so it moved to Alerts, beside the rules it joins. What is
 * left here is the one question a settings screen should answer about
 * notifications: are they on.
 *
 * Two permissions, because they fail differently and only one of them is
 * loud. Without notification permission nothing is ever posted, which is
 * obvious. Battery optimisation instead defers the background check quietly —
 * for hours, or forever — and the symptom is a notification that does not
 * arrive, which looks exactly like a market that did not move.
 *
 * Everything answers safely off a phone: `device-notifications` feature-detects
 * and returns "unavailable" in a browser, and this draws nothing for it rather
 * than offering a control that cannot work.
 */
export default function NotificationAccess() {
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [exempt, setExempt] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  /** Bumped to ask again — after the system dialog has been answered, say. */
  const [reads, setReads] = useState(0);
  const read = useCallback(() => setReads((n) => n + 1), []);

  /*
   * Read without asking.
   *
   * `requestNotifications` shows the system dialog when permission has not been
   * granted, so calling it to *render* would prompt on arrival — a settings
   * screen that demands an answer before it will show you its state. This asks
   * the plugin directly and treats every failure as "not here".
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (cancelled) return;
        if (!Capacitor.isNativePlatform()) { setPermission("unavailable"); return; }
        const { LocalNotifications } = await import("@capacitor/local-notifications");
        const now = await LocalNotifications.checkPermissions();
        const exemptNow = await isBatteryExempt();
        if (cancelled) return;
        setPermission(now.display === "granted" ? "granted" : "denied");
        setExempt(exemptNow);
      } catch {
        if (!cancelled) setPermission("unavailable");
      }
    })();
    return () => { cancelled = true; };
  }, [reads]);

  // A browser, or a phone that cannot answer. Say nothing rather than
  // something that is not true here.
  if (permission === null || permission === "unavailable") return null;

  const granted = permission === "granted";

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm">{granted ? "Alerts can reach this phone" : "Alerts cannot reach this phone"}</p>
          <p className="text-xs text-neutral-500 mt-0.5 max-w-prose">
            {granted
              ? "Checked every time you open the app, and every half hour in the background when Android allows it."
              : "Android is not letting this app post notifications, so an alert can fire and reach nobody."}
          </p>
        </div>
        {!granted && (
          <Button
            disabled={busy}
            onClick={() => void (async () => {
              setBusy(true);
              await requestNotifications();
              read();
              setBusy(false);
            })()}
          >
            Turn on
          </Button>
        )}
      </div>

      {/*
        Turning them off is Android's to do, not ours: an app cannot revoke its
        own permission, and a switch that only ever moved one way would be a
        lie. So this says where the switch actually is rather than pretending
        to be it.
      */}
      {granted && (
        <p className="text-xs text-neutral-500">
          To turn them off, use Android&rsquo;s own notification settings for Contour.
        </p>
      )}

      {/*
        Only when Android says it is throttling this app. A button that cannot
        change anything is worse than no button, and on a phone that never had
        the restriction there is nothing to fix.
      */}
      {granted && exempt === false && (
        <div className="flex items-start gap-2 flex-wrap">
          <p className="text-xs text-amber-500 flex-1 min-w-40">
            Android is holding background checks back to save battery, so the half-hourly
            check may be delayed for hours or skipped. Lifting it means finding Contour
            in Android&rsquo;s own battery list.
          </p>
          <Button
            variant="secondary"
            onClick={() => void (async () => { setExempt(await requestBatteryExemption()); })()}
          >
            Open battery settings
          </Button>
        </div>
      )}
    </div>
  );
}
