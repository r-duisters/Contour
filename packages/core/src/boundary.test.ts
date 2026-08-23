import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `packages/core`, `packages/ui` and `packages/data` are all bundled into an
 * Android APK that has no server behind it (spec §3). Anything importing a
 * Node builtin or a server-only package cannot go there, and finding out at bundle time in
 * Phase 4 is far more expensive than finding out here. Tests are exempt: they
 * run under Node by definition.
 */
const FORBIDDEN = [
  "@prisma/client",
  "@simplewebauthn/server",
  "web-push",
  "ws",
  "node:fs",
  "node:path",
  "node:crypto",
  "node:os",
  "node:child_process",
  "crypto",
  "fs",
  "path",
  "os",
  "child_process",
  "next/server",
  "next/headers",
  "next/cache",
  "server-only",
  "http",
  "https",
  "stream",
  "buffer",
];

const PORTABLE_PACKAGES = ["packages/core/src", "packages/ui/src", "packages/data/src"];

/**
 * Packages that must reach the network only through an injected `Net`. Global
 * `fetch` is not a bundling failure the way `node:fs` is — it exists on a
 * device — but it is a portability failure: a native WebView request is subject
 * to CORS, which is why `Net` exists at all (spec §4.2).
 *
 * `packages/core` joined with no exemption once its transport moved out: what
 * was portable went to `packages/data/src/sources/`, and the one piece that
 * could not — Yahoo's cookie-and-crumb handshake, which `Net` has no response
 * headers to express — went to `apps/web/src/lib/equity-info.ts`, outside every
 * package this guard covers. Core is now pure.
 *
 * `packages/ui` joined in Phase 3, once `SymbolPicker`, `AssetInfoPanel` and
 * `PortfolioManager` — the last three direct callers — started taking a
 * `DataClient` from context instead. It is the package with the most to lose
 * from a relapse: every screen the APK renders comes from here, and a `fetch`
 * that works in a browser is a blank panel on a device with nothing to say why.
 */
const NET_ONLY_PACKAGES = ["packages/data/src", "packages/core/src", "packages/ui/src"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!full.endsWith(".ts") && !full.endsWith(".tsx")) return [];
    if (full.endsWith(".test.ts") || full.endsWith(".test.tsx")) return [];
    return [full];
  });
}

// A module can be pulled in via a static `from`, a CommonJS `require(...)`, a
// dynamic `import(...)`, or a bare side-effect `import "mod"` — and any of
// those can use either quote style and an optional subpath (e.g.
// "fs/promises"). Matching only the ESM `from` form would wave through the
// other three straight into a Phase 4 bundle failure.
function isForbiddenImport(src: string, mod: string): boolean {
  const escaped = mod.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(?:\\bfrom\\s*|\\brequire\\(\\s*|\\bimport\\(\\s*|\\bimport\\s+)(['"])${escaped}(?:/[^'"]*)?\\1`
  );
  return pattern.test(src);
}

/**
 * A call to the global, as opposed to `net.json(...)`. The negative lookbehind
 * for `.` separates the two and keeps `fetchKlines(` / `prefetch(` out of it —
 * except that `globalThis.fetch(` and `window.fetch(` are the global reached
 * through a member access, so those two receivers are named explicitly.
 */
function usesGlobalFetch(src: string): boolean {
  return /(?<![.\w$])fetch\s*\(/.test(src) || /\b(?:globalThis|window|self)\s*\.\s*fetch\s*\(/.test(src);
}

/**
 * Rules run against code, not prose — the same treatment `layer.test.ts` gives
 * its own walk, and for the same reason.
 *
 * A file that *documents* what it deliberately no longer does is the most
 * likely place for these patterns to appear in prose. `client/data-client.ts`
 * opens by explaining that thirty-six direct `fetch` calls are what it exists
 * to replace, and that sentence failed this guard. A guard that punishes
 * accurate documentation gets its wording sanded down until it says nothing,
 * which is a slower way of deleting it.
 *
 * The `:` guard leaves the `//` inside a URL string alone.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/.*$/gm, "");
}

describe("packages/core, packages/ui and packages/data stay portable", () => {
  it("imports nothing that only exists on a server", () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const pkg of PORTABLE_PACKAGES) {
      const files = sourceFiles(join(process.cwd(), pkg));
      scanned += files.length;
      for (const file of files) {
        const src = stripComments(readFileSync(file, "utf8"));
        for (const mod of FORBIDDEN) {
          if (isForbiddenImport(src, mod)) {
            offenders.push(`[${pkg}] ${file.replace(process.cwd() + "/", "")} -> ${mod}`);
          }
        }
      }
    }
    // A walk that silently returns zero files would make this test pass
    // vacuously — a guard that can't fail isn't a guard. The floor is well
    // under the current combined count (25 in core, 18 in ui, 19 in data) so it
    // only trips if the walk itself breaks, not as a file-count tripwire.
    expect(scanned).toBeGreaterThan(30);
    expect(offenders).toEqual([]);
  });

  it("reaches the network only through an injected Net", () => {
    const offenders: string[] = [];
    for (const pkg of NET_ONLY_PACKAGES) {
      for (const file of sourceFiles(join(process.cwd(), pkg))) {
        const src = stripComments(readFileSync(file, "utf8"));
        if (usesGlobalFetch(src)) {
          offenders.push(`[${pkg}] ${file.replace(process.cwd() + "/", "")} -> global fetch`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * A package whose walk returns nothing is silently exempt from both rules
   * above, and the import rule's combined floor cannot see it: the other two
   * packages carry the count on their own. That is how a guard stops guarding
   * without anyone noticing, and both lists now name three packages. Each has
   * to contribute files of its own.
   */
  it("actually reads every package it names", () => {
    const empty = [...new Set([...PORTABLE_PACKAGES, ...NET_ONLY_PACKAGES])]
      .map((pkg) => [pkg, sourceFiles(join(process.cwd(), pkg)).length] as const)
      .filter(([, count]) => count < 4);
    expect(empty).toEqual([]);
  });

  /**
   * The guard on the guard. Stripping comments is what lets a module describe
   * the thing it stopped doing, and the cost of getting it wrong is a rule that
   * silently stops finding anything. Both directions are pinned: prose is
   * ignored, code is not.
   */
  it("reads code and ignores prose", () => {
    const prose = `// this module no longer calls fetch("/api/x")\n/** and never imports "node:fs" */\n`;
    expect(usesGlobalFetch(stripComments(prose))).toBe(false);
    expect(isForbiddenImport(stripComments(prose), "node:fs")).toBe(false);

    const code = `import { readFileSync } from "node:fs";\nconst r = await fetch(url);\n`;
    expect(usesGlobalFetch(stripComments(code))).toBe(true);
    expect(isForbiddenImport(stripComments(code), "node:fs")).toBe(true);

    // A URL inside a string is not a line comment.
    expect(stripComments(`const u = "https://example.com/x";`)).toContain("example.com/x");
  });
});
