"use client";

/**
 * "These numbers are from a moment ago." Written once, because three screens
 * say it and `BRAND.md` requires that showing cached values comes with
 * saying they are stale.
 *
 * Renders nothing when `at` is null, so a caller can mount it unconditionally
 * and let the freshness of the data decide.
 */
export default function StaleNote({ at }: { at: number | null }) {
  if (at === null) return null;
  return (
    <p className="text-xs text-neutral-500 mb-3">
      Showing values from {new Date(at).toLocaleTimeString()} while refreshing…
    </p>
  );
}
