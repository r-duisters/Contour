"use client";

import { useSyncExternalStore } from "react";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/**
 * When an alert check last ran, said plainly.
 *
 * This component is the point of the alerts work. The failure being designed
 * against is not a missed notification — it is a month of silence that reads
 * as "nothing triggered". A person cannot tell those apart, and until this
 * line existed the app offered them no way to.
 *
 * Amber past a day, per `BRAND.md`'s rule that amber means degraded data. A
 * day is the right threshold because opening the app runs a check: a mark
 * older than that means the checks themselves are failing, not that nothing
 * happened to report.
 */
export function describeLastChecked(at: number | null, now: number): {
  text: string;
  stale: boolean;
} {
  if (at === null) return { text: "Not checked yet", stale: true };

  const ago = now - at;
  if (ago >= DAY) {
    const days = Math.floor(ago / DAY);
    return {
      text: days === 1 ? "Not checked since yesterday" : `Not checked for ${days} days`,
      stale: true,
    };
  }
  if (ago >= HOUR) {
    const hours = Math.floor(ago / HOUR);
    return { text: `Last checked ${hours} ${hours === 1 ? "hour" : "hours"} ago`, stale: false };
  }
  if (ago >= MINUTE) {
    const minutes = Math.floor(ago / MINUTE);
    return { text: `Last checked ${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`, stale: false };
  }
  return { text: "Last checked just now", stale: false };
}

/**
 * The current time, as a value a component may read during render.
 *
 * `Date.now()` in render is impure and the React Compiler rejects it, which is
 * the right call: a render that reads the clock is a render that can disagree
 * with itself. Subscribing makes the reading explicit and has a second effect
 * worth having — the line re-renders as time passes, so a screen left open
 * does not keep insisting the check was a minute ago.
 *
 * The snapshot is bucketed to the interval so it is stable between ticks;
 * returning a fresh `Date.now()` on every call would loop forever. Zero on the
 * server, where there is no clock worth reading and the caller draws nothing.
 */
function useNow(intervalMs = MINUTE): number {
  const bucket = useSyncExternalStore(
    (onChange) => {
      const id = setInterval(onChange, intervalMs);
      return () => clearInterval(id);
    },
    () => Math.floor(Date.now() / intervalMs),
    () => 0,
  );
  return bucket * intervalMs;
}

export default function LastChecked({ at }: { at: number | null }) {
  const now = useNow();
  // Pre-hydration there is no clock, and a relative time without one would be
  // a guess. One frame of nothing beats one frame of "just now".
  if (now === 0) return null;
  const { text, stale } = describeLastChecked(at, now);
  return (
    <p className={`text-xs ${stale ? "text-amber-500" : "text-neutral-500"}`}>
      {text}
      {". "}
      {/*
        No interval appears here, because none can be kept. Android wakes a
        background job when it chooses to; the only schedule this app controls
        is the one the person themselves sets by opening it.
      */}
      <span className="text-neutral-500">
        Checked every time you open the app, and sometimes in the background when Android
        allows. A target hit and reverted overnight can be missed.
      </span>
    </p>
  );
}
