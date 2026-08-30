package app.contour.local;

import android.app.ActivityManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;

import android.os.SystemClock;

import androidx.activity.OnBackPressedCallback;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.splashscreen.SplashScreenViewProvider;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {

    /**
     * How long the launch window may be held waiting for the WebView.
     *
     * The hold exists to remove a blank frame, not to become one. If the page
     * never lays out — a corrupt asset, a WebView that will not start — the
     * splash must still come down and let the app show whatever it can.
     */
    private static final long SPLASH_HOLD_CAP_MS = 2_500;

    /** Any value; postVisualStateCallback only echoes it back to identify the request. */
    private static final long VISUAL_STATE_REQUEST = 1L;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Before super: Capacitor builds the bridge there, and a plugin
        // registered afterwards is not in it.
        registerPlugin(BatteryOptimizationPlugin.class);
        // Also before super, and before the first layout pass: this is what
        // applies `postSplashScreenTheme`, and what gives us the handle needed
        // to hold the launch window past its default single frame.
        SplashScreen splash = SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);

        holdSplashUntilWebViewPaints(splash);
        /*
         * Take the splash away without animating it.
         *
         * The default exit animates the icon out, which only ever made sense
         * when what lay beneath was a different screen. It is not: by the time
         * this runs the WebView has drawn the same mark, at the same size, in
         * the same place. Animating one away over the other is a dissolve
         * between two identical pictures, and on a real launch it reads as the
         * mark flickering.
         *
         * Removing it immediately is a cut, and a cut between two identical
         * frames is invisible.
         */
        splash.setOnExitAnimationListener(SplashScreenViewProvider::remove);

        // A WebView ignores downloads unless something is listening, and
        // Capacitor installs no listener — so "Install the latest build" did
        // nothing at all when tapped inside the app: no error, no download.
        // Hand the URL to the system instead, which fetches the APK and offers
        // to install it.
        getBridge().getWebView().setDownloadListener(
            (url, userAgent, contentDisposition, mimeType, contentLength) -> {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);
            }
        );

        recoverFromRendererDeath();
        handleBackButton();
        keepPortfolioOutOfRecents();
        brandTheRecentsCard();
    }

    /**
     * Come back from the WebView's renderer being killed.
     *
     * Android runs the WebView's renderer in its own process and kills it under
     * memory pressure. `BridgeWebViewClient.onRenderProcessGone` returns false
     * unless some listener claims the event, and false means "the app did not
     * handle this" — after which the framework kills the app. Registering
     * nothing was therefore a choice, just not one anybody made.
     *
     * Observed on an emulator: the renderer died, the app process survived, and
     * the screen went white and stayed white. Either outcome is what a person
     * meets on opening a portfolio tracker that sat in the background while
     * something hungrier ran in front of it.
     *
     * `recreate()` rather than `view.reload()`. A WebView whose renderer has
     * gone is documented as no longer usable, so reloading it asks a dead
     * object to fetch a page; recreating the activity builds a new one, and
     * Capacitor's `BridgeActivity` tears the old bridge down on the way out.
     * The device build can afford that because its state is in SQLite and not
     * in the page — a person loses the screen they were on and nothing else.
     *
     * The guard is the part worth having. A renderer that dies once is a
     * memory spike; one that dies immediately after being rebuilt is a
     * condition recreating cannot fix, and looping on it would spin the
     * process. Twice inside RENDERER_RETRY_WINDOW_MS and this stops trying and
     * returns true anyway, which leaves a blank screen — a screen the person
     * can back out of, rather than a restart loop they cannot.
     */
    private void recoverFromRendererDeath() {
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                final long now = SystemClock.uptimeMillis();
                final boolean recent = now - lastRendererDeathAt < RENDERER_RETRY_WINDOW_MS;
                lastRendererDeathAt = now;
                // True either way: the alternative is the framework killing the
                // process, which is strictly worse than what follows.
                if (recent) return true;
                // Off the callback, since this destroys the view it was
                // delivered to.
                view.post(MainActivity.this::recreate);
                return true;
            }
        });
    }

    /** When the renderer last died, so a second death in quick succession does not loop. */
    private long lastRendererDeathAt = 0;

    /** Long enough that a rebuilt renderer dying again means the cause has not passed. */
    private static final long RENDERER_RETRY_WINDOW_MS = 30_000;

    /**
     * Keep the launch window up until the WebView has something to show.
     *
     * The system splash comes down on the activity's first draw, which happens
     * long before the WebView has a document — so the identical picture the app
     * draws for itself (the same disc, the same size, on the same ground) was
     * separated from the system's by a frame of bare colour. Held, the handover
     * is invisible: the disc never leaves the screen.
     *
     * The condition is re-evaluated on every pre-draw by the library, so nothing
     * polls and nothing sleeps.
     *
     * The cap is not a fallback for a slow phone — it is the guarantee that a
     * broken one still gets past this screen. See SPLASH_HOLD_CAP_MS.
     */
    private void holdSplashUntilWebViewPaints(SplashScreen splash) {
        final long startedAt = SystemClock.uptimeMillis();
        final boolean[] asked = { false };
        final boolean[] drawable = { false };
        splash.setKeepOnScreenCondition(() -> {
            if (SystemClock.uptimeMillis() - startedAt > SPLASH_HOLD_CAP_MS) return false;
            if (drawable[0]) return false;
            WebView webView = getBridge().getWebView();
            if (webView == null) return true;
            // Two earlier attempts guessed at this from the outside and both
            // left a gap: getContentHeight() != 0 is true at the document's
            // first layout (a 120ms gap), and progress == 100 plus five
            // pre-draws is true while the renderer still has nothing composited
            // (70ms). A WebView draws on its own thread, so no amount of
            // counting the *host's* frames can know when it has a picture.
            //
            // postVisualStateCallback is the API that does: it reports when the
            // state of the document at the time of the call is ready to be
            // drawn. Asked for once the page has finished loading, its callback
            // is the moment the mark exists on screen.
            if (!asked[0] && webView.getProgress() == 100 && webView.getContentHeight() > 0) {
                asked[0] = true;
                // An abstract class, not an interface, so no lambda here.
                webView.postVisualStateCallback(VISUAL_STATE_REQUEST, new WebView.VisualStateCallback() {
                    @Override
                    public void onComplete(long requestId) {
                        drawable[0] = true;
                    }
                });
            }
            return true;
        });
    }

    /**
     * Make the blanked recents card look like this app rather than like a
     * default.
     *
     * With the recents screenshot disabled, Android does not render the
     * window background: it fills the card with a **solid colour**, so a
     * layer-list naming the mark is ignored and the fallback is the theme's
     * `colorBackground` — AppCompat's dark grey, which is what the card
     * showed. There is no supported way to draw the mark into the card body;
     * the only image Android takes is the task icon, which it puts in the
     * card's header beside the label.
     *
     * So: the app's own ground for the fill, and the launcher icon and name
     * for the header. `setPrimaryColor` rejects anything not fully opaque,
     * which `contour_ground` is.
     */
    private void brandTheRecentsCard() {
        final int ground = getColor(R.color.contour_ground);
        final String label = getString(R.string.title_activity_main);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            setTaskDescription(new ActivityManager.TaskDescription.Builder()
                .setLabel(label)
                .setIcon(R.mipmap.ic_launcher)
                .setPrimaryColor(ground)
                .build());
        } else {
            // The icon-by-resource constructor only arrived in API 28, and
            // below 33 the card is a photograph anyway — the colour is all
            // that is worth setting here.
            setTaskDescription(new ActivityManager.TaskDescription(label, null, ground));
        }
    }

    /**
     * Blank the app-switcher card without blanking the app.
     *
     * Android photographs the window as it goes to the background and uses
     * that image for the recents card, so an app left open on the portfolio
     * shows its balances to anyone who opens the task list — privacy mode
     * included, because the snapshot predates any toggle.
     *
     * This was FLAG_SECURE set in onPause and cleared in onResume. That is the
     * common recipe and it does not reliably work: the flag needs a window
     * relayout to take effect, and the system may photograph the window before
     * one happens. It was in the shipped APK and the balances were still on
     * the card.
     *
     * API 33 added the API that actually means this — it suppresses the
     * recents screenshot and nothing else, so screenshots and screen recording
     * keep working while the app is in use. Below 33 there is no such
     * separation, and the onPause toggle stays as the best available
     * approximation rather than taking screenshots away from every older
     * device to fix a card they may not even leak.
     */
    private void keepPortfolioOutOfRecents() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            setRecentsScreenshotEnabled(false);
        }
    }

    /**
     * Make the system back gesture walk the app's own history.
     *
     * Capacitor 8's BridgeActivity registers nothing for back, and
     * @capacitor/app is not installed, so Android's default applied: back
     * finished the activity and the app shut, from any screen, even four
     * pages deep.
     *
     * Registered on the OnBackPressedDispatcher rather than by overriding
     * onBackPressed(). At targetSdk 36 the predictive back gesture is on by
     * default and onBackPressed() is no longer called at all, so the override
     * would compile, look right, and never run.
     *
     * The WebView's history includes Next's client-side pushState entries, so
     * this walks the routes a person actually visited. When there is nothing
     * left to go back to, the callback disables itself and re-dispatches, which
     * hands the press to the system default — closing the app, which at the
     * first screen is the right answer.
     */
    private void handleBackButton() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge().getWebView();
                if (webView.canGoBack()) {
                    webView.goBack();
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
            }
        });
    }

    /** The pre-33 fallback; see keepPortfolioOutOfRecents above. */
    @Override
    public void onPause() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            // Before super: the system may capture as soon as the pause completes.
            getWindow().setFlags(
                WindowManager.LayoutParams.FLAG_SECURE,
                WindowManager.LayoutParams.FLAG_SECURE
            );
        }
        super.onPause();
    }

    @Override
    public void onResume() {
        super.onResume();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        }
    }
}
