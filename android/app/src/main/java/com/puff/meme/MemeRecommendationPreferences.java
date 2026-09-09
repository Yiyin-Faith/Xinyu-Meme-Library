package com.puff.meme;

import android.accessibilityservice.AccessibilityService;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.provider.Settings;
import android.text.TextUtils;

/** Preferences for the optional on-device accessibility recommendation feature.
 *
 * This class deliberately stores only the user's feature choice and matching
 * mode. It never stores tags or any text read from another application's input
 * field. Tags live only in the accessibility service's process memory.
 */
public final class MemeRecommendationPreferences {
    public static final String MODE_EXACT = "exact";
    public static final String MODE_CONTAINS = "contains";

    private static final String PREFERENCES = "xinyu-meme-recommendation";
    private static final String PREFERENCE_ENABLED = "enabled";
    private static final String PREFERENCE_PENDING = "enable-after-grant";
    private static final String PREFERENCE_MODE = "match-mode";

    private MemeRecommendationPreferences() {
    }

    public static boolean isProcessingEnabled(Context context) {
        return preferences(context).getBoolean(PREFERENCE_ENABLED, false);
    }

    public static void setProcessingEnabled(Context context, boolean enabled) {
        preferences(context).edit().putBoolean(PREFERENCE_ENABLED, enabled).apply();
    }

    public static boolean isEnableAfterGrantPending(Context context) {
        return preferences(context).getBoolean(PREFERENCE_PENDING, false);
    }

    public static void setEnableAfterGrantPending(Context context, boolean pending) {
        preferences(context).edit().putBoolean(PREFERENCE_PENDING, pending).apply();
    }

    public static String getMatchMode(Context context) {
        String mode = preferences(context).getString(PREFERENCE_MODE, MODE_EXACT);
        return MODE_CONTAINS.equals(mode) ? MODE_CONTAINS : MODE_EXACT;
    }

    public static void setMatchMode(Context context, String mode) {
        preferences(context).edit().putString(PREFERENCE_MODE, MODE_CONTAINS.equals(mode) ? MODE_CONTAINS : MODE_EXACT).apply();
    }

    public static boolean isAccessibilityServiceEnabled(Context context) {
        String enabledServices = Settings.Secure.getString(
            context.getContentResolver(),
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        );
        if (TextUtils.isEmpty(enabledServices)) return false;

        ComponentName component = new ComponentName(context, MemeRecommendationAccessibilityService.class);
        String expected = component.flattenToString();
        String expectedShort = component.flattenToShortString();
        TextUtils.SimpleStringSplitter splitter = new TextUtils.SimpleStringSplitter(':');
        splitter.setString(enabledServices);
        while (splitter.hasNext()) {
            String enabled = splitter.next();
            if (expected.equalsIgnoreCase(enabled) || expectedShort.equalsIgnoreCase(enabled)) return true;
        }
        return false;
    }

    /** Complete a request after returning from Android's accessibility settings. */
    public static void completePendingRequest(Context context) {
        if (!isEnableAfterGrantPending(context)) return;
        setEnableAfterGrantPending(context, false);
        setProcessingEnabled(context, isAccessibilityServiceEnabled(context));
    }

    /** Reconcile a user-revoked system permission without any polling. */
    public static void reconcilePermission(Context context) {
        if (!isAccessibilityServiceEnabled(context) && !isEnableAfterGrantPending(context)) {
            setProcessingEnabled(context, false);
        }
    }

    private static SharedPreferences preferences(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }
}
