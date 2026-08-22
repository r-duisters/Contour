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
 *
 * This throws instead of falling back to `process.cwd()` on purpose. A wrong
 * guess here doesn't crash anything downstream — it just makes `/api/scripts`
 * return an empty list, the APK link 404, and the icon cache stay cold, all
 * silently. Today `import.meta.url` resolves against the project root under
 * Turbopack, but that stops being true the moment `.next` is copied away from
 * the repo (`output: "standalone"`, a Docker `COPY`, a set
 * `outputFileTracingRoot`). A thrown error at startup is diagnosable; a wrong
 * path that quietly produces empty results is not.
 */
function findRepoRoot(): string {
  const start = dirname(fileURLToPath(import.meta.url));
  let dir = start;
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
  throw new Error(
    `findRepoRoot: no ancestor package.json with a "workspaces" field found ` +
      `walking up from ${start} to ${dir}. This module locates the repo root ` +
      `by climbing from its own compiled location, which assumes the bundle ` +
      `stays under the repository tree; if the server root has been copied ` +
      `away from the source repo (standalone output, Docker COPY, ` +
      `outputFileTracingRoot), point it back at the repo or adjust this walk.`,
  );
}

export const REPO_ROOT = findRepoRoot();

/** Join a path that is relative to the repository root, not to the web app. */
export function fromRepoRoot(...parts: string[]): string {
  return join(REPO_ROOT, ...parts);
}
