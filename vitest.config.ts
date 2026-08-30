import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Only the unambiguous aliases are here. `@/lib/*` and `@/components/*` resolve
 * through a tsconfig fallback array (package first, app second), which Vite's
 * alias map cannot express — so tests reach those through relative paths and
 * the ambiguity stays where it already is rather than spreading into the
 * runner.
 */
export default defineConfig({
  test: {
    /*
     * Vitest's defaults exclude `node_modules` and `dist`, not `.next`.
     *
     * That was harmless until the Docker image needed `output: "standalone"`,
     * which copies `apps/web/src` — test files and all — into
     * `apps/web/.next/standalone/`. The runner then collected every suite
     * twice: once from source and once from a copy whose relative imports
     * resolve to nothing. Nine files failed to load while every test that did
     * load passed, which is a confusing shape of red.
     *
     * Excluded by path rather than fixed in the build, because a build output
     * that mirrors the source tree is normal and the runner should not be
     * looking in build output at all.
     */
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/out/**",
      "**/android/app/build/**",
    ],
  },
  resolve: {
    alias: {
      "@/data": r("./packages/data/src"),
      "@/core": r("./packages/core/src"),
      "@/ui": r("./packages/ui/src"),
    },
  },
});
