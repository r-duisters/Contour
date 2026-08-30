import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The column every primary screen shares.
 *
 * `BRAND.md` states it plainly — "`max-w-5xl` — every primary screen, and
 * `TopNav`" — and explains what it is for: the mark in the top bar sits
 * directly above the page label, and the four destinations line up when a
 * reader moves between them. It also records that per-type widths were tried
 * and abandoned, because they put the widest shell around the holdings *list*
 * and the narrowest around the ledger's five-column *table*.
 *
 * Markets was `max-w-3xl` anyway. Nothing caught it, because a width is
 * invisible on the screen you are looking at — it only shows as a jump when
 * you move between two, and it looks like the top bar is wrong rather than the
 * page. This is the test that would have.
 *
 * A page whose content wants less room narrows *inside* the column, which is
 * what `max-w-xl` on the settings form does within its own shell. This asserts
 * the shell, not what a page puts in it.
 */

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url).pathname, "utf8");

/** The `<main>` shell's own max-width, ignoring anything nested inside it. */
function shellWidth(source: string): string | null {
  const main = /<main[^>]*className=(?:"([^"]*)"|\{`([^`]*)`\})/.exec(source);
  const cls = main?.[1] ?? main?.[2] ?? "";
  return /max-w-([0-9a-z]+)/.exec(cls)?.[1] ?? null;
}

describe("the shared page column", () => {
  /**
   * The five BRAND.md names, plus the nav that has to agree with them. Chart is
   * the documented half-exception: its *bar* takes the column so the eyebrow
   * aligns, while the panes keep the window — so the shell is still 5xl.
   */
  it.each([
    ["packages/ui/src/screens/PortfolioScreen.tsx", "portfolio"],
    ["packages/ui/src/screens/MarketsScreen.tsx", "markets"],
    ["packages/ui/src/screens/InsightsScreen.tsx", "insights"],
    ["packages/ui/src/screens/LedgerScreen.tsx", "ledger"],
  ])("%s keeps the 5xl shell", (file) => {
    expect(shellWidth(read(file)), `${file} does not use max-w-5xl for its page shell`)
      .toBe("5xl");
  });

  it("TopNav shares it, so the mark sits above the page label", () => {
    expect(read("packages/ui/src/TopNav.tsx")).toContain("max-w-5xl");
  });
});

describe("back-links point at where the reader came from", () => {
  /**
   * The Ledger's parent differs by platform: the More menu on a phone, the top
   * bar on a desktop. So its back-link is `md:hidden` — on a wide screen it
   * offered a way back to a page the reader had not been on, as the very first
   * element.
   *
   * The other two are unconditional on purpose, and this says so rather than
   * leaving a future reader to wonder whether they were missed: an asset is
   * always reached from the portfolio and an index always from Markets,
   * whatever the width.
   */
  it("hides the Ledger's More link where More is not the parent", () => {
    const source = read("packages/ui/src/screens/LedgerScreen.tsx");
    const link = /<Link href="\/more"[^>]*className="([^"]*)"/.exec(source)?.[1];
    expect(link, "the Ledger's back-link to /more has gone").toBeTruthy();
    expect(link, "on a desktop, TopNav lists Ledger — a link back to More is wrong")
      .toContain("md:hidden");
  });
});
