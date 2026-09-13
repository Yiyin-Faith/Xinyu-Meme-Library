package com.puff.meme;

import android.accessibilityservice.AccessibilityService;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Optional, event-driven keyword matching for the floating meme helper.
 *
 * Input from another app is intentionally only kept in a short-lived local
 * callback while it is matched. It is never logged, written to storage,
 * transmitted, or sent to another component. The only durable data here is the
 * user's own on/off setting and matching mode in MemeRecommendationPreferences.
 */
public class MemeRecommendationAccessibilityService extends AccessibilityService {
    private static final long INPUT_DEBOUNCE_MS = 260L;
    private static final long TAG_COOLDOWN_MS = 12_000L;
    private static final long SAME_INPUT_COOLDOWN_MS = 8_000L;
    private static final Object TAG_INDEX_LOCK = new Object();
    private static List<TagEntry> tagIndex = Collections.emptyList();
    private static volatile MemeRecommendationAccessibilityService activeService;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Map<String, Long> tagCooldowns = new HashMap<>();
    private int inputSequence = 0;
    private int lastInputFingerprint = 0;
    private long lastInputAt = 0L;
    private List<String> lastTriggeredTags = Collections.emptyList();

    /** Receives only existing user-owned tag names from the active WebView. */
    public static void setTagIndex(List<String> tags) {
        Set<String> seen = new HashSet<>();
        ArrayList<TagEntry> next = new ArrayList<>();
        for (String tag : tags) {
            String display = tag == null ? "" : tag.trim();
            String normalized = normalize(display);
            if (normalized.isEmpty() || !seen.add(normalized)) continue;
            next.add(new TagEntry(display, normalized));
        }
        synchronized (TAG_INDEX_LOCK) {
            tagIndex = Collections.unmodifiableList(next);
        }
    }

    public static void clearTagIndex() {
        synchronized (TAG_INDEX_LOCK) {
            tagIndex = Collections.emptyList();
        }
    }

    /** Called when the user explicitly closes a recommendation panel. */
    public static void noteRecommendationDismissed() {
        MemeRecommendationAccessibilityService service = activeService;
        if (service != null) service.handler.post(service::suppressCurrentRecommendation);
    }

    @Override
    public void onServiceConnected() {
        super.onServiceConnected();
        activeService = this;

        // A killed/recreated process loses the static tag index. Rehydrate it
        // from the existing private mini-library catalog so recommendation does
        // not depend on reopening the WebView. No external input text is read or
        // persisted here; only the user's own meme tags are recovered.
        restoreTagIndexFromCache();

        // The floating ball already runs as a sticky foreground service, but a
        // process recreation can leave only the persisted enabled preference.
        // Bring it back when both the preference and overlay permission still
        // say the user wants it. Never flip either setting on automatically.
        if (FloatingWindowService.isEnabledPreference(this)
                && Settings.canDrawOverlays(this)
                && !FloatingWindowService.isOverlayShowing()) {
            try { FloatingWindowService.start(this); } catch (Exception ignored) { }
        }
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null || event.getEventType() != AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED) return;
        if (!MemeRecommendationPreferences.isProcessingEnabled(this)) return;
        if (event.isPassword()) return;
        CharSequence packageName = event.getPackageName();
        if (packageName != null && getPackageName().contentEquals(packageName)) return;

        AccessibilityNodeInfo source = event.getSource();
        try {
            // Do not inspect arbitrary views: only actual editable input fields
            // are eligible for the opt-in matching feature.
            if (source != null && (!source.isEditable() || source.isPassword())) return;
        } finally {
            if (source != null) source.recycle();
        }

        if (event.getText() == null || event.getText().isEmpty()) return;
        CharSequence first = event.getText().get(0);
        if (first == null) return;
        final String transientInput = first.toString();
        if (transientInput.trim().isEmpty()) return;

        final int sequence = ++inputSequence;
        handler.postDelayed(() -> {
            if (sequence != inputSequence || !MemeRecommendationPreferences.isProcessingEnabled(this)) return;
            matchTransientInput(transientInput);
        }, INPUT_DEBOUNCE_MS);
    }

    @Override
    public void onInterrupt() {
        clearTransientState();
    }

    @Override
    public void onDestroy() {
        clearTransientState();
        if (activeService == this) activeService = null;
        super.onDestroy();
    }

    private void matchTransientInput(String input) {
        final String normalizedInput = normalize(input);
        if (normalizedInput.isEmpty()) return;
        final long now = android.os.SystemClock.uptimeMillis();
        final int fingerprint = normalizedInput.hashCode();
        if (fingerprint == lastInputFingerprint && now - lastInputAt < SAME_INPUT_COOLDOWN_MS) return;

        final boolean contains = MemeRecommendationPreferences.MODE_CONTAINS.equals(MemeRecommendationPreferences.getMatchMode(this));
        final ArrayList<String> matches = new ArrayList<>();
        final List<TagEntry> localIndex;
        synchronized (TAG_INDEX_LOCK) {
            localIndex = tagIndex;
        }
        for (TagEntry entry : localIndex) {
            boolean hit = contains ? normalizedInput.contains(entry.normalized) : normalizedInput.equals(entry.normalized);
            if (hit && !isCoolingDown(entry.display, now)) matches.add(entry.display);
        }

        // The text has now served its only purpose. From this point onward only
        // matching tag names and a short-lived in-memory fingerprint remain.
        lastInputFingerprint = fingerprint;
        lastInputAt = now;
        if (matches.isEmpty()) return;

        // Do not open the whole mini library while the user is typing in another
        // app. A small non-focusable hint appears instead; tapping that hint is
        // the explicit action that opens the filtered recommendation panel.
        if (!RecommendationHintOverlay.show(this, matches)) return;

        for (String tag : matches) tagCooldowns.put(tag, now);
        lastTriggeredTags = Collections.unmodifiableList(new ArrayList<>(matches));
    }

    private boolean isCoolingDown(String tag, long now) {
        Long last = tagCooldowns.get(tag);
        return last != null && now - last < TAG_COOLDOWN_MS;
    }

    private void suppressCurrentRecommendation() {
        long now = android.os.SystemClock.uptimeMillis();
        for (String tag : lastTriggeredTags) tagCooldowns.put(tag, now);
        lastTriggeredTags = Collections.emptyList();
    }

    private void restoreTagIndexFromCache() {
        try {
            JSONObject request = new JSONObject();
            request.put("filter", "frequent");
            request.put("offset", 0);
            request.put("limit", 1);
            FloatingMiniLibraryCache.CachedSnapshot cached = FloatingMiniLibraryCache.get(this).snapshot(request);
            if (!cached.catalogKnown || cached.payload == null) return;

            JSONArray tags = cached.payload.optJSONArray("tags");
            if (tags == null) return;
            ArrayList<String> restored = new ArrayList<>();
            for (int index = 0; index < tags.length(); index++) {
                JSONObject tag = tags.optJSONObject(index);
                if (tag == null) continue;
                String name = tag.optString("name", "").trim();
                if (!name.isEmpty()) restored.add(name);
            }
            setTagIndex(restored);
        } catch (Exception ignored) {
            // The cache is replaceable. Keep any live in-memory index instead of
            // disabling recommendations because a recovery file is unavailable.
        }
    }

    private void clearTransientState() {
        inputSequence++;
        handler.removeCallbacksAndMessages(null);
        RecommendationHintOverlay.dismiss();
        tagCooldowns.clear();
        lastTriggeredTags = Collections.emptyList();
        lastInputFingerprint = 0;
        lastInputAt = 0L;
    }

    private static String normalize(String value) {
        return Normalizer.normalize(value == null ? "" : value, Normalizer.Form.NFKC).trim().toLowerCase(Locale.ROOT);
    }

    private static final class TagEntry {
        final String display;
        final String normalized;

        TagEntry(String display, String normalized) {
            this.display = display;
            this.normalized = normalized;
        }
    }
}
