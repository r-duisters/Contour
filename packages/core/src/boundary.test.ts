import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `packages/core` is bundled into an Android APK that has no server behind
 * it. Anything importing a Node builtin or a server-only package cannot go
 * there, and finding out at bundle time in Phase 4 is far more expensive than
 * finding out here. Tests are exempt: they run under Node by definition.
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
];

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

describe("packages/core stays portable", () => {
  it("imports nothing that only exists on a server", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(process.cwd(), "packages/core/src"))) {
      const src = readFileSync(file, "utf8");
      for (const mod of FORBIDDEN) {
        if (isForbiddenImport(src, mod)) {
          offenders.push(`${file.replace(process.cwd() + "/", "")} -> ${mod}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
