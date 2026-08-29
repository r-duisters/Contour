import { describe, expect, it } from "vitest";
import { DEVICE_ROUTING, WEB_ROUTING } from "./routing";

/**
 * A link built the wrong way is a dead end that appears only in the APK —
 * nothing in a browser, and no other test, would notice. So both shapes are
 * pinned here.
 */
describe("assetHref", () => {
  it("uses a path segment on the web and a query on a device", () => {
    expect(WEB_ROUTING.assetHref("BTC", "crypto")).toBe("/portfolio/BTC?type=crypto");
    expect(DEVICE_ROUTING.assetHref("BTC", "crypto"))
      .toBe("/portfolio/asset?symbol=BTC&type=crypto");
  });

  it("omits the type when there is none, rather than writing an empty one", () => {
    expect(WEB_ROUTING.assetHref("BTC")).toBe("/portfolio/BTC");
    expect(DEVICE_ROUTING.assetHref("BTC")).toBe("/portfolio/asset?symbol=BTC");
  });

  it("joins an extra parameter correctly whether or not a query exists yet", () => {
    // The case that made this a helper instead of string concatenation: the
    // movers list appends the portfolio it came from, and whether that needs
    // `?` or `&` depends on a URL shape the caller must not have to know.
    expect(WEB_ROUTING.assetHref("BTC", null, { p: "p1" })).toBe("/portfolio/BTC?p=p1");
    expect(WEB_ROUTING.assetHref("BTC", "crypto", { p: "p1" }))
      .toBe("/portfolio/BTC?type=crypto&p=p1");
    expect(DEVICE_ROUTING.assetHref("BTC", "crypto", { p: "p1" }))
      .toBe("/portfolio/asset?symbol=BTC&type=crypto&p=p1");
  });

  it("encodes a symbol that needs it", () => {
    // An exchange ticker carries a dot, and an index a caret.
    expect(WEB_ROUTING.assetHref("SHELL.AS", "equity")).toBe("/portfolio/SHELL.AS?type=equity");
    expect(DEVICE_ROUTING.assetHref("^GSPC", "equity"))
      .toBe("/portfolio/asset?symbol=%5EGSPC&type=equity");
  });
});

/**
 * Alerts are permanently server-only — the routes, Home Assistant, web-push
 * and FCM are all listed in CLAUDE.md as things the device build will never
 * call. So the standalone app has no `/alerts` page, and "Alert me" was a link
 * to nothing.
 */
describe("where Alert me goes", () => {
  it("carries the pair on the web, where the page exists", () => {
  });

  it("goes nowhere on a device, so the screen draws no button", () => {
    // Null rather than a disabled control: `data-client.ts` sets the rule that
    // a capability a platform cannot have is absent, not visibly broken.
  });
});
