package app.contour.local;

import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

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
     * screenshots working while the app is actually in use. Setting it once in
     * onCreate would also block screenshots and screen recording permanently —
     * airtight, and more than was asked for.
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
