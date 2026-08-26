"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Fingerprint } from "lucide-react";
import ContourMark from "@/components/ContourMark";
import TradingBackdrop from "@/components/TradingBackdrop";
import { remainingSplash } from "./lock-timing";

/** Re-lock after this long in the background; a glance away should not cost a prompt. */
const RELOCK_AFTER_MS = 60_000;

/**
 * `splash` is the app's own screen, held briefly before the system sheet
 * covers it. It exists as a state of its own rather than as a delay inside
 * `checking`, because the two look different on purpose: `checking` is the
 * single frame a browser sees and is deliberately blank, while `splash` is
 * the entrance and shows the mark over the moving market.
 */
type State = "checking" | "splash" | "unavailable" | "locked" | "prompting" | "open";

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
        // Only the title is set: the plugin also renders `reason` and
        // `androidSubtitle` in the same sheet, which repeated the sentence.
        androidTitle: "Unlock Contour",
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
    const startedAt = Date.now();
    (async () => {
      const { Capacitor } = await import("@capacitor/core");
      if (!Capacitor.isNativePlatform()) { if (!cancelled) setState("unavailable"); return; }
      try {
        const { BiometricAuth } = await import("@aparajita/capacitor-biometric-auth");
        const info = await BiometricAuth.checkBiometry();
        if (cancelled) return;
        if (!info.isAvailable && !info.deviceIsSecure) { setState("unavailable"); return; }

        // Let the app say who it is before the operating system takes the
        // screen. Without this the sheet can arrive in the same breath as the
        // first paint, and the entrance is a black flash.
        //
        // Only on a cold start. The re-lock path below calls `unlock` directly,
        // because returning from another app is not an entrance and a second
        // spent admiring the logo is a second in the way.
        setState("splash");
        const wait = remainingSplash(startedAt, Date.now());
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        if (cancelled) return;
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

  const locked = state !== "unavailable" && state !== "open";

  // The page always renders; the lock covers it. Replacing the children would
  // strip every page's server-rendered HTML, leaving a blank screen until the
  // JavaScript arrives.
  return (
    <>
      {children}
      {locked && <Overlay state={state} error={error} onUnlock={unlock} />}
    </>
  );
}

function Overlay({
  state, error, onUnlock,
}: {
  state: State;
  error: string | null;
  onUnlock: () => void;
}) {
  const working = state === "checking" || state === "splash" || state === "prompting";
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-start pt-[14vh] p-8">
      {/* The same moving market as the login screen, so both entrances to the
          app look like the same app. Skipped during "checking", which is the
          one frame a browser sees before the lock bows out — and shown during
          "splash", which is the second a phone deliberately spends here. */}
      {state === "checking" ? <div className="fixed inset-0 bg-neutral-950" /> : <TradingBackdrop />}

      <style>{`
        @keyframes lock-breathe {
          0%, 100% { transform: scale(1);    opacity: 0.55; }
          50%      { transform: scale(1.14); opacity: 0.15; }
        }
        @keyframes lock-rise {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .lock-anim { animation: none !important; }
        }
      `}</style>

      <div className="relative z-10 flex flex-col items-center gap-6 text-center">
        <div className="relative flex items-center justify-center">
          {/* A ring that breathes while the prompt is up, so a slow sensor
              still looks like the app is doing something. */}
          {working && (
            <span
              className="lock-anim absolute rounded-full border border-blue-500/60"
              style={{ width: 132, height: 132, animation: "lock-breathe 2.4s ease-in-out infinite" }}
            />
          )}
          <span
            className="rounded-full bg-blue-600 p-6"
            style={{ boxShadow: "0 0 60px rgba(37,99,235,0.45)" }}
          >
            <ContourMark size={64} breathing />
          </span>
        </div>

        <div className="lock-anim" style={{ animation: "lock-rise 400ms ease-out both" }}>
          <p className="text-2xl font-semibold tracking-wide">Contour</p>
          <p className="text-xs text-neutral-500 mt-1">
            {state === "prompting" ? "Waiting for your fingerprint…"
              : state === "checking" || state === "splash" ? "\u00a0"
              : "Locked"}
          </p>
        </div>

        {!working && (
          <div className="lock-anim flex flex-col items-center gap-3"
               style={{ animation: "lock-rise 400ms ease-out both" }}>
            <button
              onClick={onUnlock}
              aria-label="Unlock Contour"
              className="w-16 h-16 rounded-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white flex items-center justify-center transition-colors"
            >
              <Fingerprint size={28} aria-hidden />
            </button>
            <span className="text-xs text-neutral-500">Tap to unlock</span>
            {error && <p className="text-sm text-red-500 max-w-xs">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
