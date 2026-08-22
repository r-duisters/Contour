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
  "crypto",
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

describe("packages/core stays portable", () => {
  it("imports nothing that only exists on a server", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(process.cwd(), "packages/core/src"))) {
      const src = readFileSync(file, "utf8");
      for (const mod of FORBIDDEN) {
        if (src.includes(`from "${mod}"`) || src.includes(`from "${mod}/`)) {
          offenders.push(`${file.replace(process.cwd() + "/", "")} -> ${mod}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
