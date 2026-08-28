import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");

/**
 * The mobile app shipped an APK with no styling in it.
 *
 * `apps/mobile` was created without a `postcss.config.mjs`, so
 * `@tailwindcss/postcss` never ran and `@import "tailwindcss"` in globals.css
 * stayed an inert CSS import. The stylesheet came out at 4 KB with not one
 * utility class in it, and the app rendered as blue underlined links on a
 * black page — on a handset, not before.
 *
 * Nothing caught it. The build succeeded, all 814 tests passed, typecheck and
 * lint were clean, and the export contained a stylesheet that was merely
 * empty. This is the check that would have.
 */
describe("the mobile app's build configuration", () => {
  it("has a PostCSS config, without which Tailwind silently emits nothing", () => {
    const path = join(ROOT, "postcss.config.mjs");
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toContain("@tailwindcss/postcss");
  });

  it("declares the same PostCSS plugins as the web app", () => {
    // The two stylesheets are built from the same globals.css and the same
    // packages/ui sources; a difference here means one of them is wrong.
    const plugins = (app: string) => {
      const raw = readFileSync(join(ROOT, "..", app, "postcss.config.mjs"), "utf8");
      return [...raw.matchAll(/"([^"]+)":\s*\{\}/g)].map((m) => m[1]).sort();
    };
    expect(plugins("mobile")).toEqual(plugins("web"));
  });
});
