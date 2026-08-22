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

/**
 * The only values allowed to differ between capture and compare. Each one is
 * non-deterministic by nature — a live quote, or a clock reading — not merely
 * inconvenient. Anything derived from stored transactions (quantity, avgCost,
 * costBasis, realizedPnl, fees) is deliberately absent: those are exactly what
 * a refactor could break, and normalising them would hide it.
 *
 * Matched by key name, at any depth. The whole subtree under a matched key is
 * replaced, so `dayChange: { abs, pct }` goes as a unit.
 */
const IGNORED_KEYS = [
  // live market prices and everything computed from them
  "price", "prices", "value", "unrealizedPnl", "dayChange", "quote", "lastPrice",
  // clock readings, including windows the server derives from "now"
  "generatedAt", "asOf", "now", "timestamp", "fetchedAt", "updatedAt",
  "exportedAt", "windowFrom", "windowTo",
];

const PLACEHOLDER = "<parity:ignored>";

function announceIgnores() {
  console.log(`Ignoring these keys wherever they appear (non-deterministic between runs):`);
  console.log(`  ${IGNORED_KEYS.join(", ")}`);
  console.log(`Everything else must match byte for byte.\n`);
}

function normalise(value) {
  if (Array.isArray(value)) return value.map(normalise);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = IGNORED_KEYS.includes(k) ? PLACEHOLDER : normalise(v);
    }
    return out;
  }
  return value;
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
function rejectIfNotRealData(path, { status, contentType, text }) {
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
  announceIgnores();
  console.log(`Capturing ${paths.length} path(s) from ${baseUrl}`);

  const entries = [];
  const rejected = [];
  for (const path of paths) {
    const res = await get(baseUrl, path, cookie);
    const problem = rejectIfNotRealData(path, res);
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
    JSON.stringify({ baseUrl, capturedAt: new Date().toISOString(), ignoredKeys: IGNORED_KEYS, entries }, null, 2),
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
  announceIgnores();
  if (JSON.stringify(saved.ignoredKeys) !== JSON.stringify(IGNORED_KEYS)) {
    console.warn(
      `Warning: the baseline was captured with a different ignore list (${(saved.ignoredKeys ?? []).join(", ")}).\n` +
        `Differences in the changed keys will be reported or hidden accordingly.\n`,
    );
  }
  console.log(`Comparing ${saved.entries.length} path(s) against ${baseUrl} (baseline captured ${saved.capturedAt})\n`);

  let failed = 0;
  for (const entry of saved.entries) {
    const res = await get(baseUrl, entry.path, cookie);
    const problem = rejectIfNotRealData(entry.path, res);
    if (problem) {
      failed++;
      console.error(`FAIL ${entry.path}: ${problem}`);
      continue;
    }
    const before = JSON.stringify(normalise(entry.body), null, 2);
    const after = JSON.stringify(normalise(JSON.parse(res.text)), null, 2);
    if (before === after) {
      console.log(`same ${entry.path}`);
      continue;
    }
    failed++;
    console.error(`DIFF ${entry.path}`);
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
