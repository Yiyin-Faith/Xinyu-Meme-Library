package com.puff.meme;

import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;

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
        boolean enableAfterGrant = call.getBoolean("enableAfterGrant", false);
        if (Settings.canDrawOverlays(getContext())) {
            if (enableAfterGrant) {
                FloatingWindowService.clearEnableAfterGrantPending(getContext());
                FloatingWindowService.setEnabledPreference(getContext(), true);
                startAndResolve(call);
            } else {
                call.resolve(status());
            }
            return;
        }
        if (enableAfterGrant) FloatingWindowService.setEnableAfterGrantPending(getContext(), true);
        Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getContext().getPackageName()));
        startActivityForResult(call, intent, "overlayPermissionResult");
    }

    @ActivityCallback
    private void overlayPermissionResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        boolean enableAfterGrant = call.getBoolean("enableAfterGrant", false);
        if (enableAfterGrant && Settings.canDrawOverlays(getContext())) {
            FloatingWindowService.clearEnableAfterGrantPending(getContext());
            FloatingWindowService.setEnabledPreference(getContext(), true);
            startAndResolve(call);
            return;
        }
        if (enableAfterGrant) FloatingWindowService.clearEnableAfterGrantPending(getContext());
        call.resolve(status());
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        if (enabled && !Settings.canDrawOverlays(getContext())) {
            FloatingWindowService.setEnabledPreference(getContext(), false);
            call.resolve(status());
            return;
        }
        try {
            if (enabled) {
                FloatingWindowService.clearEnableAfterGrantPending(getContext());
                FloatingWindowService.setEnabledPreference(getContext(), true);
                FloatingWindowService.start(getContext());
            } else {
                FloatingWindowService.clearEnableAfterGrantPending(getContext());
                FloatingWindowService.setEnabledPreference(getContext(), false);
                FloatingWindowService.stop(getContext());
            }
            // Service lifecycle callbacks run on the main Looper. Do not sleep
            // here: blocking it would prevent the overlay service from adding
            // its view and make a valid permission look like a failed toggle.
            resolveWhenStateSettles(call, enabled, 0);
        } catch (Exception error) {
            call.reject("无法切换悬浮窗：" + (error.getMessage() == null ? "未知错误" : error.getMessage()), error);
        }
    }

    @PluginMethod
    public void setOpacity(PluginCall call) {
        double requested = call.getDouble("opacity", 0.82d);
        FloatingWindowService.setOpacity(getContext(), (float) requested);
        call.resolve(status());
    }

    private void startAndResolve(PluginCall call) {
        try {
            FloatingWindowService.start(getContext());
            resolveWhenStateSettles(call, true, 0);
        } catch (Exception error) {
            FloatingWindowService.setEnabledPreference(getContext(), false);
            call.reject("无法开启悬浮窗：" + (error.getMessage() == null ? "未知错误" : error.getMessage()), error);
        }
    }

    private void resolveWhenStateSettles(PluginCall call, boolean expectedEnabled, int attempt) {
        if (FloatingWindowService.isOverlayShowing() == expectedEnabled) {
            call.resolve(status());
            return;
        }
        if (attempt >= 40) {
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
        response.put("enabled", Settings.canDrawOverlays(getContext()) && FloatingWindowService.isOverlayShowing());
        response.put("opacity", FloatingWindowService.getOpacity(getContext()));
        return response;
    }
}
