import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The repository root, found by walking up from this module rather than from
 * `process.cwd()`. Several things the web app reads are deliberately
 * repository-level and did not move into `apps/web`: `samples/` is shared with
 * the future mobile build, `android/` is the Capacitor shell, `.icon-cache/` is
 * warmed state older than the move. The server's cwd is `apps/web`, so
 * cwd-relative paths silently miss all of them — and miss them quietly, with an
 * empty list or a 404 rather than a crash.
 *
 * The marker is the workspaces declaration, which only the root manifest has,
 * so this stays correct wherever the bundler places the compiled chunk.
 */
function findRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let up = 0; up < 12; up++) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      try {
        if ("workspaces" in JSON.parse(readFileSync(manifest, "utf8"))) return dir;
      } catch {
        // An unreadable manifest is not the root; keep climbing.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Nothing found: fall back to cwd so a failure surfaces as a plain ENOENT
  // naming a path, rather than as silently empty results.
  return process.cwd();
}

export const REPO_ROOT = findRepoRoot();

/** Join a path that is relative to the repository root, not to the web app. */
export function fromRepoRoot(...parts: string[]): string {
  return join(REPO_ROOT, ...parts);
}
