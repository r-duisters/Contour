import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `packages/core` and `packages/ui` are both bundled into an Android APK that
 * has no server behind it (spec §3). Anything importing a Node builtin or a
 * server-only package cannot go there, and finding out at bundle time in
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

const PORTABLE_PACKAGES = ["packages/core/src", "packages/ui/src"];

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

describe("packages/core and packages/ui stay portable", () => {
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
    // under the current combined count (44 in core, 18 in ui) so it only
    // trips if the walk itself breaks, not as a file-count tripwire.
    expect(scanned).toBeGreaterThan(30);
    expect(offenders).toEqual([]);
  });
});
