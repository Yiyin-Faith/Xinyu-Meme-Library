package com.puff.meme;

import android.content.Intent;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;

/** Narrow bridge for the opt-in accessibility recommendation setting. */
@CapacitorPlugin(name = "AccessibilityRecommendation")
public class AccessibilityRecommendationPlugin extends Plugin {
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
        startActivityForResult(call, new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS), "accessibilityRecommendationPermissionResult");
    }

    @ActivityCallback
    private void accessibilityPermissionResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        MemeRecommendationPreferences.completePendingRequest(getContext());
        call.resolve(status());
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
}
