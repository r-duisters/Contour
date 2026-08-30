"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Fingerprint } from "lucide-react";
import ContourMark from "@/components/ContourMark";
import TradingBackdrop from "@/components/TradingBackdrop";
import {
  ENTRANCE_EASE,
  LOCK_DISC_PX,
  SETTLE_SCALE,
  SETTLE_DELAY_MS,
  SETTLE_MS,
  TITLE_DELAY_MS,
  TITLE_MS,
  remainingSplash,
} from "./lock-timing";

/** Re-lock after this long in the background; a glance away should not cost a prompt. */
const RELOCK_AFTER_MS = 60_000;

/**
 * How long the lock takes to fade once it opens.
 *
 * The overlay used to unmount on the frame the prompt succeeded, so the
 * entrance ended in a hard cut from the mark to the portfolio. Long enough to
 * read as a dissolve, short enough that it is not a wait.
 */
const CLOSE_MS = 260;

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
 *
 * **It guards the screen, not the file.** This is an overlay over a page that
 * has already rendered, and the database behind it is unencrypted; anyone who
 * gets at the file has the portfolio whatever this component is doing. That is
 * not a gap to fix here — it is what `docs/security-review-2026-08-30.md`
 * tracks as M2, and the paths that lead to the file are the backup rules and
 * the build's `debuggable` flag rather than anything on this screen. Worth
 * stating so the lock is not mistaken for data protection by someone deciding
 * whether the rest of it matters.
 */
export default function BiometricLock({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  // Whether this is the app opening rather than re-locking. The mark travels
  // from the centre only on an entrance: coming back from another app, there
  // was no splash behind it to travel from, and the movement would be an
  // animation of nothing.
  const [entrance, setEntrance] = useState(true);
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
      setClosing(true);
      // Kept mounted while it fades; `closing` drives the opacity and the
      // timeout is what finally takes it down.
      window.setTimeout(() => { setClosing(false); setState("open"); }, CLOSE_MS);
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
        setEntrance(false);
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
      {locked && (
        <Overlay
          state={state}
          error={error}
          onUnlock={unlock}
          closing={closing}
          entrance={entrance}
        />
      )}
    </>
  );
}

function Overlay({
  state, error, onUnlock, closing, entrance,
}: {
  state: State;
  error: string | null;
  onUnlock: () => void;
  closing: boolean;
  entrance: boolean;
}) {
  const working = state === "checking" || state === "splash" || state === "prompting";
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-start pt-[14vh] p-8"
      style={{
        opacity: closing ? 0 : 1,
        // Scaling up a touch as it goes makes the lock read as lifting away
        // from the app rather than simply switching off.
        transform: closing ? "scale(1.04)" : "none",
        transition: `opacity ${CLOSE_MS}ms ease-out, transform ${CLOSE_MS}ms ease-out`,
        pointerEvents: closing ? "none" : undefined,
      }}
    >
      {/* The same moving market as the login screen, so both entrances to the
          app look like the same app. Skipped during "checking", which is the
          one frame a browser sees before the lock bows out — and shown during
          "splash", which is the second a phone deliberately spends here. */}
      {/* The flat ground stays underneath for the whole life of the lock, so
          the market fading in over it is a fade rather than a swap — the two
          used to replace each other outright and the backdrop arrived as a
          jolt on the frame `checking` became `splash`. */}
      <div className="fixed inset-0 bg-neutral-950" />
      {state !== "checking" && (
        <div className="lock-anim fixed inset-0" style={{ animation: "lock-fade 520ms ease-out both" }}>
          <TradingBackdrop />
        </div>
      )}

      <style>{`
        @keyframes lock-breathe {
          0%, 100% { transform: scale(1);    opacity: 0.55; }
          50%      { transform: scale(1.14); opacity: 0.15; }
        }
        @keyframes lock-fade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes lock-rise {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: none; }
        }
        /*
          The disc's journey. It starts where the splash left it — screen
          centre — and ends where the lock wants it. 36vh is the distance
          between the two centres: the block's top is at 14vh and the disc is
          112px tall, so its centre rests at 14vh + 56px, against 50vh.

          It also shrinks. The system draws its splash icon at its own canvas
          size and will not be argued down, so the app's splash matches that
          size and the mark reaches its resting 112px on the way rather than in
          one frame. Scaling is about the element's centre and translation is
          applied first, so the two compose without the offset changing.

          The curve is ENTRANCE_EASE, and the whole sequence's timing lives in
          lock-timing.ts beside the splash it has to fit inside. Backticks are
          not available in here: this comment sits inside a template literal,
          and one closes it.
        */
        @keyframes lock-settle {
          from { transform: translateY(calc(36vh - 56px)) scale(var(--settle-scale)); }
          to   { transform: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .lock-anim { animation: none !important; }
        }
      `}</style>

      <div className="relative z-10 flex flex-col items-center gap-6 text-center">
        <div
          className="lock-anim relative flex items-center justify-center"
          style={entrance
            ? {
                animation: `lock-settle ${SETTLE_MS}ms ${ENTRANCE_EASE} both`,
                animationDelay: `${SETTLE_DELAY_MS}ms`,
                ["--settle-scale" as string]: SETTLE_SCALE,
              }
            : undefined}
        >
          {/* A ring that breathes while the prompt is up, so a slow sensor
              still looks like the app is doing something. */}
          {working && (
            <span
              className="lock-anim absolute rounded-full border border-blue-500/60"
              style={{ width: 132, height: 132, animation: "lock-breathe 2.4s ease-in-out infinite" }}
            />
          )}
          {/* A fixed size with the mark centred, not padding around it.
              `p-6` was a flat 24px on every side, which at this scale dominated
              — a 112px disc carrying a 41px drawing, barely half the fill the
              login tile had. The disc keeps its 112px so the breathing ring
              above still clears it by 10px. */}
          <span
            className="rounded-full bg-blue-600 flex items-center justify-center"
            style={{
              width: LOCK_DISC_PX,
              height: LOCK_DISC_PX,
              boxShadow: "0 0 60px rgba(37,99,235,0.45)",
            }}
          >
            <ContourMark size={Math.round(LOCK_DISC_PX * 0.86)} breathing />
          </span>
        </div>

        {/* Held back until the mark has arrived. The name appearing beside a
            disc still in flight read as two things happening at once; waiting
            makes the movement the sentence and the name its full stop. On a
            re-lock there is no movement to wait for, so it simply rises. */}
        <div
          className="lock-anim"
          style={entrance
            ? { animation: `lock-fade ${TITLE_MS}ms ease-out both`, animationDelay: `${TITLE_DELAY_MS}ms` }
            : { animation: "lock-rise 400ms ease-out both" }}
        >
          <p className="text-2xl font-semibold tracking-wide">Contour</p>
          {/* Keyed on the text so each caption is a fresh node and fades in
              on its own; `min-h` holds the line's space, or the block below
              would step up and down as the words change. */}
          <p className="text-xs text-neutral-500 mt-1 min-h-4">
            <span
              key={state}
              className="lock-anim inline-block"
              style={{ animation: "lock-fade 260ms ease-out both" }}
            >
              {state === "prompting" ? "Waiting for your fingerprint…"
                : state === "checking" || state === "splash" ? "\u00a0"
                : "Locked"}
            </span>
          </p>
        </div>
      </div>

      {/*
        The one thing on this screen to touch, put where a thumb already is.

        It used to sit directly under the caption, in the middle of the screen
        — above the reader on a phone that has one under the glass, and above
        the reach of a thumb on a phone that reads from the back. The lower
        third is where both arguments point. Positioned against the overlay
        rather than stacked in the column, so the mark's resting place does not
        move when this appears.
      */}
      {!working && (
        <div
          className="lock-anim absolute inset-x-0 bottom-[18vh] z-10 flex flex-col items-center gap-3 px-8 text-center"
          style={{ animation: "lock-rise 400ms ease-out both" }}
        >
          <button
            onClick={onUnlock}
            aria-label="Unlock Contour"
            className="w-20 h-20 rounded-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white flex items-center justify-center transition-colors"
          >
            <Fingerprint size={32} aria-hidden />
          </button>
          <span className="text-xs text-neutral-500">Tap to unlock</span>
          {error && <p className="text-sm text-red-500 max-w-xs">{error}</p>}
        </div>
      )}
    </div>
  );
}
