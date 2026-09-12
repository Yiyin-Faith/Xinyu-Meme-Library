package com.puff.meme;

import android.content.ComponentName;
import android.content.Intent;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;

/** Narrow bridge for the opt-in accessibility recommendation setting. */
@CapacitorPlugin(name = "AccessibilityRecommendation")
public class AccessibilityRecommendationPlugin extends Plugin {
    // There is no stable public Android SDK action for a particular service's
    // detail screen. AOSP/compatible ROMs may handle this action; every other
    // device deliberately falls back to the documented accessibility list.
    private static final String ACTION_ACCESSIBILITY_DETAILS_SETTINGS = "android.settings.ACCESSIBILITY_DETAILS_SETTINGS";

    @PluginMethod
    public void getStatus(PluginCall call) {
        MemeRecommendationPreferences.reconcilePermission(getContext());
        call.resolve(status());
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        boolean enableAfterGrant = call.getBoolean("enableAfterGrant", false);
        if (MemeRecommendationPreferences.isAccessibilityServiceEnabled(getContext())) {
            if (enableAfterGrant) MemeRecommendationPreferences.setProcessingEnabled(getContext(), true);
            call.resolve(status());
            return;
        }
        if (enableAfterGrant) MemeRecommendationPreferences.setEnableAfterGrantPending(getContext(), true);
        openAccessibilitySettings(call);
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        if (enabled && !MemeRecommendationPreferences.isAccessibilityServiceEnabled(getContext())) {
            MemeRecommendationPreferences.setProcessingEnabled(getContext(), false);
            call.resolve(status());
            return;
        }
        MemeRecommendationPreferences.setEnableAfterGrantPending(getContext(), false);
        MemeRecommendationPreferences.setProcessingEnabled(getContext(), enabled);
        if (!enabled) MemeRecommendationAccessibilityService.noteRecommendationDismissed();
        call.resolve(status());
    }

    @PluginMethod
    public void setMatchMode(PluginCall call) {
        MemeRecommendationPreferences.setMatchMode(getContext(), call.getString("mode", MemeRecommendationPreferences.MODE_EXACT));
        call.resolve(status());
    }

    /** Tags are transient process memory only; no database or preferences copy. */
    @PluginMethod
    public void setTagIndex(PluginCall call) {
        JSArray values = call.getArray("tags", new JSArray());
        ArrayList<String> tags = new ArrayList<>();
        for (int index = 0; index < values.length(); index++) {
            String tag = values.optString(index, "");
            if (!tag.trim().isEmpty()) tags.add(tag);
        }
        MemeRecommendationAccessibilityService.setTagIndex(tags);
        call.resolve();
    }

    private JSObject status() {
        boolean granted = MemeRecommendationPreferences.isAccessibilityServiceEnabled(getContext());
        JSObject response = new JSObject();
        response.put("granted", granted);
        response.put("enabled", granted && MemeRecommendationPreferences.isProcessingEnabled(getContext()));
        response.put("mode", MemeRecommendationPreferences.getMatchMode(getContext()));
        return response;
    }

    private void openAccessibilitySettings(PluginCall call) {
        ComponentName service = new ComponentName(getContext(), MemeRecommendationAccessibilityService.class);
        Intent details = new Intent(ACTION_ACCESSIBILITY_DETAILS_SETTINGS);
        details.putExtra(Intent.EXTRA_COMPONENT_NAME, service.flattenToString());
        if (launchSettings(details)) {
            call.resolve(status());
            return;
        }
        Intent settings = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
        // This hint is ignored safely on Android versions that do not support
        // pre-selecting an accessibility service.
        settings.putExtra(Intent.EXTRA_COMPONENT_NAME, service.flattenToString());
        if (launchSettings(settings)) {
            call.resolve(status());
            return;
        }
        MemeRecommendationPreferences.setEnableAfterGrantPending(getContext(), false);
        call.reject("无法打开 Android 无障碍设置");
    }

    /**
     * Android's accessibility settings pages do not have a dependable result
     * contract. Resolving this bridge call after launch avoids keeping a
     * Capacitor Activity Callback alive under a callback name that may never
     * be returned. MainActivity and the visible WebView reconcile the real
     * service state when the user comes back to the app.
     */
    private boolean launchSettings(Intent intent) {
        try {
            if (intent.resolveActivity(getContext().getPackageManager()) == null) return false;
            getActivity().startActivity(intent);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }
}
