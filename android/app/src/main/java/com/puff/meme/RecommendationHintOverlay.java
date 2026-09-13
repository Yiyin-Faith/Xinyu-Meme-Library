package com.puff.meme;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;

/**
 * Short-lived, non-focusable recommendation hint shown beside the floating ball.
 *
 * Keyword matching must not steal focus from the app the user is typing in, so
 * a match only raises this small hint. The mini library is opened only after an
 * explicit tap. Only matched tag names reach this class; input text is never
 * persisted or displayed here.
 */
final class RecommendationHintOverlay {
    private static final long AUTO_DISMISS_MS = 5_000L;
    private static final String FLOATING_PREFERENCES = "xinyu-floating-window";
    private static final String PREFERENCE_EDGE = "position-edge";
    private static final String PREFERENCE_Y_RATIO = "position-y-ratio";
    private static final String EDGE_LEFT = "left";
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private static WindowManager windowManager;
    private static View hintView;

    private RecommendationHintOverlay() { }

    static boolean show(Context context, List<String> tags) {
        if (context == null) return false;
        final Context appContext = context.getApplicationContext();
        final List<String> cleaned = cleanTags(tags);
        if (cleaned.isEmpty()) return false;
        if (!FloatingWindowService.isEnabledPreference(appContext) || !Settings.canDrawOverlays(appContext)) return false;

        // A process may have been recreated while the preference remains on.
        // Restart the sticky foreground service best-effort; the hint itself
        // remains independent and never needs the WebView to be open.
        if (!FloatingWindowService.isOverlayShowing()) {
            try { FloatingWindowService.start(appContext); } catch (Exception ignored) { }
        }

        if (Looper.myLooper() == Looper.getMainLooper()) return showNow(appContext, cleaned);
        MAIN.post(() -> showNow(appContext, cleaned));
        return true;
    }

    static void dismiss() {
        if (Looper.myLooper() == Looper.getMainLooper()) dismissNow();
        else MAIN.post(RecommendationHintOverlay::dismissNow);
    }

    private static boolean showNow(Context context, List<String> tags) {
        dismissNow();
        if (!FloatingWindowService.isEnabledPreference(context) || !Settings.canDrawOverlays(context)) return false;

        try {
            windowManager = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
            if (windowManager == null) return false;

            TextView hint = new TextView(context);
            hint.setText(hintText(tags));
            hint.setTextColor(Color.WHITE);
            hint.setTextSize(13f);
            hint.setGravity(Gravity.CENTER_VERTICAL);
            hint.setPadding(dp(context, 14), dp(context, 9), dp(context, 14), dp(context, 9));
            hint.setMaxWidth(dp(context, 248));
            hint.setMaxLines(2);
            hint.setEllipsize(TextUtils.TruncateAt.END);
            hint.setContentDescription("发现相关表情，点此查看");
            hint.setBackground(roundRect(Color.rgb(67, 111, 82), dp(context, 14)));
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) hint.setElevation(dp(context, 10));

            WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                overlayType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                    | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                    | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT
            );
            position(context, params);

            final List<String> selectedTags = Collections.unmodifiableList(new ArrayList<>(tags));
            hint.setOnClickListener(view -> {
                dismissNow();
                // Full recommendation UI is now an explicit user action.
                FloatingWindowService.showRecommendation(context, selectedTags);
            });

            windowManager.addView(hint, params);
            hintView = hint;
            MAIN.postDelayed(() -> {
                if (hintView == hint) dismissNow();
            }, AUTO_DISMISS_MS);
            return true;
        } catch (Exception ignored) {
            dismissNow();
            return false;
        }
    }

    private static void dismissNow() {
        MAIN.removeCallbacksAndMessages(null);
        if (windowManager != null && hintView != null) {
            try { windowManager.removeView(hintView); } catch (Exception ignored) { }
        }
        hintView = null;
        windowManager = null;
    }

    private static void position(Context context, WindowManager.LayoutParams params) {
        SharedPreferences preferences = context.getSharedPreferences(FLOATING_PREFERENCES, Context.MODE_PRIVATE);
        String edge = preferences.getString(PREFERENCE_EDGE, "right");
        float ratio = preferences.getFloat(PREFERENCE_Y_RATIO, 0.35f);
        if (!Float.isFinite(ratio)) ratio = 0.35f;
        ratio = Math.max(0f, Math.min(1f, ratio));

        DisplayMetrics metrics = context.getResources().getDisplayMetrics();
        int minY = dp(context, 12);
        int maxY = Math.max(minY, metrics.heightPixels - dp(context, 96));
        int bubbleY = minY + Math.round((maxY - minY) * ratio);

        params.gravity = Gravity.TOP | (EDGE_LEFT.equals(edge) ? Gravity.START : Gravity.END);
        // The floating ball is 56dp wide; leave a small visual gap beside it.
        params.x = dp(context, 68);
        params.y = Math.max(minY, Math.min(maxY, bubbleY));
    }

    private static String hintText(List<String> tags) {
        if (tags.size() == 1) return "发现相关表情  #" + tags.get(0) + "\n点此查看";
        return "发现 " + tags.size() + " 个相关标签\n点此查看";
    }

    private static List<String> cleanTags(List<String> tags) {
        if (tags == null || tags.isEmpty()) return Collections.emptyList();
        LinkedHashSet<String> unique = new LinkedHashSet<>();
        for (String tag : tags) {
            String value = tag == null ? "" : tag.trim();
            if (!value.isEmpty()) unique.add(value);
        }
        return new ArrayList<>(unique);
    }

    private static int overlayType() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            : WindowManager.LayoutParams.TYPE_PHONE;
    }

    private static GradientDrawable roundRect(int color, int radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(radius);
        drawable.setStroke(1, Color.argb(70, 255, 255, 255));
        return drawable;
    }

    private static int dp(Context context, int value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }
}
