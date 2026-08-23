import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `packages/data` is where Phase 2's whole argument lives: everything in it
 * reaches the outside world through a `Store` and a `Net` and through nothing
 * else, so the same code answers an HTTP route today and a `DataClient` call
 * inside an APK in Phase 4.
 *
 * `packages/core/src/boundary.test.ts` already guards the *package* — no Node
 * builtins, no server-only dependencies, no global `fetch`. This guards the
 * *layer*, and the overlap is deliberate: the failure worth catching is not a
 * bundling error, it is a module quietly reaching for `prisma` or a `next/`
 * helper because the route it was extracted from used to. That import would
 * typecheck, pass every unit test with a `MemoryStore`, and only surface in
 * Phase 4 as a feature missing from the mobile build.
 *
 * The walk covers the whole of `packages/data/src`, not just `services/`.
 * While it stopped at that one directory there was a hole the two guards each
 * assumed the other closed: a new `sources/foo.ts` importing `@/lib/db` was
 * out of this walk's reach, and `boundary.test.ts` has no `@/lib` rule at all
 * — it cannot have one, because `packages/ui` legitimately imports `@/lib/*`,
 * so that rule has to stay scoped to this package. `sources/` is where the
 * hole mattered most: transport is precisely the code most tempted to cache a
 * result in the database.
 *
 * Each rule reports itself by name, because "a module broke the layer" is not
 * an actionable failure message and "imports @/lib/db (persistence must go
 * through the Store port)" is.
 */

const DATA_SRC = dirname(fileURLToPath(import.meta.url));

type Rule = {
  /** Named in the failure message, so the fix is obvious from the output. */
  name: string;
  broken: (src: string) => boolean;
};

const RULES: Rule[] = [
  {
    // Not just `@/lib/db`. `@/lib/*` is the ambiguous alias: under the root
    // tsconfig it resolves to `packages/core`, but under `apps/web`'s it is a
    // fallback array and reaches `apps/web/src/lib` too — where `db.ts`,
    // `auth.ts`, `webauthn.ts`, the notifiers and `equity-info.ts` live. A
    // service importing `@/lib/equity-info` — server-only, global `fetch`,
    // response headers, and the spec's one named exception, which makes it the
    // likeliest thing to be reached for by mistake — would slip past a rule
    // that only named `@/lib/db`, and past `boundary.test.ts`, which lists
    // neither.
    //
    // There is no allowlist, because nothing needs one: every portable module
    // a service uses is reachable as `@/core/*`, which is unambiguous. If some
    // future service genuinely needs an app-local module, that is the signal
    // to move the module, not to widen this rule.
    name: "imports @/lib/* (use the unambiguous @/core/* alias; app-local lib is server-only)",
    broken: (src) => imports(src, "@/lib"),
  },
  {
    name: "reaches Prisma (persistence must go through the Store port)",
    broken: (src) => imports(src, "@prisma/client") || /\bprisma\s*\./.test(src),
  },
  {
    name: "imports next/* (a service must not know it is being called by a route)",
    broken: (src) => imports(src, "next"),
  },
  {
    name: "calls global fetch (HTTP must go through the injected Net)",
    broken: usesGlobalFetch,
  },
];

/** Matches `from "m"`, `require("m")`, `import("m")` and `import "m"`, either
 *  quote style, with or without a subpath — the same four forms boundary.test.ts
 *  matches, for the same reason: catching only the ESM `from` waves three
 *  through. */
function imports(src: string, mod: string): boolean {
  const escaped = mod.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:\\bfrom\\s*|\\brequire\\(\\s*|\\bimport\\(\\s*|\\bimport\\s+)(['"])${escaped}(?:/[^'"]*)?\\1`,
  ).test(src);
}

/** The global, not `net.json(...)`: the lookbehind keeps member calls and
 *  `fetchKlines(` out, and the two usual global receivers are named. */
function usesGlobalFetch(src: string): boolean {
  return (
    /(?<![.\w$])fetch\s*\(/.test(src) ||
    /\b(?:globalThis|window|self)\s*\.\s*fetch\s*\(/.test(src)
  );
}

/**
 * Rules run against code, not prose. `transactions.ts` explains in a comment
 * why it no longer calls `prisma.portfolio.findUnique`, and a guard that
 * punishes a file for *documenting* the thing it stopped doing would be
 * rewritten into uselessness within a week. Block comments and line comments
 * go; the `:` guard leaves the `//` of a URL inside a string alone.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/.*$/gm, "");
}

/** Every non-test `.ts` under `packages/data/src`, at any depth. */
function dataFiles(dir: string = DATA_SRC): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return dataFiles(full);
    if (!full.endsWith(".ts") || full.endsWith(".test.ts")) return [];
    return [full];
  });
}

describe("packages/data takes a Store and a Net, and reaches nothing else", () => {
  it("every module obeys every layer rule", () => {
    const files = dataFiles();
    // A directory read that returned nothing would pass this vacuously. The
    // floor sits well below the current count (19) so it trips on a broken
    // walk, not on someone adding or removing a module.
    expect(files.length).toBeGreaterThan(12);

    const offenders: string[] = [];
    for (const file of files) {
      const src = stripComments(readFileSync(file, "utf8"));
      for (const rule of RULES) {
        if (rule.broken(src)) offenders.push(`${file.replace(process.cwd() + "/", "")}: ${rule.name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
