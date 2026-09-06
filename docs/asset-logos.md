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
- **`apps/mobile`** fetches each logo the first time a holding needs it and
  keeps it in the app's cache directory. A device has no proxy, so this tells
  the CDN which assets are held. That is a real cost and it was taken
  deliberately — see **Why the logos are no longer bundled** below.

Anything with no logo gets coloured initials, which is the honest answer and
already looks deliberate.

`scripts/icon-index.mjs` writes the three small data files the device needs to
find a logo without shipping one: which tickers the CC0 set has, the CoinGecko
image URL for the coins it lacks, and the upstream renames. Names and URLs, not
artwork.

```bash
node scripts/icon-index.mjs          # after editing scripts/icon-tickers.json
```

## Why the logos are no longer bundled

The device shipped 274 logos inside the APK until 31 August 2026. It stopped
because we do not have the right to redistribute them.

| upstream | what it says | verdict |
|---|---|---|
| `spothq/cryptocurrency-icons` | CC0 1.0, public domain | fine, and always was |
| CoinGecko | names logos and trademarks; "not permitted to copy, replicate, modify, extract, download or howsoever use… without prior written consent". The API terms prohibit redistribution outright; it is an Enterprise negotiation. | no |
| `assets.parqet.com` | nothing at all. The terms grant a personal, non-transferable licence to use the service and say nothing about the asset host. Parqet is itself an aggregator and owns none of the marks. | no |

Underneath all three, the marks belong to Apple, Shell, ING and the projects —
not to the aggregator serving them. Using a logo to identify the company whose
price is on screen is a defensible referential use; it is not a licence, and
F-Droid screens for exactly this (issue #20).

**Fetching at runtime is not redistribution.** The phone asks the CDN directly,
the way a browser does, and the app ships no copies. That removes us from the
redistribution path entirely, which bundling could never do.

**What it costs.** A request for a logo names the asset in its path, so the CDN
learns that whoever asked holds that ticker. Fetching *every* logo rather than
the held subset would have avoided that — the same trick `privateCoinPrices`
uses against Binance, and about 1.3 MB once. It was considered and not taken:
the decision (2026-08-31) is that only what a portfolio contains is fetched.
Written here rather than left to be discovered, because the bundle existed to
prevent precisely this and a reader is entitled to know it stopped.

**spothq first, CoinGecko only for what it lacks.** Not a preference for the
artwork — spothq is a stylised set whose last commit was August 2022, and
CoinGecko carries the marks the projects actually use. It is first because it
is the one licence that permits anything, so the fewer requests that go
elsewhere, the smaller the part of this that rests on nobody having objected.
Which tickers it has ships as a list of names, so a miss costs no request.

**A cold start after a reinstall shows initials briefly**, and a phone with no
network shows them until it has one. Everything else works offline as before;
this is the one thing that does not.

## What is behind a logo

`CoinIcon` draws each logo in a `rounded-full` span, and the span may or may not
have a white background. Which of those it is, is decided per logo, from the
artwork — and the reason is that the 274 logos measured are not one kind of
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
node scripts/logo-disc.mjs           # reuses anything already downloaded
node scripts/logo-disc.mjs --fresh   # re-downloads first
```

**It downloads the artwork to measure it**, into a gitignored `.logo-measure/`,
resolving each logo exactly as the device does. That is new: it used to read
the bundle, and there is no bundle. Committing what it downloads would put the
artwork back in the repository, which is the thing the runtime fetch exists to
stop.

## What holds it

`scripts/logo-discs.test.ts` checks the invariants that survive without the
artwork: that the split has not collapsed to one answer, that Immutable X — the
black-on-transparent mark the white disc was introduced for — is never in the
discless list, and that every entry is a bare asset rather than a pair.

**It no longer re-measures, and that is a loss worth naming.** It used to
recompute the choices from the bundled artwork and compare, which caught the
failure that matters: new artwork with an old decision, drawing a logo on the
ground it was measured not to suit. Re-measuring now means downloading from
three CDNs inside a unit test — slow, flaky, and failing on a train. So the
check moved into `logo-disc.mjs`, which is run deliberately, and a stale list is
no longer caught for you.

A logo nobody has measured — a coin listed since the last run — gets the white
disc. That is the safe default: it is the one that prevents a black mark
becoming a hole, and its failure mode is a pale mark washing out, which is
milder and rarer.

## If a logo looks wrong

1. Is it in the bundle? `apps/mobile/public/icons/index.json`. If not, the
   initials are correct and the fix is `scripts/icon-tickers.json` plus a
   re-bundle.
2. Is the white part of the logo? Open the PNG. If its corners are opaque
   white, that is the source artwork and nothing in this app put it there.
3. Otherwise it is the disc, and the answer is a measurement:
   `node scripts/logo-disc.mjs` prints what it decided and why the list changed.
