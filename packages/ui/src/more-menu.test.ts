import { describe, expect, it } from "vitest";
import { DEVICE_MORE_GROUPS, MORE_GROUPS, hrefsOf } from "./more-menu";

/**
 * A destination added to one app must be considered for the other.
 *
 * The two menus differ on purpose — the device has no alerts screen and no
 * strategy tooling — and that is not the risk. The risk is the *next* entry:
 * someone adds a page to the web app's More list, the device list is a
 * different array three lines below, and nothing anywhere asks whether the
 * phone should have it too. The answer is often no, and it still has to be an
 * answer.
 *
 * Same mechanism as `screen-boundary.test.ts`: an exemption costs a written
 * reason, and writing the reason is where most would-be exemptions turn out
 * not to have one. `links.test.ts` already proves each menu's entries resolve
 * in its own app; this proves the difference between them is deliberate.
 */
const WEB_ONLY: Record<string, string> = {
  "/alerts":
    "Alerts need the alerts routes, Home Assistant, web-push and FCM, all server-side. The " +
    "device build has no server. Local evaluation on the device is possible — `alert-rules.ts` " +
    "is pure and needs only prices — but it needs an alerts table and a screen first.",
  "/chart":
    "The detailed indicator chart is fed by /api/candles, which proxies Binance server-side.",
  "/backtest":
    "Runs the strategy over 1,460 bars of warm-up against a server-side price feed.",
  "/analyze":
    "Reads and writes PineScript files under samples/ through the filesystem.",
};

describe("the two More menus", () => {
  const web = hrefsOf(MORE_GROUPS);
  const device = hrefsOf(DEVICE_MORE_GROUPS);

  it("finds both lists, so an empty one cannot pass", () => {
    expect(web.length).toBeGreaterThan(3);
    expect(device.length).toBeGreaterThan(2);
  });

  it("offers every web destination on the device, or says why not", () => {
    const unexplained = web.filter((href) => !device.includes(href) && !(href in WEB_ONLY));
    expect(unexplained).toEqual([]);
  });

  it("keeps no reason for a destination that no longer exists", () => {
    // A reason nobody rereads is worse than none: it describes a decision
    // about a page that may have changed underneath it.
    const stale = Object.keys(WEB_ONLY).filter((href) => !web.includes(href));
    expect(stale).toEqual([]);
  });

  it("does not let the device offer something the web app lacks", () => {
    // Not symmetry for its own sake: the device is the constrained build, so a
    // destination it has and the desktop does not is far more likely to be an
    // oversight than a decision.
    expect(device.filter((href) => !web.includes(href))).toEqual([]);
  });
});
