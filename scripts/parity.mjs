#!/usr/bin/env node
/**
 * Behaviour-parity harness.
 *
 *   node scripts/parity.mjs capture <file> <path...>   GET each path, save the bodies
 *   node scripts/parity.mjs compare <file>             re-GET each, diff against the saved bodies
 *
 * Every conversion in Phase 2 claims to change no behaviour. This is what turns
 * that claim into something checkable: capture once against the code you trust,
 * convert, compare. A non-zero exit means a route's response moved.
 *
 * Base URL defaults to http://localhost:3001; override with PARITY_BASE_URL.
 * `compare` uses the base URL recorded in the file unless PARITY_BASE_URL is
 * set, so a baseline can never be silently compared against a different server.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SignJWT } from "jose";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BASE = "http://localhost:3001";
const SESSION_COOKIE = "trader_session";
const PLACEHOLDER = "<parity:ignored>";

/**
 * Which leaves are allowed to move, addressed by their **full path** in the
 * body — `series[].value`, not `value`. An earlier version matched by key name
 * at any depth, which blanked all 365 points of `/series` and every holding's
 * `value` in `/valuation`: 33KB of captured output that compared only its
 * timestamps, in exactly the two routes Tasks 4 and 5 convert.
 *
 * Two modes:
 *
 *   `rel`    — compared with a relative tolerance. Live prices drift between
 *              capture and compare, but a structural change (a wrong day, a
 *              currency swap, a lost fee, an off-by-one in a sum) misses by far
 *              more than the drift. Preferred wherever a stable bound exists.
 *   `ignore` — blanked. Only where no honest bound exists: clock readings, and
 *              day-change figures whose denominator is small enough that live
 *              drift reaches tens of percent.
 *
 * Segments: object keys joined by `.`, arrays collapsed to `[]`, `*` matching
 * any single key. Anything without a rule is compared byte for byte — an
 * unknown field is checked, never waved through.
 *
 * The tolerances are measured, not guessed: with the current build running,
 * back-to-back captures move `series[].value` by 0.05%, `holdings[].price` by
 * 0.9%, and `holdings[].dayChange` by 44%.
 */
const RULES = [
  // clock readings, and windows the server derives from "now"
  { path: "exportedAt", ignore: true },
  { path: "generatedAt", ignore: true },
  { path: "asOf", ignore: true },
  { path: "fetchedAt", ignore: true },
  { path: "windowFrom", ignore: true },
  { path: "windowTo", ignore: true },

  // day-change: a one-day delta over a small base, so live drift swamps it
  { path: "holdings[].dayChange.abs", ignore: true },
  { path: "holdings[].dayChange.pct", ignore: true },
  { path: "totals.dayChange.abs", ignore: true },
  { path: "totals.dayChange.pct", ignore: true },
  { path: "changes.*", ignore: true },

  // live prices, and the sums built from them
  { path: "holdings[].price", rel: 0.02 },
  { path: "holdings[].value", rel: 0.02 },
  { path: "holdings[].unrealizedPnl", rel: 0.05 },
  { path: "totals.value", rel: 0.02 },
  { path: "totals.invested", rel: 0.02 },
  { path: "totals.unrealizedPnl", rel: 0.05 },

  // portfolio series: only the final, live-priced bar actually moves
  { path: "series[].value", rel: 0.01 },
  { path: "change.abs", rel: 0.05 },
  { path: "change.pct", rel: 0.05 },
  { path: "twr.points[].index", rel: 0.01 },
  { path: "twr.totalPct", rel: 0.05 },
  { path: "mwr.annualPct", rel: 0.05 },
  { path: "mwr.closing", rel: 0.01 },

  // price history and benchmarks: likewise only today's bar
  { path: "bars[].c", rel: 0.01 },
  { path: "changePct", rel: 0.05 },
  { path: "points[].index", rel: 0.01 },
  { path: "sameFlows.finalValue", rel: 0.01 },
  { path: "sameFlows.series[].value", rel: 0.01 },
];

function ruleFor(path) {
  return RULES.find((r) => matches(r.path, path));
}

function matches(pattern, path) {
  const p = pattern.split(".");
  const q = path.split(".");
  if (p.length !== q.length) return false;
  return p.every((seg, i) => seg === "*" || seg === q[i] || (seg.endsWith("[]") && seg.slice(0, -2) === "*"));
}

function announceRules() {
  console.log("Fields allowed to differ (everything else is compared byte for byte):");
  for (const r of RULES) {
    console.log(`  ${r.ignore ? "ignored  " : `±${(r.rel * 100).toFixed(0).padStart(3)}%   `} ${r.path}`);
  }
  console.log("");
}

/**
 * Produce the pair of strings to diff. Ignored leaves are blanked in both
 * sides; a leaf within its relative tolerance is snapped to the baseline's
 * value so it does not clutter the diff — and counted, so the run says out loud
 * how much it waved through.
 */
function reconcile(before, after) {
  const stats = { ignored: 0, withinTolerance: 0 };

  function walk(a, b, path) {
    const rule = ruleFor(path);
    if (rule?.ignore) {
      stats.ignored++;
      return [PLACEHOLDER, PLACEHOLDER];
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      const n = Math.max(a.length, b.length);
      const outA = [];
      const outB = [];
      for (let i = 0; i < n; i++) {
        const [x, y] = walk(a[i], b[i], `${path}[]`);
        outA.push(x);
        outB.push(y);
      }
      return [outA, outB];
    }
    if (a && b && typeof a === "object" && typeof b === "object") {
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
      const outA = {};
      const outB = {};
      for (const k of keys) {
        const [x, y] = walk(a[k], b[k], path ? `${path}.${k}` : k);
        outA[k] = x;
        outB[k] = y;
      }
      return [outA, outB];
    }
    if (rule?.rel !== undefined && typeof a === "number" && typeof b === "number") {
      const scale = Math.max(Math.abs(a), Math.abs(b));
      // An exact zero on both sides is already equal; a zero on one side only
      // has no relative scale, so it must be reported rather than absorbed.
      if (scale === 0 || Math.abs(b - a) / scale <= rule.rel) {
        if (a !== b) stats.withinTolerance++;
        return [a, a];
      }
    }
    return [a, b];
  }

  const [x, y] = walk(before, after, "");
  return { before: JSON.stringify(x, null, 2), after: JSON.stringify(y, null, 2), stats };
}

function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const envFile = join(REPO_ROOT, "apps", "web", ".env");
  if (!existsSync(envFile)) {
    throw new Error(`parity: no SESSION_SECRET in the environment and no ${envFile} to read it from.`);
  }
  const match = readFileSync(envFile, "utf8").match(/^\s*SESSION_SECRET\s*=\s*(.*)$/m);
  if (!match) throw new Error(`parity: ${envFile} has no SESSION_SECRET line.`);
  const secret = match[1].trim().replace(/^["']|["']$/g, "");
  if (!secret) throw new Error(`parity: SESSION_SECRET in ${envFile} is empty.`);
  return secret;
}

/**
 * The app's middleware accepts a signed session cookie, so the harness mints one
 * with the server's own secret rather than posting the owner's password. Same
 * claims as `createSessionToken` in `packages/core/src/session.ts`; if that
 * changes shape, this has to follow.
 */
async function authCookie() {
  const token = await new SignJWT({ u: "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("2592000s")
    .sign(new TextEncoder().encode(sessionSecret()));
  return `${SESSION_COOKIE}=${token}`;
}

async function get(baseUrl, path, cookie) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { cookie, accept: "application/json" },
    redirect: "manual",
  });
  const text = await res.text();
  return { status: res.status, contentType: res.headers.get("content-type") ?? "", text };
}

/**
 * A baseline full of login pages or 401s is worse than no baseline: every later
 * comparison would pass while proving nothing. Capture refuses anything that
 * does not look like a real JSON response.
 */
function rejectIfNotRealData({ status, contentType, text }) {
  if (status !== 200) return `HTTP ${status}`;
  if (!contentType.includes("application/json")) return `content-type ${contentType || "(none)"}`;
  if (text.trim().length === 0) return "empty body";
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return `body is not JSON (${e.message})`;
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const keys = Object.keys(parsed);
    if (keys.length === 1 && keys[0] === "error") return `error response: ${JSON.stringify(parsed.error)}`;
  }
  return null;
}

async function capture(file, paths) {
  if (paths.length === 0) throw new Error("parity capture: give it at least one path.");
  const baseUrl = process.env.PARITY_BASE_URL ?? DEFAULT_BASE;
  const cookie = await authCookie();
  announceRules();
  console.log(`Capturing ${paths.length} path(s) from ${baseUrl}`);

  const entries = [];
  const rejected = [];
  for (const path of paths) {
    const res = await get(baseUrl, path, cookie);
    const problem = rejectIfNotRealData(res);
    if (problem) {
      rejected.push(`  ${path}: ${problem}`);
      continue;
    }
    entries.push({ path, body: JSON.parse(res.text) });
    console.log(`  ok   ${path}  (${res.text.length} bytes)`);
  }

  if (rejected.length > 0) {
    console.error(`\nRefusing to write a baseline: ${rejected.length} path(s) did not return real data.`);
    console.error(rejected.join("\n"));
    console.error(`\nIs the server running at ${baseUrl}, and is SESSION_SECRET the one it was started with?`);
    process.exit(1);
  }

  writeFileSync(
    resolve(file),
    JSON.stringify({ baseUrl, capturedAt: new Date().toISOString(), rules: RULES, entries }, null, 2),
  );
  console.log(`\nWrote ${entries.length} response(s) to ${file}`);
}

// Trim the identical head and tail before diffing: the interesting part of two
// near-identical 5000-line bodies is usually a handful of lines, and an LCS over
// the untrimmed pair is quadratic for no gain.
function unifiedDiff(pathLabel, before, after) {
  const a = before.split("\n");
  const b = after.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;

  const aMid = a.slice(head, a.length - tail);
  const bMid = b.slice(head, b.length - tail);
  const CONTEXT = 3;
  const out = [`--- baseline ${pathLabel}`, `+++ current  ${pathLabel}`];
  for (let i = Math.max(0, head - CONTEXT); i < head; i++) out.push(` ${a[i]}`);
  const CAP = 200;
  for (const line of aMid.slice(0, CAP)) out.push(`-${line}`);
  if (aMid.length > CAP) out.push(`- ... ${aMid.length - CAP} more removed line(s)`);
  for (const line of bMid.slice(0, CAP)) out.push(`+${line}`);
  if (bMid.length > CAP) out.push(`+ ... ${bMid.length - CAP} more added line(s)`);
  for (let i = a.length - tail; i < Math.min(a.length, a.length - tail + CONTEXT); i++) out.push(` ${a[i]}`);
  return out.join("\n");
}

async function compare(file) {
  const saved = JSON.parse(readFileSync(resolve(file), "utf8"));
  const baseUrl = process.env.PARITY_BASE_URL ?? saved.baseUrl ?? DEFAULT_BASE;
  const cookie = await authCookie();
  announceRules();
  if (JSON.stringify(saved.rules) !== JSON.stringify(RULES)) {
    console.warn(
      "Warning: the baseline was captured under a different rule set. Re-capture it, " +
        "or read the results knowing the two runs disagree about what may move.\n",
    );
  }
  console.log(`Comparing ${saved.entries.length} path(s) against ${baseUrl} (baseline captured ${saved.capturedAt})\n`);

  let failed = 0;
  for (const entry of saved.entries) {
    const res = await get(baseUrl, entry.path, cookie);
    const problem = rejectIfNotRealData(res);
    if (problem) {
      failed++;
      console.error(`FAIL ${entry.path}: ${problem}`);
      continue;
    }
    const { before, after, stats } = reconcile(entry.body, JSON.parse(res.text));
    const waved = `${stats.ignored} ignored, ${stats.withinTolerance} within tolerance`;
    if (before === after) {
      console.log(`same ${entry.path}  (${waved})`);
      continue;
    }
    failed++;
    console.error(`DIFF ${entry.path}  (${waved})`);
    console.error(unifiedDiff(entry.path, before, after));
    console.error("");
  }

  if (failed > 0) {
    console.error(`\n${failed} of ${saved.entries.length} path(s) differ.`);
    process.exit(1);
  }
  console.log(`\nAll ${saved.entries.length} path(s) match.`);
}

const [mode, file, ...paths] = process.argv.slice(2);
if (mode === "capture" && file) await capture(file, paths);
else if (mode === "compare" && file) await compare(file);
else {
  console.error("usage: node scripts/parity.mjs capture <file> <path...>");
  console.error("       node scripts/parity.mjs compare <file>");
  process.exit(2);
}
