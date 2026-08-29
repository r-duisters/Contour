import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEVICE_ROUTING, WEB_ROUTING } from "./routing";
import { DEVICE_MORE_GROUPS, MORE_GROUPS, hrefsOf } from "./more-menu";

/**
 * Every link the app can draw, against the routes the app actually has.
 *
 * A dead link on the web app is a 404 a person can back out of. In the static
 * export it is worse than that: leaving the document restarts the whole app
 * against a native SQLite connection that is already registered, and the screen
 * reads "Contour could not open its database" — which is what following the AEX
 * card did, because `/markets/aex` is a dynamic segment and a static export has
 * none.
 *
 * So the destinations are checked here rather than found on a handset. The two
 * apps have different route sets *and* different link sets, and the point is
 * that each app's links resolve within its own app.
 */

const REPO = join(__dirname, "..", "..", "..");

/** The routes an app defines, from the files that define them. */
function routesOf(appDir: string): Set<string> {
  const root = join(REPO, appDir, "src", "app");
  const out = new Set<string>();

  const walk = (dir: string, route: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (!statSync(full).isDirectory()) {
        // `route.ts` counts: an API endpoint is a destination a link can name,
        // and the More page links straight at the APK download.
        if (/^(page|route)\.(tsx|ts)$/.test(entry)) out.add(route === "" ? "/" : route);
        continue;
      }
      // (groups) do not appear in the URL; @slots and _private are not routes.
      if (entry.startsWith("@") || entry.startsWith("_")) continue;
      walk(full, entry.startsWith("(") && entry.endsWith(")") ? route : `${route}/${entry}`);
    }
  };
  walk(root, "");
  return out;
}

/**
 * The fixed part of an interpolated href: `` `/markets/${slug}` `` → `/markets/`.
 *
 * This is the half that matters and the half a naive scan misses. The AEX link
 * was exactly this shape, so a checker that only read fully-literal hrefs would
 * have passed while the app restarted itself on every tap.
 */
function staticPrefix(href: string): string | null {
  if (!href.includes("${")) return null;
  const path = href.split("?")[0]!;
  const at = path.indexOf("${");
  // Interpolation only in the query — `/chart?symbol=${x}` — leaves the path
  // itself fixed, so it is checked as an ordinary route.
  return at === -1 ? null : path.slice(0, at);
}

/** Does this app serve that path? `[x]` and `[...x]` match a real segment. */
function resolves(routes: Set<string>, href: string): boolean {
  const path = href.split("?")[0]!.split("#")[0]!.replace(/\/$/, "") || "/";
  if (routes.has(path)) return true;
  const parts = path.split("/").filter(Boolean);
  return [...routes].some((route) => {
    const pattern = route.split("/").filter(Boolean);
    if (pattern.some((p) => p.startsWith("[..."))) {
      return pattern.length <= parts.length + 1;
    }
    if (pattern.length !== parts.length) return false;
    return pattern.every((p, i) => (p.startsWith("[") && p.endsWith("]")) || p === parts[i]);
  });
}

/**
 * Every path literal written in a tree, not only the ones spelled `href=`.
 *
 * The first version of this scanned `href=` attributes and passed while the
 * AEX link was still broken, because that link is built into a variable first
 * and only then handed to `href`. A checker that misses the bug it was written
 * for is worse than none, so this reads every string or template that starts
 * with a slash and looks like a route.
 */
function literalHrefs(dirs: string[]): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== "node_modules") walk(full);
        continue;
      }
      if (!/\.(tsx|ts)$/.test(entry) || entry.includes(".test.")) continue;
      // Comments first: they carry examples, prose slashes and the very
      // paths these rules discuss, none of which the app can navigate to.
      const source = readFileSync(full, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const m of source.matchAll(/["'`](\/[A-Za-z0-9_[\]${}.\-/?=&]*)["'`]/g)) {
        const href = m[1]!;
        // A file is an asset, not a route: `/icons/favicon-64.png` is served
        // from `public/` and has no page behind it by design.
        //
        // By extension, not by "contains a dot". The first version used the
        // dot and silently dropped `` `/markets/${index.slug}` `` — the
        // interpolation ends in a property access, which reads as a file
        // suffix — so the checker passed while the very link it was written
        // for was still broken.
        if (/\.(png|jpe?g|svg|ico|webmanifest|json|txt|xml|css|js)$/i.test(href.split("?")[0]!)) {
          continue;
        }
        if (href === "/") continue;
        // `/api/...` is not navigation. The four that survive in shared markup
        // are pinned by name in `packages/core/src/boundary.test.ts`, with what
        // each still needs; a second, vaguer failure here would only obscure
        // that record.
        if (href.startsWith("/api/")) continue;
        if (!found.has(href)) found.set(href, full.slice(REPO.length + 1));
      }
    }
  };
  for (const dir of dirs) walk(join(REPO, dir));
  return found;
}

/** True when nothing in `routes` can serve this href. */
function dangling(routes: Set<string>, href: string): boolean {
  const prefix = staticPrefix(href);
  return prefix === null
    ? !resolves(routes, href)
    : ![...routes].some((r) => r.startsWith(prefix));
}

const SHARED = "packages/ui/src";

/**
 * Shared files whose paths the device never navigates to, and why.
 *
 * `packages/ui` holds both apps' tables, so a regex over it finds the web
 * app's destinations too. These are not links the device can follow; they are
 * either the *definition* of where the web app goes, or a comparison against
 * the current path rather than a place to go. Everything else in the shared
 * tree is checked against the device's own routes, which is the point.
 */
const WEB_ONLY_IN_SHARED: Record<string, string> = {
  "packages/ui/src/routing.tsx":
    "Defines WEB_ROUTING beside DEVICE_ROUTING. Its web half naming web routes is the seam working.",
  "packages/ui/src/more-menu.ts":
    "Holds MORE_GROUPS beside DEVICE_MORE_GROUPS; the device list is asserted separately below.",
  "packages/ui/src/TopNav.tsx":
    "The desktop bar. `hidden md:block`, and the device layout does not mount it at all.",
  "packages/ui/src/TabBar.tsx":
    "Its /login and /setup are pathname comparisons — where the bar hides itself, not somewhere it goes.",
};

describe("every link the web app can draw", () => {
  const routes = routesOf("apps/web");

  it("has a page behind it", () => {
    const links = literalHrefs([SHARED, "apps/web/src"]);
    const dead = [...links].filter(([href]) => dangling(routes, href));
    expect(dead).toEqual([]);
  });

  it("includes every destination in the More menu and the tab bar", () => {
    const dead = hrefsOf(MORE_GROUPS).filter((href) => !resolves(routes, href));
    expect(dead).toEqual([]);
  });

  it("resolves what the routing seam builds", () => {
    for (const href of [
      WEB_ROUTING.assetHref("BTC", "crypto"),
      WEB_ROUTING.indexHref("aex"),
    ]) {
      expect(href === null || resolves(routes, href)).toBe(true);
    }
  });
});

describe("every link the device app can draw", () => {
  const routes = routesOf("apps/mobile");

  /**
   * The shared components are read against the *device's* routes, because the
   * device renders them too. A literal that only the web app has a page for is
   * exactly the AEX bug, and it must be built through the routing seam instead
   * — which is why the seam answers `null` there.
   */
  it("has a page behind it", () => {
    const links = literalHrefs([SHARED, "apps/mobile/src"]);
    const dead = [...links]
      .filter(([, file]) => !(file in WEB_ONLY_IN_SHARED))
      .filter(([href]) => dangling(routes, href));
    expect(dead).toEqual([]);
  });

  it("includes every destination in its own More menu", () => {
    const dead = hrefsOf(DEVICE_MORE_GROUPS).filter((href) => !resolves(routes, href));
    expect(dead).toEqual([]);
  });

  it("resolves what the routing seam builds, or declines to build one", () => {
    // Null is the honest answer where a build has no such page, and the
    // screens draw nothing rather than a link into a restart.
    expect(DEVICE_ROUTING.indexHref("aex")).toBeNull();
    expect(resolves(routes, DEVICE_ROUTING.assetHref("BTC", "crypto"))).toBe(true);
  });
});
