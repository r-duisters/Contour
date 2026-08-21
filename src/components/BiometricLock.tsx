"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Fingerprint } from "lucide-react";
import NablaMark from "@/components/NablaMark";

/** Re-lock after this long in the background; a glance away should not cost a prompt. */
const RELOCK_AFTER_MS = 60_000;

type State = "checking" | "unavailable" | "locked" | "prompting" | "open";

/**
 * A device-level lock over the app, for the native shell.
 *
 * This guards the app on the phone, not the server: the session cookie still
 * does the authenticating, and anyone reaching the server in a browser still
 * meets the password. What it buys is that a found or borrowed phone cannot
 * simply open a portfolio that is permanently signed in.
 *
 * In a plain browser there is no native prompt, so the lock stays out of the
 * way entirely rather than pretending to protect something.
 */
export default function BiometricLock({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState<string | null>(null);
  const hiddenSince = useRef<number | null>(null);

  const unlock = useCallback(async () => {
    setState("prompting");
    setError(null);
    try {
      const { BiometricAuth } = await import("@aparajita/capacitor-biometric-auth");
      await BiometricAuth.authenticate({
        reason: "Unlock Nabla",
        androidTitle: "Unlock Nabla",
        androidSubtitle: "Confirm it is you",
        allowDeviceCredential: true, // the screen lock is an acceptable fallback
        cancelTitle: "Cancel",
      });
      setState("open");
    } catch (e) {
      setState("locked");
      const message = (e as { message?: string }).message ?? "";
      // A cancelled prompt is a choice, not a failure worth shouting about.
      if (!/cancel/i.test(message)) setError(message || "Could not verify.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { Capacitor } = await import("@capacitor/core");
      if (!Capacitor.isNativePlatform()) { if (!cancelled) setState("unavailable"); return; }
      try {
        const { BiometricAuth } = await import("@aparajita/capacitor-biometric-auth");
        const info = await BiometricAuth.checkBiometry();
        if (cancelled) return;
        if (!info.isAvailable && !info.deviceIsSecure) { setState("unavailable"); return; }
        setState("locked");
        unlock();
      } catch {
        if (!cancelled) setState("unavailable");
      }
    })();
    return () => { cancelled = true; };
  }, [unlock]);

  // Lock again when the app has been away long enough to have changed hands.
  useEffect(() => {
    if (state === "unavailable" || state === "checking") return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenSince.current = Date.now();
        return;
      }
      const away = hiddenSince.current === null ? 0 : Date.now() - hiddenSince.current;
      hiddenSince.current = null;
      if (away > RELOCK_AFTER_MS && state === "open") {
        setState("locked");
        unlock();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [state, unlock]);

  if (state === "unavailable" || state === "open") return <>{children}</>;

  return (
    <div className="fixed inset-0 z-50 bg-neutral-950 flex flex-col items-center justify-center gap-6 p-8">
      <NablaMark size={64} />
      {/* "checking" is the first paint everywhere, including the browser, so it
          shows the mark alone and reads as a splash rather than a stall. */}
      {state === "checking" ? null : state === "prompting" ? (
        <p className="text-sm text-neutral-500">Unlocking…</p>
      ) : (
        <>
          <button
            onClick={unlock}
            className="bg-blue-600 text-white rounded px-4 py-2 text-sm inline-flex items-center gap-2"
          >
            <Fingerprint size={16} aria-hidden />
            Unlock
          </button>
          {error && <p className="text-sm text-red-500 text-center">{error}</p>}
        </>
      )}
    </div>
  );
}
