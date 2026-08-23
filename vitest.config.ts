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
  resolve: {
    alias: {
      "@/data": r("./packages/data/src"),
      "@/core": r("./packages/core/src"),
      "@/ui": r("./packages/ui/src"),
    },
  },
});
