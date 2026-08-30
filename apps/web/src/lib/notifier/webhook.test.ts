import { describe, expect, it } from "vitest";
import { webhookUrl } from "./webhook";

/**
 * Where an alert is posted, from two fields that used to mean one thing.
 *
 * They are named `haUrl` and `haWebhookId` because they are columns in two
 * databases. What they mean has widened: the first is now any endpoint, and
 * the second is an optional Home Assistant detail. The awkward part is that
 * both readings have to keep working at once — somebody's existing HA
 * automation must not stop firing because the feature grew.
 */
describe("resolving the webhook endpoint", () => {
  /**
   * The old configuration, unchanged. HA's webhooks live at a fixed path, so
   * the id is appended and the stored URL stays the bare HA address.
   */
  it("appends Home Assistant's path when an id is given", () => {
    expect(webhookUrl("http://homeassistant.local:8123", "trader_signal"))
      .toBe("http://homeassistant.local:8123/api/webhook/trader_signal");
  });

  it("does not double the slash when the stored URL has a trailing one", () => {
    expect(webhookUrl("http://ha.local:8123/", "sig")).toBe("http://ha.local:8123/api/webhook/sig");
  });

  /** The general case, and the reason for the change. */
  it("posts to the URL verbatim when no id is given", () => {
    for (const id of [null, undefined, "", "   "]) {
      expect(webhookUrl("https://bot.example.com/hooks/contour", id))
        .toBe("https://bot.example.com/hooks/contour");
    }
  });

  it("keeps a path, a query and a port intact", () => {
    expect(webhookUrl("https://n8n.example.com:5678/webhook/abc?src=contour", null))
      .toBe("https://n8n.example.com:5678/webhook/abc?src=contour");
  });

  /**
   * Null rather than a throwing notifier: the caller adds nothing instead of
   * constructing something that fails on every alert for the rest of time.
   */
  it("answers null when there is nothing usable", () => {
    for (const bad of [null, undefined, "", "   "]) expect(webhookUrl(bad, "sig")).toBeNull();
    expect(webhookUrl("not a url", null)).toBeNull();
  });

  /**
   * A relative path would resolve against the server and post alerts back to
   * Contour, which answers 405 forever and looks like a broken integration
   * rather than a mistyped address. `file:` is the same class of accident.
   */
  it("refuses anything that is not absolute http or https", () => {
    expect(webhookUrl("/hooks/contour", null)).toBeNull();
    expect(webhookUrl("file:///etc/passwd", null)).toBeNull();
    expect(webhookUrl("ftp://example.com/x", null)).toBeNull();
  });
});
