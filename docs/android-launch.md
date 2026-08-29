# The Android launch sequence

Opening Contour on a phone shows the mark four times before the portfolio
appears, and for months no two of them agreed. This is what draws each one,
which parts are ours, and — the expensive part — how the sizes actually
resolve, because almost none of it works the way the declarations suggest.

Everything below was measured on a **Galaxy S24** (1080×2340, 360dp wide, so a
device pixel ratio of 3) by stepping through screen recordings frame by frame.
Where something is inferred rather than measured, it says so.

## The four pictures

| # | What draws it | Controlled by |
|---|---|---|
| 1 | The launcher icon, on the home screen and expanding as the window opens | `mipmap-anydpi-v26/ic_launcher.xml` → `@color/contour_blue` + `drawable/ic_launcher_mark.xml` |
| 2 | Android's splash screen | `AppTheme.NoActionBarLaunch` → `windowSplashScreenAnimatedIcon` = `drawable/contour_splash_icon.xml` |
| 3 | The app's own splash, while SQLite opens | `apps/mobile/src/app/providers.tsx`, `MarkTile size={SPLASH_DISC_PX}` |
| 4 | The lock screen, where the mark travels to its resting place | `packages/ui/src/BiometricLock.tsx`, `LOCK_DISC_PX` |

All four now draw a **112dp** blue disc with the mark at 86% of it. That is
`MarkTile`'s rule, and the point of the whole exercise: the entrance is one
picture that moves, not four that replace each other.

## What cannot be changed

**Android 12 and above always show a splash screen.** An app chooses what is on
it — background colour, icon, an optional icon background — and never whether it
appears. That was the explicit purpose of replacing custom splash screens with
the `SplashScreen` API. There is no attribute, no listener and no theme that
suppresses picture 2.

**The launcher's mask is the launcher's.** An adaptive icon's layers are drawn
at 108dp and cropped to at most the central 72dp, in whatever shape the
launcher prefers — a circle on Pixel, a squircle on One UI. An app cannot
choose the shape. It can only choose whether the mask cuts through artwork or
through a filled ground.

We ship a **filled blue tile** and let the launcher decide the shape. The
alternative — the app's ground with a disc in the foreground, so the mark stays
circular under any mask — was built, shipped, and rejected on sight: on One UI
it left black corners around the blue.

## How the splash icon is sized

This is the part that cost the most, so it is written out in full.

`windowSplashScreenAnimatedIcon` **is** honoured by One UI. A diagnostic build
coloured the launcher icon magenta and the splash drawable green; the home
screen came up magenta and the splash came up green. Earlier reasoning that
Samsung substitutes the launcher icon was wrong.

But the icon's **size is not taken from the drawable**. Android scales the
drawable's *visible content* to fill a 288dp canvas, then masks the result to
the inner 192dp. Three shipped builds pin this down:

| What was declared | Visible content | Predicted | Measured |
|---|---|---|---|
| disc filling its viewport | the disc | 192dp (masked from 288) | 188dp |
| disc at 89% of its viewport | the disc | 192dp (masked from 288) | 188dp |
| disc at 59%, behind an opaque circle filling the viewport | the circle | 171dp | 172dp |

The first two rows are why declaring a smaller disc changed nothing at all:
with no other opaque content, **the disc is its own content**, so it is scaled
to fill 288dp whatever fraction the file claims, and the mask shows 192 of it.

The third row is the way out. `contour_splash_icon.xml` carries an **opaque
circle in the app's own ground colour, filling the viewport**. It is invisible —
`windowSplashScreenBackground` is that same colour — but it is opaque, so it is
what Android measures, and the blue disc then keeps the fraction it declares.

The viewport is **288**, the canvas itself, so the disc's units are dp and there
is no arithmetic left to get wrong: a disc of 112 units renders at 112dp.

> Sizing against 192 instead of 288 was the last mistake in this sequence — 192
> is the *masked result*, not the canvas. It produced a 172dp disc where 112 was
> asked for.

`contour_splash.xml` (the pre-31 launch window and the recents card) composes
the same vector, and must draw it in a **288dp box** for the same reason: ask
for 112 there and a 44dp disc arrives.

The 288/192 rule was derived from three data points on one phone. It matches
`core-splashscreen`'s own `splashscreen_icon_size_no_background` (288dp) and its
410dp mask with a 109dp stroke (leaving 192dp), which is good corroboration, but
it has not been checked on a second device.

## Why the launcher icon looked stale for a dozen installs

`versionCode` was a literal `1`, unchanged since the project was generated.
Samsung's launcher keys its icon cache on package plus versionCode, so **every
APK ever built looked like the same version** and the cache was never
invalidated. The home screen kept drawing an icon from an early build while the
app-open animation, which reads the icon fresh, drew the current one. The two
disagreed on screen and neither was wrong.

`android/app/build.gradle` now derives `versionCode` from minutes since
2026-01-01. It makes a build non-reproducible in that one field, which is the
point: a rebuild a launcher cannot tell apart is exactly the failure above.

## The handover from picture 2 to picture 3

The splash used to come down before the WebView had drawn anything, leaving a
gap of bare `#0a0a0a` with no mark on it. Two attempts guessed at readiness from
outside the WebView and both left a measurable hole:

- `getContentHeight() != 0` — true at the document's first layout. **120ms gap.**
- `progress == 100` plus five pre-draws — true while the renderer still has
  nothing composited. **70ms gap.**

Both had to fail: a WebView composites on its own thread, so counting the
host's frames cannot know when it has a picture. `MainActivity` now asks
`WebView.postVisualStateCallback`, which reports exactly when the document is
ready to be drawn, and releases the splash in its callback. A 2.5s cap remains
so a page that never loads cannot strand the app on the splash.

`setOnExitAnimationListener` removes the splash view outright rather than
animating it away. The default exit dissolves the splash icon over whatever is
beneath — and what is beneath is the same mark at the same size in the same
place, so the dissolve read as a flicker. A cut between identical frames is
invisible.

## Measuring it again

There is no device or emulator on the development machine, so every number here
came from a screen recording. `ffmpeg` is not installed either; Chrome decodes
the video instead. The method, in case it is needed again:

1. Serve the `.mp4` over the scratchpad's static server and open it in headless
   Chrome over CDP.
2. Seek a `<video>` element to fixed timestamps, `drawImage` each frame onto a
   canvas, and either tile them into a contact sheet or read pixels back.
3. Measure the disc by scanning one horizontal line for the extent of blue
   pixels; divide by the device pixel ratio to get dp.
4. Sample the centre pixel's colour to tell a gap (`#0a0a0a`) from a mark.

Colour is the sharpest instrument here. Giving each candidate drawable a
deliberately wrong colour answered in one launch a question that several rounds
of reasoning had got wrong twice.

## What holds it

- `scripts/icon-artwork.test.ts` — the splash icon keeps its ground circle and
  renders its disc at `LOCK_DISC_PX` against the 288dp canvas; the adaptive
  background stays the blue; the foreground stays the mark alone; the round and
  square legacy bitmaps are not the same file again.
- `packages/ui/src/lock-timing.test.ts` — the entrance fits inside the splash it
  plays over, and `SPLASH_DISC_PX` still agrees with `LOCK_DISC_PX`.
- `scripts/generate-icons.mjs` is the only place the mark's geometry is drawn.
  Both Android vectors are generated from it; the tests read the generated
  files, not the generator, because a commit that edits the generator without
  running it is the regression worth catching.

The ground circle is the one thing here that is invisible by design. Nothing
but its test would notice it going.
