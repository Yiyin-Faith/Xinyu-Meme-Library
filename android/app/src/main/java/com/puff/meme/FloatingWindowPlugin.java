package com.puff.meme;

import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "FloatingWindow")
public class FloatingWindowPlugin extends Plugin {
    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(status());
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (Settings.canDrawOverlays(getContext())) {
            call.resolve(status());
            return;
        }
        Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getContext().getPackageName()));
        startActivityForResult(call, intent, "overlayPermissionResult");
    }

    @ActivityCallback
    private void overlayPermissionResult(PluginCall call, ActivityResult result) {
        if (call != null) call.resolve(status());
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        if (enabled && !Settings.canDrawOverlays(getContext())) {
            call.resolve(status());
            return;
        }
        try {
            if (enabled) {
                ContextCompat.startForegroundService(getContext(), new Intent(getContext(), FloatingWindowService.class));
            } else {
                getContext().stopService(new Intent(getContext(), FloatingWindowService.class));
            }
            // Service lifecycle callbacks run on the main Looper. Do not sleep
            // here: blocking it would prevent the overlay service from adding
            // its view and make a valid permission look like a failed toggle.
            resolveWhenStateSettles(call, enabled, 0);
        } catch (Exception error) {
            call.reject("无法切换悬浮窗：" + (error.getMessage() == null ? "未知错误" : error.getMessage()), error);
        }
    }

    private void resolveWhenStateSettles(PluginCall call, boolean expectedEnabled, int attempt) {
        if (FloatingWindowService.isOverlayShowing() == expectedEnabled) {
            call.resolve(status());
            return;
        }
        if (attempt >= 10) {
            call.reject(expectedEnabled ? "悬浮按钮未能显示" : "悬浮窗没有关闭");
            return;
        }
        new Handler(Looper.getMainLooper()).postDelayed(
            () -> resolveWhenStateSettles(call, expectedEnabled, attempt + 1),
            50
        );
    }

    private JSObject status() {
        JSObject response = new JSObject();
        response.put("granted", Settings.canDrawOverlays(getContext()));
        response.put("enabled", FloatingWindowService.isOverlayShowing());
        return response;
    }
}
