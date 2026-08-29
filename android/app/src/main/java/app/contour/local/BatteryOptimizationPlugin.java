package app.contour.local;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Asking Android to stop holding the alert check back.
 *
 * The app schedules a periodic background job to check price alerts while it
 * is shut. Android runs that job when it feels like it, and on a phone with
 * battery optimisation applied to this app — the default for everything — it
 * may defer it for hours or never run it at all. Nothing in the app can detect
 * that: the job simply does not happen, and the only symptom is a notification
 * that never arrives, which is indistinguishable from a market that did not
 * move.
 *
 * So the exemption is worth asking for, and it is worth asking for *plainly*,
 * as one system dialog during setup rather than a support page months later.
 * The person can say no; the app still checks every time it is opened.
 *
 * No Capacitor plugin ships this. It is about sixty lines of platform API, and
 * the alternative was a dependency for two calls.
 *
 * ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS shows the system's own
 * allow/deny dialog and needs the matching permission. Google Play restricts
 * apps that declare it to a short list of categories; this app is not
 * distributed there — it is built from source and sideloaded — so the direct
 * dialog is both allowed and much kinder than sending someone into Settings to
 * find the app in a list. Where the intent cannot be resolved, the battery
 * settings screen is the fallback rather than an error.
 */
@CapacitorPlugin(name = "BatteryOptimization")
public class BatteryOptimizationPlugin extends Plugin {

    /**
     * Whether the background job is already free to run.
     *
     * Below API 23 there is no doze and nothing to be exempt from, so it
     * answers true — the screen then has nothing to offer, which is right.
     */
    @PluginMethod
    public void isExempt(PluginCall call) {
        JSObject result = new JSObject();
        result.put("exempt", isIgnoringOptimizations());
        call.resolve(result);
    }

    /**
     * Show the system dialog, then answer with what it left in place.
     *
     * The result is read after the activity returns rather than trusted from
     * the intent: the dialog reports no result of its own, and a person can
     * dismiss it without choosing.
     */
    @PluginMethod
    public void request(PluginCall call) {
        if (isIgnoringOptimizations()) {
            JSObject already = new JSObject();
            already.put("exempt", true);
            call.resolve(already);
            return;
        }

        Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
        if (intent.resolveActivity(getContext().getPackageManager()) == null) {
            // Some builds hide the direct request. The list is worse but real.
            intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
        }
        startActivityForResult(call, intent, "afterRequest");
    }

    @com.getcapacitor.annotation.ActivityCallback
    private void afterRequest(PluginCall call, androidx.activity.result.ActivityResult result) {
        if (call == null) return;
        JSObject out = new JSObject();
        out.put("exempt", isIgnoringOptimizations());
        call.resolve(out);
    }

    private boolean isIgnoringOptimizations() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        PowerManager power = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        if (power == null) return false;
        return power.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }
}
