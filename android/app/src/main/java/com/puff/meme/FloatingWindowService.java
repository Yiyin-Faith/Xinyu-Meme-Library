package com.puff.meme;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.text.Editable;
import android.text.TextWatcher;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.GridLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

/**
 * User-enabled Android overlay for quickly finding and sharing local memes.
 *
 * The native overlay intentionally does not own a second library or image
 * database. It asks the already loaded Capacitor WebView for one small page of
 * thumbnails from the existing IndexedDB, and sends share clicks back to that
 * same WebView so the original Blob remains the single source of truth.
 */
public class FloatingWindowService extends Service {
    private static final String CHANNEL_ID = "xinyu-floating-window";
    private static final int NOTIFICATION_ID = 4042;
    private static final String PREFERENCES = "xinyu-floating-window";
    private static final String PREFERENCE_ENABLED = "enabled";
    private static final String PREFERENCE_ENABLE_AFTER_GRANT = "enable-after-grant";
    private static final String PREFERENCE_OPACITY = "opacity";
    private static final String PREFERENCE_X = "position-x";
    private static final String PREFERENCE_Y = "position-y";
    private static final float DEFAULT_OPACITY = 0.82f;
    private static final float MIN_OPACITY = 0.30f;
    private static final int PAGE_SIZE = 24;
    private static final String FILTER_RECENT = "recent";
    private static final String FILTER_FREQUENT = "frequent";
    private static final String FILTER_RECOMMENDED = "recommended";
    private static final String FILTER_TAG = "tag";

    private static volatile boolean overlayShowing = false;
    private static volatile FloatingWindowService activeService;
    private static List<String> pendingRecommendationTags = Collections.emptyList();

    private WindowManager windowManager;
    private View bubble;
    private WindowManager.LayoutParams bubbleLayoutParams;
    private View panel;
    private WindowManager.LayoutParams panelLayoutParams;
    private EditText panelSearch;
    private LinearLayout tagRow;
    private GridLayout memeGrid;
    private ScrollView memeScroll;
    private TextView panelEmpty;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ArrayList<String> recommendedTags = new ArrayList<>();
    private String selectedFilter = FILTER_FREQUENT;
    private String selectedTag = "";
    private String panelSearchText = "";
    private int loadedCount = 0;
    private int totalCount = 0;
    private int snapshotGeneration = 0;
    private boolean snapshotLoading = false;
    private int snapshotRequestSequence = 0;
    private final Map<String, SnapshotRequest> pendingSnapshotRequests = new HashMap<>();
    private boolean panelOpenedByRecommendation = false;
    private final Runnable searchDebounce = () -> {
        if (panel == null) return;
        String next = panelSearch == null ? "" : panelSearch.getText().toString().trim();
        if (next.equals(panelSearchText)) return;
        panelSearchText = next;
        panelOpenedByRecommendation = false;
        reloadMiniLibrary();
    };
    private final Runnable permissionWatcher = new Runnable() {
        @Override
        public void run() {
            if (!Settings.canDrawOverlays(FloatingWindowService.this)) {
                setEnabledPreference(FloatingWindowService.this, false);
                clearEnableAfterGrantPending(FloatingWindowService.this);
                stopSelf();
                return;
            }
            if (bubble != null) mainHandler.postDelayed(this, 3000L);
        }
    };

    public static boolean isOverlayShowing() {
        return overlayShowing;
    }

    public static void start(Context context) {
        Context appContext = context.getApplicationContext();
        ContextCompat.startForegroundService(appContext, new Intent(appContext, FloatingWindowService.class));
    }

    public static void stop(Context context) {
        Context appContext = context.getApplicationContext();
        appContext.stopService(new Intent(appContext, FloatingWindowService.class));
    }

    /** Opens the small library directly on matching tags; tag names stay in RAM. */
    public static boolean showRecommendation(Context context, List<String> tags) {
        if (!isEnabledPreference(context) || !Settings.canDrawOverlays(context)) return false;
        synchronized (FloatingWindowService.class) {
            pendingRecommendationTags = cleanTags(tags);
        }
        FloatingWindowService service = activeService;
        if (service != null) {
            service.mainHandler.post(() -> service.showMiniLibrary(consumePendingRecommendationTags(), true));
        } else {
            start(context);
        }
        return true;
    }

    /** Called by the WebView whenever IndexedDB changes; no original image bytes are included. */
    public static void syncMiniCatalog(Context context, JSONArray items) {
        FloatingMiniLibraryCache.get(context).syncCatalog(items == null ? new JSONArray() : items);
        FloatingWindowService service = activeService;
        if (service != null) {
            service.mainHandler.post(() -> {
                // If the user left the panel open while changing the main
                // library, refresh it against the newest bridge/cache state.
                if (service.panel != null) service.reloadMiniLibrary();
            });
        }
    }

    /** Receives a page generated asynchronously from the current IndexedDB records. */
    public static void deliverMiniSnapshot(Context context, String requestId, JSONObject snapshot) {
        if (snapshot == null) return;
        FloatingMiniLibraryCache.get(context).cacheSnapshot(snapshot);
        FloatingWindowService service = activeService;
        if (service != null) service.mainHandler.post(() -> service.consumeDeliveredSnapshot(requestId, snapshot));
    }

    public static void setEnabledPreference(Context context, boolean enabled) {
        preferences(context).edit().putBoolean(PREFERENCE_ENABLED, enabled).apply();
    }

    public static boolean isEnabledPreference(Context context) {
        return preferences(context).getBoolean(PREFERENCE_ENABLED, false);
    }

    public static void setEnableAfterGrantPending(Context context, boolean pending) {
        preferences(context).edit().putBoolean(PREFERENCE_ENABLE_AFTER_GRANT, pending).apply();
    }

    public static boolean isEnableAfterGrantPending(Context context) {
        return preferences(context).getBoolean(PREFERENCE_ENABLE_AFTER_GRANT, false);
    }

    public static void clearEnableAfterGrantPending(Context context) {
        setEnableAfterGrantPending(context, false);
    }

    public static float getOpacity(Context context) {
        return clampOpacity(preferences(context).getFloat(PREFERENCE_OPACITY, DEFAULT_OPACITY));
    }

    public static float setOpacity(Context context, float opacity) {
        float normalized = clampOpacity(opacity);
        preferences(context).edit().putFloat(PREFERENCE_OPACITY, normalized).apply();
        FloatingWindowService service = activeService;
        if (service != null) service.mainHandler.post(service::applyOpacity);
        return normalized;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        activeService = this;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!isEnabledPreference(this) || !Settings.canDrawOverlays(this)) {
            setEnabledPreference(this, false);
            clearEnableAfterGrantPending(this);
            stopSelf();
            return START_NOT_STICKY;
        }
        try {
            showBubble();
            startAsForeground();
            watchOverlayPermission();
            List<String> pending = consumePendingRecommendationTags();
            if (!pending.isEmpty()) showMiniLibrary(pending, true);
            return START_STICKY;
        } catch (Exception ignored) {
            hideMiniLibrary(false);
            hideBubble();
            setEnabledPreference(this, false);
            stopSelf();
            return START_NOT_STICKY;
        }
    }

    @Override
    public void onDestroy() {
        mainHandler.removeCallbacksAndMessages(null);
        hideMiniLibrary(false);
        hideBubble();
        if (activeService == this) activeService = null;
        super.onDestroy();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (bubbleLayoutParams != null && bubble != null && windowManager != null) {
            clampBubblePosition();
            try {
                windowManager.updateViewLayout(bubble, bubbleLayoutParams);
            } catch (Exception ignored) {
            }
            saveBubblePosition();
        }
        if (panelLayoutParams != null && panel != null && windowManager != null) {
            positionPanel(panelLayoutParams.width, panelLayoutParams.height);
            try {
                windowManager.updateViewLayout(panel, panelLayoutParams);
            } catch (Exception ignored) {
            }
        }
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void showBubble() {
        if (bubble != null) return;
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        TextView view = new TextView(this);
        view.setText("心");
        view.setTextColor(Color.WHITE);
        view.setTextSize(23);
        view.setGravity(Gravity.CENTER);
        view.setContentDescription("展开迷你表情库");
        view.setBackground(roundRect(Color.rgb(78, 125, 96), dp(28), Color.argb(80, 255, 255, 255), dp(2)));
        view.setElevation(dp(8));
        view.setAlpha(getOpacity(this));
        bubbleLayoutParams = new WindowManager.LayoutParams(
            dp(56),
            dp(56),
            overlayType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        );
        bubbleLayoutParams.gravity = Gravity.TOP | Gravity.START;
        bubbleLayoutParams.x = preferences(this).getInt(PREFERENCE_X, dp(12));
        bubbleLayoutParams.y = preferences(this).getInt(PREFERENCE_Y, safeTop() + dp(136));
        clampBubblePosition();
        attachBubbleDrag(view);
        windowManager.addView(view, bubbleLayoutParams);
        bubble = view;
        overlayShowing = true;
    }

    private void hideBubble() {
        overlayShowing = false;
        if (windowManager != null && bubble != null) {
            try {
                windowManager.removeView(bubble);
            } catch (Exception ignored) {
            }
        }
        bubble = null;
        bubbleLayoutParams = null;
        if (panel == null) windowManager = null;
    }

    private void toggleMiniLibrary() {
        if (panel != null) hideMiniLibrary(panelOpenedByRecommendation);
        else showMiniLibrary(Collections.emptyList(), false);
    }

    private void showMiniLibrary(List<String> matchingTags, boolean fromRecommendation) {
        if (bubble == null || windowManager == null || !Settings.canDrawOverlays(this)) return;
        List<String> cleaned = cleanTags(matchingTags);
        if (panel != null) {
            if (fromRecommendation && !cleaned.isEmpty()) applyRecommendationFilter(cleaned);
            return;
        }

        recommendedTags.clear();
        recommendedTags.addAll(cleaned);
        panelOpenedByRecommendation = fromRecommendation && !cleaned.isEmpty();
        if (panelOpenedByRecommendation) selectRecommendationFilter();
        else {
            selectedFilter = FILTER_FREQUENT;
            selectedTag = "";
        }
        buildMiniPanel();
        try {
            windowManager.addView(panel, panelLayoutParams);
            reloadMiniLibrary();
        } catch (Exception ignored) {
            panel = null;
            panelLayoutParams = null;
        }
    }

    private void applyRecommendationFilter(List<String> matchingTags) {
        recommendedTags.clear();
        recommendedTags.addAll(matchingTags);
        panelOpenedByRecommendation = true;
        selectRecommendationFilter();
        reloadMiniLibrary();
    }

    private void selectRecommendationFilter() {
        if (recommendedTags.size() == 1) {
            selectedFilter = FILTER_TAG;
            selectedTag = recommendedTags.get(0);
        } else {
            selectedFilter = FILTER_RECOMMENDED;
            selectedTag = "";
        }
    }

    private void hideMiniLibrary(boolean userDismissedRecommendation) {
        mainHandler.removeCallbacks(searchDebounce);
        if (userDismissedRecommendation && panelOpenedByRecommendation) MemeRecommendationAccessibilityService.noteRecommendationDismissed();
        hideKeyboard();
        if (windowManager != null && panel != null) {
            try {
                windowManager.removeView(panel);
            } catch (Exception ignored) {
            }
        }
        panel = null;
        panelLayoutParams = null;
        panelSearch = null;
        tagRow = null;
        memeGrid = null;
        memeScroll = null;
        panelEmpty = null;
        snapshotLoading = false;
        snapshotGeneration++;
        pendingSnapshotRequests.clear();
        loadedCount = 0;
        totalCount = 0;
        panelOpenedByRecommendation = false;
        recommendedTags.clear();
        selectedTag = "";
        panelSearchText = "";
        if (bubble == null) windowManager = null;
    }

    private void buildMiniPanel() {
        int panelWidth = Math.min(dp(344), Math.max(dp(270), screenWidth() - dp(24)));
        int maxPanelHeight = Math.max(dp(260), availableHeight() - dp(24));
        int panelHeight = Math.min(dp(490), maxPanelHeight);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(12), dp(11), dp(12), dp(11));
        root.setBackground(roundRect(Color.rgb(248, 252, 249), dp(18), Color.argb(58, 79, 122, 94), dp(1)));
        root.setElevation(dp(12));
        // The compact library remains readable above another app even when the
        // user deliberately makes the small floating ball translucent.
        root.setAlpha(1f);

        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        TextView title = new TextView(this);
        title.setText("迷你表情库");
        title.setTextColor(Color.rgb(69, 103, 80));
        title.setTextSize(14);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        header.addView(title, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        TextView close = actionText("×", "收起迷你表情库");
        close.setTextSize(24);
        close.setOnClickListener((view) -> hideMiniLibrary(true));
        header.addView(close, new LinearLayout.LayoutParams(dp(34), dp(34)));
        root.addView(header, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(37)));

        panelSearch = new EditText(this);
        panelSearch.setSingleLine(true);
        panelSearch.setTextSize(13);
        panelSearch.setTextColor(Color.rgb(69, 96, 77));
        panelSearch.setHintTextColor(Color.rgb(142, 160, 147));
        panelSearch.setHint("搜索表情、标题或标签");
        panelSearch.setPadding(dp(12), 0, dp(12), 0);
        panelSearch.setBackground(roundRect(Color.rgb(232, 242, 234), dp(11), Color.TRANSPARENT, 0));
        panelSearch.setContentDescription("搜索表情");
        panelSearch.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) { }
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) {
                mainHandler.removeCallbacks(searchDebounce);
                mainHandler.postDelayed(searchDebounce, 220L);
            }
            @Override public void afterTextChanged(Editable s) { }
        });
        root.addView(panelSearch, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(42)));

        HorizontalScrollView tagScroll = new HorizontalScrollView(this);
        tagScroll.setHorizontalScrollBarEnabled(false);
        tagRow = new LinearLayout(this);
        tagRow.setOrientation(LinearLayout.HORIZONTAL);
        tagRow.setGravity(Gravity.CENTER_VERTICAL);
        tagScroll.addView(tagRow, new HorizontalScrollView.LayoutParams(HorizontalScrollView.LayoutParams.WRAP_CONTENT, HorizontalScrollView.LayoutParams.MATCH_PARENT));
        LinearLayout.LayoutParams tagScrollParams = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(45));
        tagScrollParams.topMargin = dp(5);
        root.addView(tagScroll, tagScrollParams);

        FrameLayout content = new FrameLayout(this);
        memeScroll = new ScrollView(this);
        memeScroll.setFillViewport(true);
        memeScroll.setClipToPadding(false);
        memeScroll.setPadding(0, dp(2), 0, dp(2));
        memeGrid = new GridLayout(this);
        memeGrid.setColumnCount(3);
        memeGrid.setAlignmentMode(GridLayout.ALIGN_BOUNDS);
        memeGrid.setUseDefaultMargins(false);
        memeScroll.addView(memeGrid, new ScrollView.LayoutParams(ScrollView.LayoutParams.MATCH_PARENT, ScrollView.LayoutParams.WRAP_CONTENT));
        memeScroll.setOnScrollChangeListener((view, scrollX, scrollY, oldScrollX, oldScrollY) -> {
            View child = memeScroll == null ? null : memeScroll.getChildAt(0);
            if (child != null && child.getHeight() - (memeScroll.getHeight() + scrollY) < dp(150)) requestSnapshotPage(false);
        });
        content.addView(memeScroll, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        panelEmpty = new TextView(this);
        panelEmpty.setGravity(Gravity.CENTER);
        panelEmpty.setTextColor(Color.rgb(121, 143, 129));
        panelEmpty.setTextSize(12);
        panelEmpty.setPadding(dp(22), dp(22), dp(22), dp(22));
        panelEmpty.setVisibility(View.GONE);
        panelEmpty.setOnClickListener((view) -> openApp());
        content.addView(panelEmpty, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        root.addView(content, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));

        panel = root;
        panelLayoutParams = new WindowManager.LayoutParams(
            panelWidth,
            panelHeight,
            overlayType(),
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT
        );
        panelLayoutParams.gravity = Gravity.TOP | Gravity.START;
        panelLayoutParams.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE;
        positionPanel(panelWidth, panelHeight);
    }

    private void reloadMiniLibrary() {
        if (panel == null || memeGrid == null) return;
        snapshotGeneration++;
        pendingSnapshotRequests.clear();
        loadedCount = 0;
        totalCount = 0;
        snapshotLoading = false;
        memeGrid.removeAllViews();
        showLoading();
        rebuildTagRow(null);
        requestSnapshotPage(true);
    }

    private void requestSnapshotPage(boolean firstPage) {
        if (panel == null || snapshotLoading) return;
        if (!firstPage && loadedCount >= totalCount && totalCount > 0) return;
        final int generation = snapshotGeneration;
        final int offset = firstPage ? 0 : loadedCount;
        snapshotLoading = true;
        try {
            JSONObject request = new JSONObject();
            request.put("search", panelSearchText);
            request.put("filter", selectedFilter);
            request.put("tag", selectedTag);
            request.put("offset", offset);
            request.put("limit", PAGE_SIZE);
            JSONArray matching = new JSONArray();
            for (String tag : recommendedTags) matching.put(tag);
            request.put("recommendedTags", matching);
            String requestId = "mini-" + generation + "-" + (++snapshotRequestSequence);
            pendingSnapshotRequests.put(requestId, new SnapshotRequest(generation, request));
            // evaluateJavascript can only return the immediate boolean hand-off.
            // The asynchronous IndexedDB thumbnail page comes back via the
            // FloatingWindow Capacitor plugin (deliverMiniSnapshot).
            String source = "(function(){try{const helper=window.__xinyuFloatingMini;if(!helper||typeof helper.requestNativeSnapshot!=='function'){return false;}helper.requestNativeSnapshot(" + JSONObject.quote(requestId) + "," + request.toString() + ");return true;}catch(_){return false;}})()";
            boolean sent = MainActivity.evaluateFloatingJavascript(source, (raw) -> mainHandler.post(() -> consumeBridgeHandshake(requestId, raw)));
            if (!sent) {
                pendingSnapshotRequests.remove(requestId);
                useCachedSnapshot(generation, request);
            }
        } catch (Exception ignored) {
            useCachedSnapshot(generation, null);
        }
    }

    private void consumeBridgeHandshake(String requestId, String raw) {
        SnapshotRequest pending = pendingSnapshotRequests.get(requestId);
        if (pending == null || pending.generation != snapshotGeneration || panel == null) return;
        if (javascriptReturnedTrue(raw)) return;
        pendingSnapshotRequests.remove(requestId);
        useCachedSnapshot(pending.generation, pending.request);
    }

    private void consumeDeliveredSnapshot(String requestId, JSONObject result) {
        SnapshotRequest pending = pendingSnapshotRequests.remove(requestId);
        if (pending == null) return;
        consumeSnapshotPayload(pending.generation, result);
    }

    private void useCachedSnapshot(int generation, @Nullable JSONObject request) {
        if (generation != snapshotGeneration || panel == null) return;
        JSONObject effectiveRequest = request == null ? currentRequest(0) : request;
        FloatingMiniLibraryCache.CachedSnapshot cached = FloatingMiniLibraryCache.get(this).snapshot(effectiveRequest);
        if (cached.catalogKnown && cached.payload != null) {
            consumeSnapshotPayload(generation, cached.payload);
            return;
        }
        if (cached.catalogKnown) {
            showCachedCatalogUnavailable(generation);
            return;
        }
        showInitialCatalogRequired(generation);
    }

    private JSONObject currentRequest(int offset) {
        JSONObject request = new JSONObject();
        try {
            request.put("search", panelSearchText);
            request.put("filter", selectedFilter);
            request.put("tag", selectedTag);
            request.put("offset", offset);
            request.put("limit", PAGE_SIZE);
            JSONArray matching = new JSONArray();
            for (String tag : recommendedTags) matching.put(tag);
            request.put("recommendedTags", matching);
        } catch (Exception ignored) {
        }
        return request;
    }

    private void consumeSnapshotPayload(int generation, JSONObject result) {
        if (generation != snapshotGeneration || panel == null) return;
        snapshotLoading = false;
        try {
            if (!result.optBoolean("ready", false)) {
                useCachedSnapshot(generation, currentRequest(loadedCount));
                return;
            }
            totalCount = Math.max(0, result.optInt("total", 0));
            if (loadedCount == 0) rebuildTagRow(result.optJSONArray("tags"));
            int added = appendMemeCards(result.optJSONArray("items"));
            loadedCount += added;
            if (memeGrid != null && memeGrid.getChildCount() == 0) {
                if (result.optInt("libraryTotal", totalCount) <= 0) showEmpty("还没有表情，先去心语添加一些吧", false);
                else showEmpty("没有找到匹配的表情\n换个标签或关键词试试", false);
            }
            else hideEmpty();
        } catch (Exception ignored) {
            useCachedSnapshot(generation, currentRequest(loadedCount));
        }
    }

    private void showInitialCatalogRequired(int generation) {
        if (generation != snapshotGeneration || panel == null) return;
        snapshotLoading = false;
        showEmpty("请先打开一次心语，以加载你的本地表情库\n点击这里打开应用", true);
    }

    private void showCachedCatalogUnavailable(int generation) {
        if (generation != snapshotGeneration || panel == null) return;
        snapshotLoading = false;
        showEmpty("表情库缓存暂时不可用\n点击这里打开应用以自动恢复", true);
    }

    private void showLoading() {
        showEmpty("正在加载表情库…", false);
    }

    private static boolean javascriptReturnedTrue(String raw) {
        try {
            Object decoded = new JSONTokener(raw == null ? "" : raw).nextValue();
            if (decoded instanceof Boolean) return (Boolean) decoded;
            if (decoded instanceof String) return "true".equalsIgnoreCase((String) decoded);
        } catch (Exception ignored) {
        }
        return false;
    }

    private int appendMemeCards(JSONArray items) {
        if (items == null || memeGrid == null) return 0;
        int added = 0;
        for (int index = 0; index < items.length(); index++) {
            JSONObject item = items.optJSONObject(index);
            if (item == null) continue;
            String id = item.optString("id", "");
            if (id.isEmpty()) continue;
            memeGrid.addView(createMemeCard(id, item.optString("title", "未命名表情"), item.optString("thumbnail", "")), gridItemLayoutParams());
            added++;
        }
        return added;
    }

    private View createMemeCard(String id, String title, String thumbnail) {
        FrameLayout card = new FrameLayout(this);
        card.setPadding(dp(3), dp(3), dp(3), dp(3));
        card.setBackground(roundRect(Color.rgb(234, 243, 236), dp(10), Color.TRANSPARENT, 0));
        card.setContentDescription("发送 " + title);
        ImageView image = new ImageView(this);
        image.setScaleType(ImageView.ScaleType.CENTER_CROP);
        image.setBackgroundColor(Color.rgb(244, 249, 245));
        Bitmap bitmap = decodeThumbnail(thumbnail);
        if (bitmap != null) image.setImageBitmap(bitmap);
        else {
            image.setImageResource(android.R.drawable.ic_menu_gallery);
            image.setColorFilter(Color.rgb(124, 153, 133));
        }
        card.addView(image, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        card.setOnClickListener((view) -> shareMeme(id));
        return card;
    }

    private GridLayout.LayoutParams gridItemLayoutParams() {
        int innerWidth = Math.max(dp(180), (panelLayoutParams == null ? dp(320) : panelLayoutParams.width) - dp(24));
        int size = Math.max(dp(62), (innerWidth - dp(12)) / 3);
        GridLayout.LayoutParams params = new GridLayout.LayoutParams();
        params.width = size;
        params.height = size;
        params.setMargins(dp(3), dp(3), dp(3), dp(3));
        return params;
    }

    @Nullable
    private Bitmap decodeThumbnail(String dataUrl) {
        if (dataUrl == null || dataUrl.isEmpty()) return null;
        try {
            int comma = dataUrl.indexOf(',');
            String encoded = comma >= 0 ? dataUrl.substring(comma + 1) : dataUrl;
            byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inPreferredConfig = Bitmap.Config.RGB_565;
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        } catch (IllegalArgumentException ignored) {
            return null;
        }
    }

    private void rebuildTagRow(@Nullable JSONArray tags) {
        if (tagRow == null) return;
        tagRow.removeAllViews();
        addTagButton("常用", FILTER_FREQUENT, "");
        if (tags == null) return;
        for (int index = 0; index < tags.length(); index++) {
            JSONObject item = tags.optJSONObject(index);
            if (item == null) continue;
            String tag = item.optString("name", "");
            if (!tag.isEmpty()) addTagButton("#" + tag, FILTER_TAG, tag);
        }
    }

    private void addTagButton(String label, String filter, String tag) {
        TextView button = new TextView(this);
        boolean active = filter.equals(selectedFilter) && (filter.equals(FILTER_TAG) ? tag.equals(selectedTag) : true);
        button.setText(label);
        button.setTextSize(11);
        button.setGravity(Gravity.CENTER);
        button.setTextColor(active ? Color.rgb(54, 107, 72) : Color.rgb(103, 134, 113));
        button.setPadding(dp(10), 0, dp(10), 0);
        button.setBackground(roundRect(active ? Color.rgb(209, 235, 215) : Color.rgb(238, 246, 240), dp(13), Color.TRANSPARENT, 0));
        button.setContentDescription("按" + label + "筛选");
        button.setOnClickListener((view) -> {
            selectedFilter = filter;
            selectedTag = tag;
            panelOpenedByRecommendation = false;
            reloadMiniLibrary();
        });
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(28));
        params.rightMargin = dp(6);
        tagRow.addView(button, params);
    }

    private void showEmpty(String text, boolean opensApp) {
        if (panelEmpty != null) {
            panelEmpty.setText(text);
            panelEmpty.setVisibility(View.VISIBLE);
            panelEmpty.setOnClickListener(opensApp ? (view) -> openApp() : null);
        }
        if (memeScroll != null) memeScroll.setVisibility(View.INVISIBLE);
    }

    private void hideEmpty() {
        if (panelEmpty != null) panelEmpty.setVisibility(View.GONE);
        if (memeScroll != null) memeScroll.setVisibility(View.VISIBLE);
    }

    private void shareMeme(String id) {
        hideMiniLibrary(false);
        String source = "(function(){try{const helper=window.__xinyuFloatingMini;if(!helper||typeof helper.share!=='function'){return false;}void helper.share(" + JSONObject.quote(id) + ");return true;}catch(_){return false;}})()";
        boolean sent = MainActivity.evaluateFloatingJavascript(source, (raw) -> mainHandler.post(() -> {
            if (!javascriptReturnedTrue(raw)) openApp();
        }));
        // A cached thumbnail is not an original image. If the WebView process
        // is gone, return the user to the real library instead of pretending a
        // share succeeded.
        if (!sent) openApp();
    }

    private void attachBubbleDrag(View view) {
        view.setOnTouchListener(new View.OnTouchListener() {
            private float downX;
            private float downY;
            private int startX;
            private int startY;
            private boolean moved;

            @Override
            public boolean onTouch(View touched, MotionEvent event) {
                if (bubbleLayoutParams == null || windowManager == null) return false;
                switch (event.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        downX = event.getRawX();
                        downY = event.getRawY();
                        startX = bubbleLayoutParams.x;
                        startY = bubbleLayoutParams.y;
                        moved = false;
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        int nextX = clampBubbleX(startX + Math.round(event.getRawX() - downX));
                        int nextY = clampBubbleY(startY + Math.round(event.getRawY() - downY));
                        moved = moved || Math.abs(nextX - startX) > dp(4) || Math.abs(nextY - startY) > dp(4);
                        bubbleLayoutParams.x = nextX;
                        bubbleLayoutParams.y = nextY;
                        try {
                            windowManager.updateViewLayout(touched, bubbleLayoutParams);
                        } catch (Exception ignored) {
                        }
                        return true;
                    case MotionEvent.ACTION_UP:
                        snapBubbleToEdge();
                        saveBubblePosition();
                        if (!moved) toggleMiniLibrary();
                        return true;
                    case MotionEvent.ACTION_CANCEL:
                        snapBubbleToEdge();
                        saveBubblePosition();
                        return true;
                    default:
                        return true;
                }
            }
        });
    }

    private void snapBubbleToEdge() {
        if (bubbleLayoutParams == null || bubble == null || windowManager == null) return;
        int left = dp(8);
        int right = Math.max(left, screenWidth() - bubbleLayoutParams.width - dp(8));
        bubbleLayoutParams.x = bubbleLayoutParams.x + bubbleLayoutParams.width / 2 < screenWidth() / 2 ? left : right;
        bubbleLayoutParams.y = clampBubbleY(bubbleLayoutParams.y);
        try {
            windowManager.updateViewLayout(bubble, bubbleLayoutParams);
        } catch (Exception ignored) {
        }
    }

    private void clampBubblePosition() {
        if (bubbleLayoutParams == null) return;
        bubbleLayoutParams.x = clampBubbleX(bubbleLayoutParams.x);
        bubbleLayoutParams.y = clampBubbleY(bubbleLayoutParams.y);
    }

    private int clampBubbleX(int value) {
        int width = bubbleLayoutParams == null ? dp(56) : bubbleLayoutParams.width;
        int min = dp(8);
        int max = Math.max(min, screenWidth() - width - dp(8));
        return Math.max(min, Math.min(value, max));
    }

    private int clampBubbleY(int value) {
        int height = bubbleLayoutParams == null ? dp(56) : bubbleLayoutParams.height;
        int min = safeTop() + dp(8);
        int max = Math.max(min, screenHeight() - safeBottom() - height - dp(8));
        return Math.max(min, Math.min(value, max));
    }

    private void positionPanel(int panelWidth, int panelHeight) {
        int minX = dp(8);
        int maxX = Math.max(minX, screenWidth() - panelWidth - dp(8));
        boolean bubbleOnLeft = bubbleLayoutParams == null || bubbleLayoutParams.x + bubbleLayoutParams.width / 2 < screenWidth() / 2;
        panelLayoutParams.x = bubbleOnLeft ? maxX : minX;
        int bubbleY = bubbleLayoutParams == null ? safeTop() + dp(120) : bubbleLayoutParams.y;
        int minY = safeTop() + dp(8);
        int maxY = Math.max(minY, screenHeight() - safeBottom() - panelHeight - dp(8));
        panelLayoutParams.y = Math.max(minY, Math.min(bubbleY - panelHeight / 4, maxY));
    }

    private void saveBubblePosition() {
        if (bubbleLayoutParams == null) return;
        preferences(this).edit()
            .putInt(PREFERENCE_X, bubbleLayoutParams.x)
            .putInt(PREFERENCE_Y, bubbleLayoutParams.y)
            .apply();
    }

    private void applyOpacity() {
        float alpha = getOpacity(this);
        if (bubble != null) bubble.setAlpha(alpha);
    }

    private void watchOverlayPermission() {
        mainHandler.removeCallbacks(permissionWatcher);
        mainHandler.postDelayed(permissionWatcher, 3000L);
    }

    private void openApp() {
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch == null) return;
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        startActivity(launch);
    }

    private void hideKeyboard() {
        if (panelSearch == null) return;
        InputMethodManager input = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        if (input != null) input.hideSoftInputFromWindow(panelSearch.getWindowToken(), 0);
    }

    private void startAsForeground() {
        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private Notification buildNotification() {
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pending = PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "心语悬浮表情助手", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("保持心语迷你表情库可用");
            ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).createNotificationChannel(channel);
            return new Notification.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_menu_gallery)
                .setContentTitle("心语悬浮表情助手已开启")
                .setContentText("点按悬浮球展开迷你表情库")
                .setContentIntent(pending)
                .setOngoing(true)
                .build();
        }
        return new Notification.Builder(this)
            .setSmallIcon(android.R.drawable.ic_menu_gallery)
            .setContentTitle("心语悬浮表情助手已开启")
            .setContentText("点按悬浮球展开迷你表情库")
            .setContentIntent(pending)
            .setOngoing(true)
            .build();
    }

    private static List<String> cleanTags(List<String> tags) {
        LinkedHashSet<String> unique = new LinkedHashSet<>();
        if (tags != null) {
            for (String tag : tags) {
                String value = tag == null ? "" : tag.trim();
                if (!value.isEmpty()) unique.add(value);
            }
        }
        return Collections.unmodifiableList(new ArrayList<>(unique));
    }

    private static final class SnapshotRequest {
        final int generation;
        final JSONObject request;

        SnapshotRequest(int generation, JSONObject request) {
            this.generation = generation;
            this.request = request;
        }
    }

    private static List<String> consumePendingRecommendationTags() {
        synchronized (FloatingWindowService.class) {
            List<String> current = pendingRecommendationTags;
            pendingRecommendationTags = Collections.emptyList();
            return current;
        }
    }

    private static SharedPreferences preferences(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    private static float clampOpacity(float opacity) {
        if (Float.isNaN(opacity) || Float.isInfinite(opacity)) return DEFAULT_OPACITY;
        return Math.max(MIN_OPACITY, Math.min(1f, opacity));
    }

    private int overlayType() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE;
    }

    private GradientDrawable roundRect(int color, int radius, int strokeColor, int strokeWidth) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(radius);
        if (strokeWidth > 0) drawable.setStroke(strokeWidth, strokeColor);
        return drawable;
    }

    private TextView actionText(String value, String description) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextColor(Color.rgb(86, 123, 96));
        view.setGravity(Gravity.CENTER);
        view.setContentDescription(description);
        view.setBackground(roundRect(Color.rgb(231, 242, 233), dp(10), Color.TRANSPARENT, 0));
        return view;
    }

    private int safeTop() {
        int id = getResources().getIdentifier("status_bar_height", "dimen", "android");
        return id > 0 ? getResources().getDimensionPixelSize(id) : dp(24);
    }

    private int safeBottom() {
        int id = getResources().getIdentifier("navigation_bar_height", "dimen", "android");
        return id > 0 ? getResources().getDimensionPixelSize(id) : dp(24);
    }

    private int availableHeight() {
        return Math.max(dp(280), screenHeight() - safeTop() - safeBottom());
    }

    private int screenWidth() {
        DisplayMetrics metrics = new DisplayMetrics();
        if (windowManager != null) windowManager.getDefaultDisplay().getRealMetrics(metrics);
        else metrics.setTo(getResources().getDisplayMetrics());
        return metrics.widthPixels > 0 ? metrics.widthPixels : getResources().getDisplayMetrics().widthPixels;
    }

    private int screenHeight() {
        DisplayMetrics metrics = new DisplayMetrics();
        if (windowManager != null) windowManager.getDefaultDisplay().getRealMetrics(metrics);
        else metrics.setTo(getResources().getDisplayMetrics());
        return metrics.heightPixels > 0 ? metrics.heightPixels : getResources().getDisplayMetrics().heightPixels;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
