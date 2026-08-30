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

/**
 * The `<main>` shell's own max-width, ignoring anything nested inside it.
 *
 * Every `<main>` in the file, not the first: the alerts screen opens with a
 * Suspense fallback — `<main className="min-h-screen" />` — and reading only
 * the first element reported that page as having no width at all. A fallback
 * carries no column because it renders nothing to put in one.
 *
 * Two different widths across two `<main>` elements would be a real problem
 * rather than a fallback, so that throws instead of picking one.
 */
function shellWidth(source: string): string | null {
  const widths = new Set<string>();
  for (const m of source.matchAll(/<main[^>]*className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    const w = /max-w-([0-9a-z]+)/.exec(m[1] ?? m[2] ?? "")?.[1];
    if (w) widths.add(w);
  }
  if (widths.size > 1) throw new Error(`two <main> shells disagree on width: ${[...widths].join(", ")}`);
  return [...widths][0] ?? null;
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
    // The detail pages too. `TopNav` is in the root layout, so it renders above
    // every one of these; a narrower shell starts the heading to the right of
    // the mark, and moving from a list to the thing it lists shifts the whole
    // page sideways. Asset was 4xl and the other two 3xl.
    ["packages/ui/src/screens/AssetScreen.tsx", "one asset"],
    ["apps/web/src/app/markets/[index]/page.tsx", "one exchange"],
    ["apps/web/src/app/more/page.tsx", "portfolio data"],
  ])("%s keeps the 5xl shell", (file) => {
    expect(shellWidth(read(file)), `${file} does not use max-w-5xl for its page shell`)
      .toBe("5xl");
  });

  it("TopNav shares it, so the mark sits above the page label", () => {
    expect(read("packages/ui/src/TopNav.tsx")).toContain("max-w-5xl");
  });

  /**
   * The two sanctioned exceptions, asserted as exceptions.
   *
   * BRAND.md allows exactly these — settings and forms are narrow because a
   * 1024px-wide form is a worse thing than a misaligned one. Pinning them stops
   * the rule above being applied blindly to every remaining page, which would
   * undo a deliberate decision in the name of consistency.
   */
  it.each([
    ["apps/web/src/app/settings/page.tsx", "xl"],
    ["apps/web/src/app/alerts/page.tsx", "4xl"],
    ["apps/web/src/app/backtest/page.tsx", "4xl"],
  ])("%s stays narrow on purpose", (file, width) => {
    expect(shellWidth(read(file)), `${file} is a sanctioned exception at max-w-${width}`)
      .toBe(width);
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
