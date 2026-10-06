package lk.blynk.ops;

import android.Manifest;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Asks for Android 13+ POST_NOTIFICATIONS so the "Sharing your location"
 * foreground-service notification of background tracking is shown in the
 * drawer. The background-geolocation plugin never asks for it (its issue #141).
 * JS side: src/lib/notification-permission.ts. Registered in MainActivity.
 *
 * check() / request() resolve { display: "granted" | "denied" | "prompt" }.
 * Below Android 13 (API 33) there is no runtime permission: always "granted".
 */
@CapacitorPlugin(
    name = "NotificationPermission",
    permissions = { @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = NotificationPermissionPlugin.DISPLAY) }
)
public class NotificationPermissionPlugin extends Plugin {

    static final String DISPLAY = "display";

    @PluginMethod
    public void check(PluginCall call) {
        call.resolve(result());
    }

    @PluginMethod
    public void request(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState(DISPLAY) == PermissionState.GRANTED) {
            call.resolve(result());
            return;
        }
        requestPermissionForAlias(DISPLAY, call, "displayPermissionCallback");
    }

    @PermissionCallback
    private void displayPermissionCallback(PluginCall call) {
        call.resolve(result());
    }

    private JSObject result() {
        JSObject ret = new JSObject();
        ret.put(DISPLAY, displayState());
        return ret;
    }

    private String displayState() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return "granted";
        PermissionState state = getPermissionState(DISPLAY);
        if (state == PermissionState.GRANTED) return "granted";
        if (state == PermissionState.DENIED) return "denied";
        return "prompt"; // PROMPT or PROMPT_WITH_RATIONALE
    }
}
