import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * The licence claim, checked by a machine.
 *
 * `offline-tree.mjs` walks the real import graph from `apps/mobile/src` and
 * reports whether anything PineScript-derived is reachable. The answer has to
 * be zero: the port of Oakley Wood's script is the one thing in this
 * repository that is not ours to relicense (NOTICE, and decision 1 in
 * `docs/carried-forward.md`), and #53's entire argument — that a public
 * offline-only repository sheds the licence question rather than inheriting
 * it — rests on that zero.
 *
 * Until now nothing ran it. It was a script somebody remembered, and the claim
 * it supports was quoted in issues, commit messages and release planning on
 * the strength of a run that had happened at some point. A single `import` added
 * in `packages/ui` that reached the indicator would have broken the licence
 * position silently, and the next person to notice would have been whoever read
 * the public repository.
 *
 * The script is run as a subprocess rather than imported, so what is tested is
 * the artefact a person actually runs — exit code included. It takes about
 * 60ms.
 */

const run = () => {
  const root = new URL("..", import.meta.url).pathname;
  try {
    return {
      code: 0,
      out: execFileSync("node", ["scripts/offline-tree.mjs"], { cwd: root, encoding: "utf8" }),
    };
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    return { code: err.status ?? 1, out: err.stdout ?? "" };
  }
};

describe("what a public offline-only repository would carry", () => {
  /**
   * The script exits non-zero and names the offending files, so the exit code
   * is the assertion and the output is the diagnosis. A failure here is not a
   * broken test — it means an import now reaches the port, and either the
   * import is wrong or #53 needs rethinking.
   */
  it("reaches nothing derived from the PineScript", () => {
    const { code, out } = run();
    expect(out).toContain("PineScript-derived files reachable: 0");
    expect(code, `offline-tree refused:\n${out}`).toBe(0);
  });

  /**
   * The second assertion, and the one that stops the first being vacuous.
   *
   * If `resolveSpec` ever stops resolving — a path alias renamed, an extension
   * added — the walk reaches nothing, finds no Pine files in nothing, and
   * reports a triumphant zero. That is the same shape as the settings-contract
   * test that passed by coincidence because its fixture wrote the default
   * value. A floor on the file count makes the zero mean something.
   */
  it("actually walked the graph, rather than finding nothing at all", () => {
    const { out } = run();
    const files = Number(/(\d+)\s+source files/.exec(out)?.[1] ?? 0);
    expect(files, `only ${files} files reached — the import walk is probably broken, which would make the zero above meaningless`)
      .toBeGreaterThan(100);
  });
});
