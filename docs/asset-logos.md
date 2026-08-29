# Asset logos

Every holding, market row and asset page draws a logo. Where those come from is
a privacy decision, and what sits behind them is a measurement — neither is
obvious from the markup, and both have been got wrong once.

## Two delivery paths, for one reason

`CoinIcon` never names a URL. It takes an `IconSource` from context and asks it
for one, because the two builds must get logos differently:

- **`apps/web`** proxies through `GET /api/icon`, which fetches each logo once
  and caches it in `.icon-cache/` at the repository root. The browser asks the
  app; the app asks the CDN. No third party learns which assets are held.
- **`apps/mobile`** ships the logos inside the APK
  (`apps/mobile/public/icons/assets/`, listed in `index.json`). A device has no
  proxy, and calling a CDN from the phone would quietly break the promise the
  proxy exists to keep — in an app whose whole pitch is that the portfolio does
  not leave the phone.

Anything with no logo gets coloured initials, which is the honest answer and
already looks deliberate.

`scripts/bundle-icons.mjs` builds the bundle, by hand rather than at build time:
a build that fetched would need a network, would not be reproducible, and would
fail exactly where the app is meant to work offline. Its upstreams are the ones
`/api/icon` uses — CoinGecko for coins, `spothq/cryptocurrency-icons` as a
fallback for older ones, `assets.parqet.com` for equities. Change one, change
the other, or the two builds show different logos for the same asset.

```bash
node scripts/bundle-icons.mjs        # after editing scripts/icon-tickers.json
```

## What is behind a logo

`CoinIcon` draws each logo in a `rounded-full` span, and the span may or may not
have a white background. Which of those it is, is decided per logo, from the
artwork — and the reason is that the 274 bundled logos are not one kind of
image but four:

| kind | count | what shows behind the mark |
|---|---|---|
| a colour baked into the PNG | 153 | nothing of ours — the logo fills the circle |
| fully transparent | 81 | **our disc** |
| **white** baked into the PNG | 36 | the logo's own white — Shell, Microsoft, ING |
| mixed | 4 | usually the logo's own |

Those 36 are the mark as its owner draws it. The app does not touch them, and
"the icons have a white background" is, for an equity, usually this rather than
anything the app added.

Of all 274, the disc is **visible on only 35**. The rest fill the circle, and
`rounded-full` crops the corners where a disc would otherwise peek out — which
is why Immutable X and Aptos look like black tiles rather than dark marks on
white.

## Why the disc colour is measured rather than chosen

A single colour cannot serve every logo, and both failures are real:

- **Without a disc**, a black-on-transparent mark disappears. CoinGecko serves
  Immutable X as pure black; on this app's `#0a0a0a` ground it was a hole where
  a logo should be. APT, ZRX and NMR were barely better.
- **On white**, a pale mark washes out. GAS covers 83% of its disc and meets
  white at 1.59:1; THETA, HOT, NEO and ZEC are no better.

So `scripts/logo-disc.mjs` decides per logo, from the pixels:

- Only pixels inside the inscribed circle count, because `rounded-full` crops
  the rest. This is what separates the 35 that matter from the 239 that do not.
- The colour compared is the ink **near the rim**, not the average over the
  whole mark. A logo's centre can be any colour it likes; what has to be told
  apart from the background is the edge that touches it.
- WCAG contrast against white and against the app's ground; the better one wins.
- Below 8% of the circle showing, the disc is covered and the setting is
  unobservable, so white stays rather than churning.

**23 logos come out discless.** Worst contrast after the split is **4.48:1**,
against **1.59:1** before it, and **4.16:1** on a card surface rather than the
page ground — checked, because a discless logo takes whichever surface is behind
it. Dropping the disc for *everything* would have taken the worst case to
1.02:1, which is worse than doing nothing.

The result is `packages/core/src/logo-discs.ts`, generated. Do not edit it, and
do not set a disc colour by hand in a component:

```bash
node scripts/logo-disc.mjs           # regenerate from the bundle already on disk
```

`bundle-icons.mjs` calls it as its last step, so a refreshed bundle cannot leave
a stale manifest behind.

## What holds it

`scripts/logo-discs.test.ts` recomputes the choices from the bundled artwork and
compares them to the committed manifest. That is the failure worth catching:
**new artwork with an old decision**, which draws a logo on the ground it was
measured not to suit, and which nothing else would notice — the two files are
written by different commands.

It also checks that the manifest names only tickers that are bundled, that the
split has not collapsed to one answer (a resize or a threshold edit could do
that silently), and that Immutable X — the case the white disc was introduced
for — still keeps it.

The rule itself lives in one module, imported by the bundler, the regenerate
command and the test, so none of them can hold a different opinion about it.

## If a logo looks wrong

1. Is it in the bundle? `apps/mobile/public/icons/index.json`. If not, the
   initials are correct and the fix is `scripts/icon-tickers.json` plus a
   re-bundle.
2. Is the white part of the logo? Open the PNG. If its corners are opaque
   white, that is the source artwork and nothing in this app put it there.
3. Otherwise it is the disc, and the answer is a measurement:
   `node scripts/logo-disc.mjs` prints what it decided and why the list changed.
