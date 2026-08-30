package app.contour.local;

import android.content.Context;
import android.content.Intent;
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
 * So the exemption is worth surfacing, plainly, during setup rather than in a
 * support page months later. The person can say no; the app still checks every
 * time it is opened.
 *
 * No Capacitor plugin ships this. It is about sixty lines of platform API, and
 * the alternative was a dependency for two calls.
 *
 * **This deliberately does not use the one-tap dialog.**
 * ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS shows Android's own allow/deny
 * prompt, and it needs REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, which Google Play
 * prohibits outside a short list of categories — calling apps, safety apps,
 * task automation, peripheral companions. A price-alert tracker is on none of
 * them. So this opens ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS instead: the
 * same destination, no permission, one tap further away because the person has
 * to find Contour in a list. Reading the current state needs no permission
 * either, so the screen still knows whether to offer this at all.
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
     * Open the battery-optimisation list, then answer with what it left in
     * place.
     *
     * The result is read after the activity returns rather than trusted from
     * the intent: the screen reports no result of its own, and a person can
     * back out without changing anything — which, since they have to find this
     * app in a list first, is a likelier outcome here than it was with the
     * one-tap dialog this replaced.
     */
    @PluginMethod
    public void request(PluginCall call) {
        if (isIgnoringOptimizations()) {
            JSObject already = new JSObject();
            already.put("exempt", true);
            call.resolve(already);
            return;
        }

        startActivityForResult(
            call, new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS), "afterRequest");
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
