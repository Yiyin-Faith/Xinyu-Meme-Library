package com.puff.meme;

import android.provider.Settings;
import android.webkit.ValueCallback;
import android.webkit.WebView;

import java.lang.ref.WeakReference;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static WeakReference<MainActivity> activeActivity = new WeakReference<>(null);

    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(BackupExportPlugin.class);
        registerPlugin(FloatingWindowPlugin.class);
        registerPlugin(AccessibilityRecommendationPlugin.class);
        super.onCreate(savedInstanceState);
        activeActivity = new WeakReference<>(this);
        // Existing versions may have cached share copies under the app's
        // external directory. Mark that package-owned root as non-media on
        // every launch so an upgrade also repairs old gallery indexes.
        MediaStorageIsolation.protect(getApplicationContext());
    }

    @Override
    public void onResume() {
        super.onResume();
        // The overlay permission page is a system Activity and does not always
        // deliver a useful result code. Keep a pending user request and finish
        // enabling as soon as this Activity becomes visible again after grant.
        if (FloatingWindowService.isEnableAfterGrantPending(this) && Settings.canDrawOverlays(this)) {
            FloatingWindowService.clearEnableAfterGrantPending(this);
            FloatingWindowService.setEnabledPreference(this, true);
            FloatingWindowService.start(this);
        }
        MemeRecommendationPreferences.completePendingRequest(this);
        MemeRecommendationPreferences.reconcilePermission(this);
    }

    @Override
    public void onDestroy() {
        MainActivity current = activeActivity.get();
        if (current == this) activeActivity = new WeakReference<>(null);
        super.onDestroy();
    }

    /**
     * The system overlay intentionally has no second meme database. It asks
     * the already-loaded Capacitor WebView for a small current page of
     * thumbnails or for a share action against the existing IndexedDB entry.
     */
    public static boolean evaluateFloatingJavascript(String script, ValueCallback<String> callback) {
        MainActivity activity = activeActivity.get();
        if (activity == null || activity.isFinishing() || activity.getBridge() == null) return false;
        activity.runOnUiThread(() -> {
            if (activity.isFinishing() || activity.getBridge() == null) {
                if (callback != null) callback.onReceiveValue("false");
                return;
            }
            WebView webView = activity.getBridge().getWebView();
            if (webView != null) webView.evaluateJavascript(script, callback);
            else if (callback != null) callback.onReceiveValue("false");
        });
        return true;
    }
}
