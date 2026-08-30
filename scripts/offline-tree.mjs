#!/usr/bin/env node
/**
 * What an offline-only repository would contain.
 *
 * The standalone Android build is a strict subset of this repository, and the
 * subset is worth knowing exactly.
 *
 * This was written to answer a licence question — whether a public repo would
 * carry a port believed to be someone else's work. That belief was wrong (see
 * NOTICE, and decision 1 in docs/carried-forward.md, both corrected
 * 2026-08-30), so nothing here is load-bearing for licensing any more.
 *
 * What it still checks is an architectural boundary worth keeping: the device
 * build answers every screen from its own database and reaches none of the
 * strategy tooling. 1,460 daily bars of warm-up is not work for a phone, and
 * an import that quietly dragged the indicator into the mobile bundle would
 * be a regression whether or not anybody could relicense it.
 *
 * This walks the real import graph from `apps/mobile/src` rather than guessing
 * from directory names, so the answer stays true as the code moves. It prints
 * a manifest and refuses — loudly — if anything Pine-derived is reachable.
 *
 * It deliberately does not write anything. Deciding to split the repository is
 * a decision for a person; this exists so that decision is made against a real
 * file list rather than an impression.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const ROOT = process.cwd();
const ALIASES = [
  ["@/core/", "packages/core/src/"],
  ["@/data/", "packages/data/src/"],
  ["@/ui/", "packages/ui/src/"],
  ["@/lib/", "packages/core/src/"],
  ["@/components/", "packages/ui/src/"],
];

function resolveSpec(spec, from) {
  let base = null;
  for (const [alias, dir] of ALIASES) {
    if (spec.startsWith(alias)) { base = join(ROOT, dir, spec.slice(alias.length)); break; }
  }
  if (!base && spec.startsWith(".")) base = resolve(dirname(from), spec);
  if (!base) return null;
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx", ""]) {
    try { if (statSync(base + ext).isFile()) return base + ext; } catch { /* next */ }
  }
  return null;
}

const reached = new Set();
function walk(file) {
  if (reached.has(file)) return;
  reached.add(file);
  let src;
  try { src = readFileSync(file, "utf8"); } catch { return; }
  for (const m of src.matchAll(/from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
    const r = resolveSpec(m[1] || m[2], file);
    if (r) walk(r);
  }
}

function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p) ? [p] : [];
  });
}

sources(join(ROOT, "apps/mobile/src")).forEach(walk);

/** Non-source files the build needs, which no import can reveal. */
const CARRIED = [
  "apps/mobile/public", "apps/mobile/next.config.ts", "apps/mobile/package.json",
  "apps/mobile/postcss.config.mjs", "apps/mobile/tsconfig.json",
  "android", "capacitor.config.ts", "scripts/bundle-icons.mjs", "scripts/icon-tickers.json",
  "package.json", "tsconfig.base.json", "tsconfig.json", "vitest.config.ts",
  "eslint.config.mjs", "LICENSE", "NOTICE", "BRAND.md",
];

const rel = [...reached].map((f) => f.replace(ROOT + "/", "")).sort();
const bytes = rel.reduce((n, f) => n + statSync(join(ROOT, f)).size, 0);

const byPackage = {};
for (const f of rel) {
  const key = f.split("/").slice(0, 3).join("/");
  byPackage[key] = (byPackage[key] ?? 0) + 1;
}

/*
 * `packages/core` holds the risk metric alongside the portfolio maths, and
 * only the portfolio maths belongs on a phone. This is the assertion that the
 * two have not become entangled.
 */
const PINE = rel.filter((f) => /indicator|pinescript|backtest/.test(f));

console.log("An offline-only repository would contain:\n");
for (const [k, n] of Object.entries(byPackage).sort()) console.log(`  ${String(n).padStart(4)}  ${k}`);
console.log(`  ${String(rel.length).padStart(4)}  source files, ${(bytes / 1024).toFixed(0)} KB`);
console.log(`\n  plus, carried whole: ${CARRIED.join(", ")}`);

const all = new Set(sources(join(ROOT, "packages")).map((f) => f.replace(ROOT + "/", "")));
const dropped = [...all].filter((f) => !rel.includes(f)).sort();
console.log(`\nLeft behind from packages/: ${dropped.length} files`);
for (const f of dropped.slice(0, 12)) console.log(`    ${f}`);
if (dropped.length > 12) console.log(`    … and ${dropped.length - 12} more`);

console.log(`\nPineScript-derived files reachable: ${PINE.length}`);
if (PINE.length > 0) {
  console.log("  " + PINE.join("\n  "));
  console.log("\nREFUSED: the device build now reaches the strategy tooling.");
  process.exit(1);
}
console.log("  none — the device build stays clear of the strategy tooling.");
