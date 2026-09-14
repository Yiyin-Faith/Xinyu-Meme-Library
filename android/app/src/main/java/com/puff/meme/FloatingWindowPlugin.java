package com.puff.meme;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.util.List;

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
            RecommendationHintOverlay.dismiss();
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
                RecommendationHintOverlay.dismiss();
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


    /**
     * Shares one app-private prepared image through a fresh Android chooser.
     * This path is intentionally stateless so closing one chooser cannot leave
     * the floating mini library unable to share the next image.
     */
    @PluginMethod
    public void sharePreparedFile(PluginCall call) {
        String relativePath = call.getString("path", "").trim();
        String mime = call.getString("mime", "image/*").trim();
        String title = call.getString("title", "").trim();
        String dialogTitle = call.getString("dialogTitle", "发送这个表情");
        try {
            File filesRoot = getContext().getFilesDir().getCanonicalFile();
            File shareRoot = new File(filesRoot, "xinyu-share").getCanonicalFile();
            File target = new File(filesRoot, relativePath).getCanonicalFile();
            String sharePrefix = shareRoot.getPath() + File.separator;
            if (!target.getPath().startsWith(sharePrefix) || !target.isFile()) {
                call.reject("分享文件不存在或路径无效");
                return;
            }
            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                target
            );
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime.isEmpty() ? "image/*" : mime);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            if (!title.isEmpty()) send.putExtra(Intent.EXTRA_TITLE, title);
            send.setClipData(ClipData.newRawUri("xinyu-meme", uri));
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, dialogTitle);
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Activity activity = getActivity();
            if (activity != null && !activity.isFinishing()) activity.startActivity(chooser);
            else {
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(chooser);
            }
            call.resolve();
        } catch (Exception error) {
            call.reject("无法打开系统分享：" + (error.getMessage() == null ? "未知错误" : error.getMessage()), error);
        }
    }

    /**
     * Persist a metadata-only mirror of the existing IndexedDB library so the
     * foreground service can recover after an Activity/service restart.
     */
    @PluginMethod
    public void syncMiniCatalog(PluginCall call) {
        JSArray items = call.getArray("items", new JSArray());
        List<String> missing = FloatingWindowService.syncMiniCatalog(getContext(), items);
        JSArray missingIds = new JSArray();
        for (String id : missing) missingIds.put(id);
        JSObject result = new JSObject();
        result.put("missingThumbnailIds", missingIds);
        call.resolve(result);
    }

    /**
     * Receives an asynchronously generated WebView page. WebView's
     * evaluateJavascript cannot await a Promise return value, so this is the
     * reliable callback path from IndexedDB to the active overlay.
     */
    @PluginMethod
    public void deliverMiniSnapshot(PluginCall call) {
        String requestId = call.getString("requestId", "");
        JSObject snapshot = call.getObject("snapshot", new JSObject());
        if (!requestId.trim().isEmpty()) FloatingWindowService.deliverMiniSnapshot(getContext(), requestId, snapshot);
        call.resolve();
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
