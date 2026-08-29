import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `BRAND.md`: "a new local copy is a bug, not a variation."
 *
 * That rule was written for `StatTile` and `RangePicker` and enforced by
 * nothing, so the primary button reached thirteen copies in six spellings and
 * the form field reached nine before an audit counted them. Six of the
 * thirteen dimmed when disabled and seven did not — a behavioural difference
 * that grew purely out of which line each was copied from.
 *
 * Prose cannot catch the fourteenth. This can.
 */

/** Files allowed to spell a shared unit, and why each is not a copy. */
const ALLOWED = {
  "bg-blue-600": [
    // The component that defines the primary action.
    "packages/ui/src/Button.tsx",
    // The circular unlock button: `BRAND.md` documents circular icon buttons
    // as their own shape, with a hover state the flat button does not have.
    "packages/ui/src/BiometricLock.tsx",
    // The mark's tile (Direction A, #49): the blue surface the white ring and
    // rise sit on. It is the brand colour as a container, not as a button.
    // `MarkTile` is where new call sites get it; the four below predate it and
    // each still spells its own radius. Folding them in is worth doing and is
    // not this change.
    "packages/ui/src/MarkTile.tsx",
    "packages/ui/src/TopNav.tsx",
    "apps/web/src/app/login/page.tsx",
    "apps/web/src/app/setup/page.tsx",
    // The on/off switch. `BRAND.md` gives the accent to the on state, and this
    // is a track rather than a button: no padding, no radius of its own, no
    // disabled dimming. Rendering it as a `Button` would mean overriding every
    // one of those, which is how a "reuse" becomes a fourteenth copy.
    "packages/ui/src/Switch.tsx",
  ],
  "bg-neutral-700": [
    "packages/ui/src/Button.tsx",
    // The same switch, off. Its two states are one control and belong in one
    // file; splitting them to satisfy this list would be the tail wagging.
    "packages/ui/src/Switch.tsx",
  ],
  "bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm": [
    "packages/ui/src/field.ts",
  ],
  // The pill row. Two controls share the shell and diverge in behaviour:
  // `RangePicker` collapses its extra timeframes behind "More" on a phone,
  // which is right for eight periods and wrong for a two-way category switch.
  // Both are allowed to spell the shell; a third copy is a component waiting
  // to be extracted.
  "bg-neutral-900/50 border border-neutral-800/50": [
    "packages/ui/src/RangePicker.tsx",
    "packages/ui/src/Segmented.tsx",
  ],
  // The sub-heading tier. Narrower than it looks: the ledger's row labels are
  // `text-neutral-400` and the analyzer's severity line has no weight or
  // colour of its own, so neither is caught here — they are labels on a
  // figure, not headings over a group.
  "text-xs font-semibold uppercase tracking-wide text-neutral-500": [
    "packages/ui/src/SubHeading.tsx",
  ],
};

const ROOTS = ["packages/ui/src", "apps/web/src"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!full.endsWith(".ts") && !full.endsWith(".tsx")) return [];
    if (full.endsWith(".test.ts") || full.endsWith(".test.tsx")) return [];
    return [full];
  });
}

describe("shared units are not re-typed", () => {
  const files = ROOTS.flatMap(sourceFiles);

  it("scans a plausible number of files", () => {
    // Guards the guard: a walker that silently found nothing would pass every
    // assertion below.
    expect(files.length).toBeGreaterThan(30);
  });

  for (const [needle, allowed] of Object.entries(ALLOWED)) {
    it(`only ${allowed.join(" and ")} spells "${needle.slice(0, 40)}…"`, () => {
      const offenders = files.filter(
        (f) => readFileSync(f, "utf8").includes(needle) && !allowed.includes(f),
      );
      expect(offenders, `use the shared unit instead of re-typing it`).toEqual([]);
    });
  }

  /**
   * Spellings the guide rules out, wherever they appear.
   *
   * Different from `ALLOWED` above, which asks *who* may write a shared unit.
   * These are not shared units at all — they are near-misses of documented
   * values, and the guide already forbade both in prose. The Markets screen
   * shipped with four `text-[10px]` labels and two `text-emerald-500` gains
   * anyway, because prose does not fail a build.
   */
  const BANNED: [string, string][] = [
    ["text-[10px]", "BRAND.md: nothing below 11px — a 10px control fails at arm's length on a 390px phone"],
    ["text-[9px]", "BRAND.md: nothing below 11px"],
    ["text-emerald-", "BRAND.md: gain is text-green-500 (#22c55e); emerald is a second, near-identical green"],
    ["text-rose-", "BRAND.md: loss is text-red-500 (#ef4444)"],
  ];

  for (const [needle, why] of BANNED) {
    it(`never spells "${needle}"`, () => {
      const offenders = files.filter((f) => readFileSync(f, "utf8").includes(needle));
      expect(offenders, why).toEqual([]);
    });
  }

  it("every allowed file actually contains what it is allowed to spell", () => {
    // An entry left behind after a refactor is a hole in the guard, not a
    // harmless leftover: it would permit a fresh copy in that same file.
    const stale = Object.entries(ALLOWED).flatMap(([needle, allowed]) =>
      allowed.filter((f) => !readFileSync(f, "utf8").includes(needle)).map((f) => `${f} :: ${needle}`),
    );
    expect(stale).toEqual([]);
  });
});
