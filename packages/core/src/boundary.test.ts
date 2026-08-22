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
 * Only `packages/data` is listed. `packages/core` still calls `fetch` directly
 * in binance.ts, equity.ts, fx.ts and asset-info.ts, and `packages/ui` does in
 * three components; those move behind `Net` later in Phase 2, and each should
 * join this list as it does. Listing them now would fail the suite on work that
 * has not happened yet, which teaches everyone to ignore it.
 */
const NET_ONLY_PACKAGES = ["packages/data/src"];

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

describe("packages/core, packages/ui and packages/data stay portable", () => {
  it("imports nothing that only exists on a server", () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const pkg of PORTABLE_PACKAGES) {
      const files = sourceFiles(join(process.cwd(), pkg));
      scanned += files.length;
      for (const file of files) {
        const src = readFileSync(file, "utf8");
        for (const mod of FORBIDDEN) {
          if (isForbiddenImport(src, mod)) {
            offenders.push(`[${pkg}] ${file.replace(process.cwd() + "/", "")} -> ${mod}`);
          }
        }
      }
    }
    // A walk that silently returns zero files would make this test pass
    // vacuously — a guard that can't fail isn't a guard. The floor is well
    // under the current combined count (26 in core, 18 in ui, 6 in data) so it
    // only trips if the walk itself breaks, not as a file-count tripwire.
    expect(scanned).toBeGreaterThan(30);
    expect(offenders).toEqual([]);
  });

  it("reaches the network only through an injected Net", () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const pkg of NET_ONLY_PACKAGES) {
      const files = sourceFiles(join(process.cwd(), pkg));
      scanned += files.length;
      for (const file of files) {
        const src = readFileSync(file, "utf8");
        if (usesGlobalFetch(src)) {
          offenders.push(`[${pkg}] ${file.replace(process.cwd() + "/", "")} -> global fetch`);
        }
      }
    }
    expect(scanned).toBeGreaterThan(3);
    expect(offenders).toEqual([]);
  });
});
