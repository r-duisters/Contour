import { TrackingModeExitMode } from "lightweight-charts";

/**
 * The one place the charts agree on what they look like.
 *
 * Four of them hand-wrote the same `layout` and `grid` block, which is how one
 * ended up on a different grid grey and how all four spent a year rendering
 * their axis labels in **Trebuchet MS** — `lightweight-charts` defaults to it,
 * nobody set a family, and it never looked wrong enough to notice beside Geist.
 */

/** Gain and loss, the same pair every percentage in the app uses. */
export const UP = "#22c55e";
export const DOWN = "#ef4444";

/**
 * The canvas cannot resolve `var(--font-geist-sans)`, so the family is read
 * off the document at chart-creation time — the stack `globals.css` put on
 * `body`, whatever it resolves to. Falls back to the system sans when there is
 * no document, which is every server render.
 */
function resolvedFont(): string {
  if (typeof window === "undefined") return "system-ui, sans-serif";
  const family = getComputedStyle(document.body).fontFamily;
  return family || "system-ui, sans-serif";
}

/**
 * Layout and grid for every chart in the app.
 *
 * `attributionLogo: false` is deliberate and load-bearing: the licence asks for
 * the attribution notice and a link to tradingview.com on a page the user can
 * reach, and ours is the credit on the More page. Delete that credit and every
 * chart here becomes a licence breach.
 */
export function chartTheme() {
  return {
    layout: {
      background: { color: "#0a0a0a" },
      textColor: "#d4d4d4",
      fontFamily: resolvedFont(),
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: "#171717" },
      horzLines: { color: "#171717" },
    },
    /**
     * Press and hold to read a value; lift to dismiss.
     *
     * A phone has no hover, so the library gates the crosshair behind
     * "tracking mode", entered with a long press. The default exit is
     * `OnNextTap`, which leaves the chart tracking — and scrolling disabled —
     * until the reader taps again; on a page that scrolls, that reads as the
     * page having jammed. `OnTouchEnd` makes the reading last exactly as long
     * as the finger is down, which is also the gesture people already know
     * from every other chart on a phone.
     */
    trackingMode: { exitMode: TrackingModeExitMode.OnTouchEnd },
    // Vertical swipes must scroll the page on a touch device; horizontal drag
    // still pans and pinch still zooms.
    handleScroll: {
      mouseWheel: true,
      pressedMouseMove: true,
      horzTouchDrag: true,
      vertTouchDrag: false,
    },
  } as const;
}

/**
 * A value or price line coloured by where the period ended.
 *
 * Green up, red down, with the fill a translucent wash of the same hue that
 * fades out before the baseline — the treatment the Markets sparklines
 * established. It replaces the accent blue these lines used to take, which
 * `BRAND.md` had reserved for "you on a chart"; that rule now applies to the
 * benchmark comparison alone, where two colours separate two *series* and
 * direction has nothing to say.
 */
export function directionColors(up: boolean) {
  const rgb = up ? "34, 197, 94" : "239, 68, 68";
  return {
    lineColor: up ? UP : DOWN,
    topColor: `rgba(${rgb}, 0.28)`,
    bottomColor: `rgba(${rgb}, 0.0)`,
  };
}

/** Whether a series ended above where it started. Flat counts as up, as percentages do. */
export function roseOverPeriod(values: number[]): boolean {
  const real = values.filter((v) => Number.isFinite(v));
  if (real.length < 2) return true;
  return real[real.length - 1]! >= real[0]!;
}
