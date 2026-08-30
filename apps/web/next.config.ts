import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { NextConfig } from "next";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * `standalone` only when asked for, because it changes what `npm run start`
 * means.
 *
 * The Docker image wants a self-contained server directory it can copy without
 * `node_modules`. Everything else — `npm run dev`, `npm run start`, the systemd
 * unit in the README — wants the ordinary build. Making it conditional keeps
 * both true instead of migrating every reader to a new command for the benefit
 * of one deployment.
 *
 * `outputFileTracingRoot` is the repository root rather than `apps/web`, and it
 * is load-bearing twice. Next traces dependencies from it, and in a workspace
 * the shared packages live above the app — without it they are simply missing
 * from the output. It also decides the *shape* of the standalone tree: rooted
 * here, the copy keeps `apps/web/` under a directory holding the root
 * `package.json`, which is exactly what `lib/repo-root.ts` climbs to find. Set
 * it to `apps/web` and that walk finds no manifest with a `workspaces` field
 * and throws at startup — which is the failure that file's comment predicts,
 * and prefers to a silent wrong answer.
 */
const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.2.5"],
  ...(process.env.CONTOUR_STANDALONE ? { output: "standalone" as const } : {}),
  outputFileTracingRoot: repoRoot,
};

export default nextConfig;
