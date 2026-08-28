/**
 * The TradingView attribution.
 *
 * This is not decoration and not optional. Lightweight Charts is Apache 2.0,
 * and its terms additionally ask for the attribution notice and a link to
 * tradingview.com on a page the user can reach. Its on-chart logo is one way
 * to satisfy that; this is ours, which is why `attributionLogo: false` is set
 * on every chart in the app.
 *
 * It lives in `packages/ui` because there are two apps now and both draw those
 * charts. A device build that shipped the charts without this would be a
 * licence breach, and the version that stayed behind in one app's `more/page`
 * was one copy away from becoming exactly that.
 */
export default function ChartCredit() {
  return (
    <>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400 mt-8 mb-2">
        Credits
      </h2>
      <p className="text-xs text-neutral-500">
        Charts by{" "}
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer noopener"
           className="text-blue-500">TradingView</a>
        {" "}— Lightweight Charts™, Copyright © 2023 TradingView, Inc.
      </p>
    </>
  );
}
