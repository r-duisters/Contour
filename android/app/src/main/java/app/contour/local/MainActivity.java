package app.contour.local;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

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
