package app.contour.local;

import android.content.Intent;
import android.net.Uri;
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

    /**
     * Keep the portfolio out of the app-switcher.
     *
     * Android photographs the window as it goes to the background and uses
     * that image for the recents card, so an app left open on the portfolio
     * shows its balances to anyone who opens the task list — privacy mode
     * included, because the snapshot predates any toggle.
     *
     * FLAG_SECURE tells the system not to capture the window. Setting it on
     * pause and clearing it on resume blanks the snapshot while leaving
     * screenshots working while the app is actually in use.
     */
    @Override
    public void onPause() {
        // Before super: the system may capture as soon as the pause completes.
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        );
        super.onPause();
    }

    @Override
    public void onResume() {
        super.onResume();
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
    }
}
