import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A button whose whole content is an icon must be a circle.
 *
 * `BRAND.md` makes this the standard, and prose cannot hold it: the alerts
 * list shipped a bare 14px bin in `text-neutral-700`, which had no edge, sat
 * wherever its own padding put it, and announced nothing about what it did
 * until a hover state that a phone does not have. The sheet's close control
 * had grown the same shape independently. Neither was a decision; both were
 * what you get when there is no rule.
 *
 * The test is narrow on purpose. It fires only on a button with **no visible
 * text at all** — an icon beside a word is a labelled button and takes the
 * button styles. Everything it flags is either a call to `iconButton` /
 * `deleteButton`, or an entry below with a reason.
 */

/** Icon-only buttons that are deliberately not the standard circle. */
const ALLOWED: Record<string, string> = {
  "packages/ui/src/SymbolPicker.tsx":
    "The chevron inside the field, not an action beside it. It is the same " +
    "affordance a `<select>` draws inside its own box, and a bordered circle " +
    "sitting on top of an input would read as a second control.",
  "packages/ui/src/BiometricLock.tsx":
    "The lock screen's unlock disc: already a circle, and filled rather than " +
    "bordered because it is the entrance surface's primary action at 80px, " +
    "sitting in the lower third where a thumb is. " +
    "`MarkTile` and this share that language; a list-row button does not.",
};

const ROOTS = ["packages/ui/src", "apps/web/src", "apps/mobile/src"];
const REPO = new URL("../../../", import.meta.url).pathname;

function sources(dir: string): string[] {
  return readdirSync(join(REPO, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (statSync(join(REPO, rel)).isDirectory()) return sources(rel);
    return rel.endsWith(".tsx") ? [rel] : [];
  });
}

/**
 * Every `<button …>…</button>`, walked rather than matched.
 *
 * A single regex cannot do this. `Sheet`'s scrim is a self-closing
 * `<button … />`, so a lazy `<button …>…</button>` pattern starting there ran
 * on to the *next* button's closing tag and swallowed it whole — the file
 * reported one button, and the bare icon control inside it was never
 * examined. This test passed while blind to the one thing it was written for.
 *
 * So: find each `<button`, end its opening tag properly, skip it if that tag
 * self-closes, and take the content up to the next `</button>`. None of ours
 * nest, which is the one assumption left.
 */
function buttons(src: string): string[] {
  const out: string[] = [];
  for (let i = src.indexOf("<button"); i !== -1; i = src.indexOf("<button", i + 7)) {
    const rest = src.slice(i);
    const end = openTagEnd(rest);
    if (end === -1) continue;
    if (rest[end - 1] === "/") continue;  // self-closing: no content to judge
    const close = rest.indexOf("</button>", end);
    if (close === -1) continue;
    out.push(rest.slice(0, close + "</button>".length));
  }
  return out;
}

/**
 * Where a `<button …>` opening tag actually ends.
 *
 * Not the first `>`. An arrow function in an attribute — `onClick={() => …}` —
 * contains one, and taking it split the tag mid-attribute: the whole handler
 * body then counted as rendered content, so a button holding nothing but an
 * icon looked like it held text and this test passed while saying nothing.
 * Braces and quotes are tracked instead.
 */
function openTagEnd(button: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < button.length; i++) {
    const c = button[i]!;
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return i;
  }
  return -1;
}

/**
 * True when nothing but icons is rendered.
 *
 * JSX expressions are dropped before looking for text, because a toggling
 * button writes its icons as `{open ? <X/> : <Plus/>}`. A *labelled* button
 * writes its word either as bare text or inside an expression — `{label}`,
 * `{open ? "Less" : "More"}` — so an expression holding an identifier or a
 * string literal counts as a label and the button is left alone.
 */
function iconOnly(button: string): boolean {
  const inner = button.slice(openTagEnd(button) + 1, button.lastIndexOf("</button>"));
  if (!/\bsize=\{\d+\}/.test(inner)) return false;
  const withoutJsx = inner.replace(/\{(?:[^{}]|\{[^{}]*\})*\}/g, "");
  const text = withoutJsx.replace(/<[^>]*>/g, "").replace(/\s+/g, "");
  if (text) return false;
  const expressions = inner.match(/\{(?:[^{}]|\{[^{}]*\})*\}/g) ?? [];
  return !expressions.some((e) =>
    /^\{[a-z]\w*(\.\w+)*\}$/.test(e) || /["'`]/.test(e));
}

describe("icon-only buttons are the standard circle", () => {
  const files = ROOTS.flatMap(sources).map((f) => [f, readFileSync(join(REPO, f), "utf8")] as const);

  it("finds the components, so an empty walk cannot pass", () => {
    expect(files.length).toBeGreaterThan(30);
    expect(files.flatMap(([, src]) => buttons(src)).length).toBeGreaterThan(10);
  });

  it("uses iconButton or deleteButton, or says why not", () => {
    const offenders = files
      .filter(([, src]) =>
        buttons(src).some((b) =>
          iconOnly(b) && !/iconButton\(|deleteButton\(/.test(b)))
      .map(([f]) => f)
      .filter((f) => !(f in ALLOWED));
    expect(offenders, "wrap the icon in the shared circle, or add a reason").toEqual([]);
  });

  it("keeps no reason for a file that no longer has one", () => {
    // A reason nobody rereads is worse than none: it describes a decision
    // about code that may have changed underneath it.
    const stale = Object.keys(ALLOWED).filter((f) =>
      !files.some(([name, src]) =>
        name === f && buttons(src).some((b) => iconOnly(b) && !/iconButton\(|deleteButton\(/.test(b))));
    expect(stale).toEqual([]);
  });

  it("keeps the circle in one file, so the two tones cannot drift apart", () => {
    const spelling = readFileSync(join(REPO, "packages/ui/src/icon-button.ts"), "utf8");
    expect(spelling).toContain("rounded-full");
    // Both tones share `circle()`; a copy of the box would be how one of them
    // ends up 40px.
    expect(spelling.match(/w-11 h-11/g)?.length).toBe(1);
    expect(spelling.match(/w-9 h-9/g)?.length).toBe(1);
  });
});
