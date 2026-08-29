package app.contour.local;

import android.app.ActivityManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebView;

import android.os.SystemClock;

import androidx.activity.OnBackPressedCallback;
import androidx.core.splashscreen.SplashScreen;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * How long the launch window may be held waiting for the WebView.
     *
     * The hold exists to remove a blank frame, not to become one. If the page
     * never lays out — a corrupt asset, a WebView that will not start — the
     * splash must still come down and let the app show whatever it can.
     */
    private static final long SPLASH_HOLD_CAP_MS = 2_500;

    /**
     * Frames to keep the splash after the page reports itself loaded.
     *
     * A WebView paints its background colour before it composites content, so
     * "loaded" and "on screen" are not the same frame. Without this the splash
     * came down onto a screen of bare ground and the mark was missing for about
     * a tenth of a second — measured at 1.50s to 1.62s in a recording, every
     * pixel of it #0a0a0a.
     */
    private static final int SPLASH_SETTLE_FRAMES = 2;

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

        handleBackButton();
        keepPortfolioOutOfRecents();
        brandTheRecentsCard();
    }

    /**
     * Keep the launch window up until the WebView has something to show.
     *
     * The system splash comes down on the activity's first draw, which happens
     * long before the WebView has a document — so the identical picture the app
     * draws for itself (the same disc, the same size, on the same ground) was
     * separated from the system's by a frame of bare colour. Held, the handover
     * is invisible: the disc never leaves the screen.
     *
     * `getContentHeight()` is the signal because it is the cheapest thing that
     * means "this document has been laid out". The condition is re-evaluated on
     * every pre-draw by the library, so nothing polls and nothing sleeps.
     *
     * The cap is not a fallback for a slow phone — it is the guarantee that a
     * broken one still gets past this screen. See SPLASH_HOLD_CAP_MS.
     */
    private void holdSplashUntilWebViewPaints(SplashScreen splash) {
        final long startedAt = SystemClock.uptimeMillis();
        final int[] settled = { 0 };
        splash.setKeepOnScreenCondition(() -> {
            if (SystemClock.uptimeMillis() - startedAt > SPLASH_HOLD_CAP_MS) return false;
            WebView webView = getBridge().getWebView();
            if (webView == null) return true;
            // getContentHeight() alone was the first attempt, and it is true at
            // the document's first layout — long before anything is drawn.
            if (webView.getProgress() < 100 || webView.getContentHeight() == 0) return true;
            // The condition is re-evaluated on every pre-draw, so counting them
            // is counting frames. Nothing polls and nothing sleeps.
            return ++settled[0] <= SPLASH_SETTLE_FRAMES;
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
