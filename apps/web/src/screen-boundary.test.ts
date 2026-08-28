import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The screens ask a `DataClient`; they do not name routes.
 *
 * Phase 3 moved thirty-six `fetch("/api/…")` calls out of eight files and
 * behind one interface, so that a device build has somewhere to intervene.
 * Nothing about that conversion is self-enforcing: the next feature added to
 * the portfolio screen can reach for `fetch` in one line, typecheck, pass every
 * test, work perfectly in a browser, and be a blank panel inside the APK. This
 * is the test that stops it.
 *
 * `packages/core/src/boundary.test.ts` already forbids global `fetch` outright
 * in `packages/ui`, where the three shared components lived. It cannot do the
 * same here, because `apps/web/src/app` also holds the screens that are
 * *deliberately* server-only and always will be — the strategy tooling, auth,
 * push. So this guard works from an allowlist, and the allowlist says why each
 * exemption exists. An unexplained allowlist becomes a dumping ground: the
 * point of writing the reason down is that the next person adding an entry has
 * to write one too, and discovers while writing it that they do not have one.
 *
 * There is a second way to break the same rule, and it does not involve
 * `fetch` at all: a screen can `import { HttpClient }` and build its own client
 * over `WebNet`. No global `fetch`, no `/api/` literal, both of the URL guards
 * satisfied — and a panel that is dead inside the APK, because Phase 4 swaps
 * the provider and this screen never asked it anything. So the second guard
 * below forbids naming a `DataClient` implementation, or a `Net` one, anywhere
 * but `app/providers.tsx`, which is the file whose whole job that is.
 *
 * Two kinds of exemption:
 *
 * - `"all"` — the whole screen is server-only and its every request is exempt.
 * - a list of route prefixes — the screen is converted, and only these
 *   named requests may stay. `settings/page.tsx` is the only such file, and
 *   naming its nine survivors individually is what stops a tenth being added
 *   under cover of the same exemption.
 */

const APP_SRC = dirname(fileURLToPath(import.meta.url));

type Exemption = {
  /** Path relative to `apps/web/src`. */
  file: string;
  /** `"all"`, or the route prefixes this file may still request directly. */
  allowed: "all" | string[];
  why: string;
};

const ALLOWLIST: Exemption[] = [
  {
    file: "app/alerts/page.tsx",
    allowed: "all",
    why:
      "Alert CRUD and the evaluator. Dispatches through Home Assistant and " +
      "web-push from a server, which an APK has no counterpart for; the routes " +
      "stay inline permanently (CLAUDE.md, 'The data seam').",
  },
  {
    file: "app/analyze/page.tsx",
    allowed: "all",
    why:
      "The PineScript analyzer. Reads and writes samples/*.pine on the " +
      "filesystem through the server; there is no filesystem to read on a device.",
  },
  {
    file: "app/backtest/page.tsx",
    allowed: "all",
    why: "Strategy tooling. Server-only alongside analyze and the alert evaluator.",
  },
  {
    file: "app/chart/page.tsx",
    allowed: "all",
    why:
      "The candlestick chart. Proxies Binance klines through /api/candles and " +
      "belongs to the same strategy tooling; the portfolio screens are the " +
      "in-scope set, not this one.",
  },
  {
    file: "app/login/LoginForm.tsx",
    allowed: "all",
    why:
      "Session auth and passkeys. A device build has no login screen at all — " +
      "the whole file is absent there rather than reimplemented.",
  },
  {
    file: "app/settings/page.tsx",
    allowed: [
      // Session auth. Deliberately not on the port: `Store` holds no
      // passwordHash, and says why.
      "/api/logout",
      "/api/settings/password",
      // Passkeys: a WebAuthn ceremony between this browser and this origin.
      "/api/webauthn/",
      // Web Push: a VAPID key and a browser subscription, neither of which
      // exists inside an APK (which uses native notifications instead).
      "/api/push/",
    ],
    why:
      "Converted for the settings row itself; these nine requests are session " +
      "auth, passkeys and Web Push, which are browser-and-server mechanisms " +
      "rather than data. The file header explains the split.",
  },
  {
    file: "components/BackgroundAlerts.tsx",
    allowed: ["/api/alerts", "/api/cron/evaluate"],
    why:
      "Reads the same server-only alerts route the alerts screen owns, and " +
      "triggers the server-only evaluator on every foreground. Both are " +
      "permanently inline per CLAUDE.md — the evaluator dispatches through " +
      "Home Assistant, web-push and FCM, none of which exist in an APK. The " +
      "device build mounts no alerts at all, so there is nothing here for a " +
      "DataClient method to carry.",
  },
];

/** Every `.tsx`/`.ts` under the app, minus the route handlers and the tests. */
function screenFiles(): string[] {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        // `app/api` is the server. It is supposed to call out.
        return full.endsWith("/app/api") ? [] : walk(full);
      }
      if (!full.endsWith(".ts") && !full.endsWith(".tsx")) return [];
      if (full.endsWith(".test.ts") || full.endsWith(".test.tsx")) return [];
      return [full];
    });
  }
  return [...walk(join(APP_SRC, "app")), ...walk(join(APP_SRC, "components"))];
}

/**
 * Same treatment `boundary.test.ts` gives its own walk, and for the same
 * reason: a file that documents the `fetch` it no longer makes must not fail
 * for saying so. `settings/page.tsx` names four route prefixes in its header
 * comment.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/.*$/gm, "");
}

/**
 * The URL each call to the *global* `fetch` names. The negative lookbehind
 * keeps `net.fetch(` and `prefetch(` out of it, the same way the package guard
 * does.
 *
 * A call whose first argument is not a plain literal — `LoginForm` picks its
 * path with a ternary — is reported as `"(computed)"`, which no prefix in the
 * allowlist can match. That is deliberate: a computed URL is exactly how a
 * converted screen would sneak a route past a prefix list, so only a whole-file
 * exemption can cover one.
 */
function fetchedUrls(src: string): string[] {
  const urls: string[] = [];
  const call = /(?<![.\w$])fetch\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = call.exec(src)) !== null) {
    const rest = src.slice(m.index + m[0].length).trimStart();
    const literal = /^(?:`([^`$]*)`|"([^"]*)"|'([^']*)'|`([^`]*?)\$\{)/.exec(rest);
    urls.push(literal ? (literal[1] ?? literal[2] ?? literal[3] ?? literal[4] ?? "") : "(computed)");
  }
  return urls;
}

/**
 * The one file allowed to name an implementation: it is the composition root,
 * and Phase 4 swaps it whole.
 */
const WIRING_FILE = "app/providers.tsx";

/**
 * Module paths that *are* an implementation of `DataClient` or `Net`, and the
 * bindings they export. Both are checked: the path catches the ordinary import,
 * the binding names catch a re-export or a barrel that hides the path.
 *
 * `@/data/client/context` and `@/data/client/data-client` are deliberately
 * absent — the hook and the interface are exactly what a screen is supposed to
 * name.
 */
const IMPLEMENTATION_MODULES = [
  /(^|\/)client\/(http|local|stub)-client$/,
  /(^|\/)net\/(web|capacitor|fake)-net$/,
  /(^|\/)lib\/deps$/,
];
const IMPLEMENTATION_BINDINGS = [
  "HttpClient",
  "LocalClient",
  "StubClient",
  "WebNet",
  "CapacitorNet",
  "FakeNet",
];

/**
 * Every module a file imports, with the bindings it takes from each. Covers
 * `import … from "x"`, bare `import "x"`, and `import("x")`, which is the form
 * a screen would reach for to load a client lazily.
 */
function imports(src: string): { module: string; bindings: string[] }[] {
  const found: { module: string; bindings: string[] }[] = [];
  const statement = /import\s+(?:([\s\S]*?)\s+from\s+)?["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = statement.exec(src)) !== null) {
    found.push({ module: m[2]!, bindings: [...(m[1] ?? "").matchAll(/[A-Za-z_$][\w$]*/g)].map((b) => b[0]) });
  }
  const dynamic = /import\s*\(\s*["']([^"']+)["']/g;
  while ((m = dynamic.exec(src)) !== null) found.push({ module: m[1]!, bindings: [] });
  return found;
}

/** Every implementation this file names, when it is not the one allowed to. */
function implementationImports(relative: string, src: string): string[] {
  if (relative === WIRING_FILE) return [];
  return imports(stripComments(src))
    .filter(
      (i) =>
        IMPLEMENTATION_MODULES.some((re) => re.test(i.module)) ||
        i.bindings.some((b) => IMPLEMENTATION_BINDINGS.includes(b)),
    )
    .map((i) => `${relative} -> imports ${i.module}`);
}

/** Every offending call in one file, given what that file is allowed. */
function violations(relative: string, src: string): string[] {
  const exemption = ALLOWLIST.find((e) => e.file === relative);
  if (exemption?.allowed === "all") return [];
  const allowed = exemption?.allowed ?? [];
  return fetchedUrls(stripComments(src))
    .filter((url) => !allowed.some((prefix) => url.startsWith(prefix)))
    .map((url) => `${relative} -> fetch(${url})`);
}

describe("the screens ask a DataClient, not a route", () => {
  it("calls global fetch only where the allowlist says why", () => {
    const offenders = screenFiles().flatMap((file) =>
      violations(file.replace(APP_SRC + "/", ""), readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  /**
   * A guard whose walk quietly returns nothing passes forever. The floor is
   * well under the real count (about forty screens and components) so it trips
   * on a broken walk, not on someone deleting a page.
   */
  it("actually reads the screens", () => {
    expect(screenFiles().length).toBeGreaterThan(15);
  });

  /**
   * Every entry must still describe a file that exists, and must still be
   * needed. An exemption for a file that has since been converted is a licence
   * lying around for the next person to pick up.
   */
  it("keeps no exemption it no longer needs", () => {
    const present = new Set(screenFiles().map((f) => f.replace(APP_SRC + "/", "")));
    expect(ALLOWLIST.filter((e) => !present.has(e.file)).map((e) => e.file)).toEqual([]);

    const unused = ALLOWLIST.filter(
      (e) => fetchedUrls(stripComments(readFileSync(join(APP_SRC, e.file), "utf8"))).length === 0,
    );
    expect(unused.map((e) => e.file)).toEqual([]);
  });

  it("makes every exemption say why", () => {
    expect(ALLOWLIST.filter((e) => e.why.trim().length < 40).map((e) => e.file)).toEqual([]);
  });

  /**
   * Proof that it bites. Each case is a way the rule has a real chance of being
   * broken: a plain relative call, a template URL, a computed one, and a call
   * added to a screen that is only *partly* exempt.
   */
  it("catches a new fetch in a converted screen", () => {
    const converted = "app/portfolio/page.tsx";
    expect(violations(converted, `const r = await fetch("/api/portfolios");`)).toEqual([
      `${converted} -> fetch(/api/portfolios)`,
    ]);
    expect(violations(converted, "const r = await fetch(`/api/portfolios/${id}/series`);")).toEqual([
      `${converted} -> fetch(/api/portfolios/)`,
    ]);
    expect(violations(converted, "const r = await fetch(url);")).toEqual([
      `${converted} -> fetch((computed))`,
    ]);

    // A partly-exempt file may keep what it is named for and nothing else.
    const settings = "app/settings/page.tsx";
    expect(violations(settings, `await fetch("/api/logout", { method: "POST" });`)).toEqual([]);
    expect(violations(settings, `await fetch("/api/portfolios");`)).toEqual([
      `${settings} -> fetch(/api/portfolios)`,
    ]);
    // ...and a computed URL cannot hide behind that prefix list.
    expect(violations(settings, "await fetch(route);")).toEqual([
      `${settings} -> fetch((computed))`,
    ]);
  });

  /**
   * The other half of the claim: no screen names an implementation either.
   */
  it("lets no screen but the provider build its own client", () => {
    const offenders = screenFiles().flatMap((file) =>
      implementationImports(file.replace(APP_SRC + "/", ""), readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("still exempts the one file whose job it is", () => {
    const wiring = readFileSync(join(APP_SRC, WIRING_FILE), "utf8");
    // If the wiring stops naming an implementation, the exemption is stale and
    // this guard is quietly exempting a file for nothing.
    expect(implementationImports("app/some/other/page.tsx", wiring).length).toBeGreaterThan(0);
    expect(implementationImports(WIRING_FILE, wiring)).toEqual([]);
  });

  /** Proof that it bites, in each shape the rule could be broken. */
  it("catches a screen reaching for an implementation", () => {
    const screen = "app/portfolio/page.tsx";
    expect(
      implementationImports(screen, `import { HttpClient } from "@/data/client/http-client";`),
    ).toEqual([`${screen} -> imports @/data/client/http-client`]);
    expect(implementationImports(screen, `import { WebNet } from "@/lib/net/web-net";`)).toEqual([
      `${screen} -> imports @/lib/net/web-net`,
    ]);
    // A relative path, and a lazy one.
    expect(implementationImports(screen, `import { LocalClient } from "../../data/client/local-client";`))
      .toEqual([`${screen} -> imports ../../data/client/local-client`]);
    expect(implementationImports(screen, `const { HttpClient } = await import("@/data/client/http-client");`))
      .toEqual([`${screen} -> imports @/data/client/http-client`]);
    // Re-exported from somewhere innocuous: the binding gives it away.
    expect(implementationImports(screen, `import { HttpClient } from "@/data";`)).toEqual([
      `${screen} -> imports @/data`,
    ]);

    // What a screen is supposed to import stays clean.
    expect(implementationImports(screen, `import { useDataClient } from "@/data/client/context";`)).toEqual([]);
    expect(implementationImports(screen, `import type { DataClient } from "@/data/client/data-client";`)).toEqual([]);
    // Prose describing the rule is not a breach of it.
    expect(implementationImports(screen, `// never: import { HttpClient } from "@/data/client/http-client"`)).toEqual([]);
  });

  it("reads code and ignores prose", () => {
    const converted = "app/insights/page.tsx";
    expect(violations(converted, `// this screen no longer calls fetch("/api/benchmark")`)).toEqual(
      [],
    );
    expect(violations(converted, `/** was: fetch("/api/benchmark") */`)).toEqual([]);
    // A member-access fetch is not the global, and the injected Net is how a
    // package is *supposed* to reach the network.
    expect(violations(converted, `await net.fetch("/api/benchmark");`)).toEqual([]);
  });
});
