import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { IMPORT_FORMATS } from "@/core/import-formats";

/**
 * Every screen that imports offers every format the importer can read.
 *
 * This is the drift that actually happened. `ImportSources` and the readers
 * behind it were built for the first-run flow, and grew from one format to
 * eight. `PortfolioManager` — the screen someone uses every time after the
 * first — kept its own pair of buttons, "Import Delta CSV" and "Restore
 * backup…", wired to its own hidden file inputs. Nothing failed: both screens
 * called the same `importCsv`, and the everyday one simply never mentioned
 * that Kraken, Coinbase, Trading 212, DEGIRO, Binance or the column mapper
 * existed. A person with a Kraken export would have concluded the app could
 * not read it.
 *
 * So the rule is about the *offer*, not the call: a component that imports
 * must present the shared grid, because that grid is the only thing that
 * enumerates the formats. A second hand-written list of sources is the bug,
 * and it is invisible to every other check in the repo.
 */
const ROOT = new URL("./", import.meta.url).pathname;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sources(full);
    if (!full.endsWith(".tsx")) return [];
    return [full];
  });
}

describe("import surfaces", () => {
  const files = sources(ROOT).map((f) => [f, readFileSync(f, "utf8")] as const);

  it("finds the components, so an empty walk cannot pass", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("routes every importing screen through the shared source grid", () => {
    const importing = files.filter(([f, src]) =>
      src.includes("importCsv") && !f.endsWith("ImportSources.tsx"));

    // Both of them: the first run and the portfolio-data screen.
    expect(importing.length).toBe(2);
    expect(importing.filter(([, src]) => !src.includes("<ImportSources")).map(([f]) => f))
      .toEqual([]);
  });

  it("keeps the grid the one place a format is named", () => {
    // A label re-typed into a screen is how the two lists start disagreeing —
    // one gains a format and the other keeps announcing the old set.
    const grid = readFileSync(join(ROOT, "ImportSources.tsx"), "utf8");
    const labels = IMPORT_FORMATS.map((f) => f.label);
    const offenders = files
      .filter(([f]) => !f.endsWith("ImportSources.tsx"))
      .filter(([, src]) => labels.some((label) => src.includes(`"${label}`)))
      .map(([f]) => f);
    expect(offenders).toEqual([]);
    // And the grid really does render them, rather than the guard above
    // passing because nothing anywhere names a format.
    expect(grid).toContain("IMPORT_FORMATS.map");
  });
});
