package app.contour.local;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The web layer's way of asking "was I opened by tapping a notification?"
 *
 * The background runner's notifications carry which asset they are about, and
 * the patched plugin puts that on the tap's launch intent (see
 * patches/@capacitor+background-runner…). MainActivity stashes it, because the
 * two moments it can arrive are both before the page can listen: a cold start
 * has no document yet, and a warm one delivers onNewIntent whenever Android
 * pleases. So the page *pulls* — on mount, on becoming visible, and when
 * MainActivity rings the doorbell event — and this hands over the pending
 * payload exactly once.
 *
 * A local plugin for the same reason BatteryOptimizationPlugin is: it is a
 * dozen lines of platform glue, and the alternative was a dependency.
 */
@CapacitorPlugin(name = "NotificationTap")
public class NotificationTapPlugin extends Plugin {

    /** The pending tap's payload, or null. Consuming clears it: a tap is one navigation, not a state. */
    @PluginMethod
    public void consume(PluginCall call) {
        JSObject result = new JSObject();
        result.put("extra", MainActivity.takePendingNotificationTap());
        call.resolve(result);
    }
}
