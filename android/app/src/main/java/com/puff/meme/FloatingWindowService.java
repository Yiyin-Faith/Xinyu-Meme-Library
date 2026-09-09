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
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;

import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;

/** A small draggable shortcut shown above other Android applications. */
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
    private static volatile boolean overlayShowing = false;
    private static volatile FloatingWindowService activeService;

    private WindowManager windowManager;
    private View bubble;
    private WindowManager.LayoutParams layoutParams;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Runnable permissionWatcher = new Runnable() {
        @Override
        public void run() {
            if (!Settings.canDrawOverlays(FloatingWindowService.this)) {
                // Android has no listener for a user revoking this special
                // permission. Poll while the foreground service is active so
                // the button disappears and the saved native state is honest.
                setEnabledPreference(FloatingWindowService.this, false);
                clearEnableAfterGrantPending(FloatingWindowService.this);
                stopSelf();
                return;
            }
            if (bubble != null) mainHandler.postDelayed(this, 1500L);
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

    private static SharedPreferences preferences(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    private static float clampOpacity(float opacity) {
        if (Float.isNaN(opacity) || Float.isInfinite(opacity)) return DEFAULT_OPACITY;
        return Math.max(MIN_OPACITY, Math.min(1f, opacity));
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
            return START_STICKY;
        } catch (Exception ignored) {
            hideBubble();
            setEnabledPreference(this, false);
            stopSelf();
            return START_NOT_STICKY;
        }
    }

    @Override
    public void onDestroy() {
        mainHandler.removeCallbacks(permissionWatcher);
        hideBubble();
        if (activeService == this) activeService = null;
        super.onDestroy();
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
        view.setTextSize(24);
        view.setGravity(Gravity.CENTER);
        view.setContentDescription("打开心语表情库");
        GradientDrawable background = new GradientDrawable();
        background.setShape(GradientDrawable.OVAL);
        background.setColor(Color.rgb(78, 125, 96));
        background.setStroke(dp(2), Color.argb(80, 255, 255, 255));
        view.setBackground(background);
        view.setElevation(dp(8));
        view.setAlpha(getOpacity(this));
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE;
        layoutParams = new WindowManager.LayoutParams(dp(56), dp(56), type, WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS, PixelFormat.TRANSLUCENT);
        layoutParams.gravity = Gravity.TOP | Gravity.START;
        layoutParams.x = preferences(this).getInt(PREFERENCE_X, dp(12));
        layoutParams.y = preferences(this).getInt(PREFERENCE_Y, dp(180));
        clampPosition();
        attachDrag(view);
        windowManager.addView(view, layoutParams);
        bubble = view;
        overlayShowing = true;
    }

    private void hideBubble() {
        mainHandler.removeCallbacks(permissionWatcher);
        overlayShowing = false;
        if (windowManager != null && bubble != null) {
            try { windowManager.removeView(bubble); } catch (Exception ignored) { }
        }
        bubble = null;
        layoutParams = null;
        windowManager = null;
    }

    private void applyOpacity() {
        if (bubble != null) bubble.setAlpha(getOpacity(this));
    }

    private void watchOverlayPermission() {
        mainHandler.removeCallbacks(permissionWatcher);
        mainHandler.postDelayed(permissionWatcher, 1500L);
    }

    private void attachDrag(View view) {
        view.setOnTouchListener(new View.OnTouchListener() {
            private float downX;
            private float downY;
            private int startX;
            private int startY;
            private boolean moved;

            @Override
            public boolean onTouch(View touched, MotionEvent event) {
                switch (event.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        downX = event.getRawX();
                        downY = event.getRawY();
                        startX = layoutParams.x;
                        startY = layoutParams.y;
                        moved = false;
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        int nextX = clampX(startX + Math.round(event.getRawX() - downX));
                        int nextY = clampY(startY + Math.round(event.getRawY() - downY));
                        moved = moved || Math.abs(nextX - startX) > dp(4) || Math.abs(nextY - startY) > dp(4);
                        layoutParams.x = nextX;
                        layoutParams.y = nextY;
                        try { windowManager.updateViewLayout(touched, layoutParams); } catch (Exception ignored) { }
                        return true;
                    case MotionEvent.ACTION_UP:
                        savePosition();
                        if (!moved) openApp();
                        return true;
                    case MotionEvent.ACTION_CANCEL:
                        savePosition();
                        return true;
                    default:
                        return true;
                }
            }
        });
    }

    private void clampPosition() {
        if (layoutParams == null) return;
        layoutParams.x = clampX(layoutParams.x);
        layoutParams.y = clampY(layoutParams.y);
    }

    private int clampX(int value) {
        int width = layoutParams == null ? dp(56) : layoutParams.width;
        int max = Math.max(0, getResources().getDisplayMetrics().widthPixels - width);
        return Math.max(0, Math.min(value, max));
    }

    private int clampY(int value) {
        int height = layoutParams == null ? dp(56) : layoutParams.height;
        int max = Math.max(0, getResources().getDisplayMetrics().heightPixels - height);
        return Math.max(0, Math.min(value, max));
    }

    private void savePosition() {
        if (layoutParams == null) return;
        preferences(this).edit()
            .putInt(PREFERENCE_X, layoutParams.x)
            .putInt(PREFERENCE_Y, layoutParams.y)
            .apply();
    }

    private void openApp() {
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch == null) return;
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        startActivity(launch);
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
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "心语悬浮窗", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("保持心语表情库的悬浮按钮可用");
            ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).createNotificationChannel(channel);
            return new Notification.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_menu_gallery)
                .setContentTitle("心语悬浮窗已开启")
                .setContentText("点按悬浮按钮回到图片库")
                .setContentIntent(pending)
                .setOngoing(true)
                .build();
        }
        return new Notification.Builder(this)
            .setSmallIcon(android.R.drawable.ic_menu_gallery)
            .setContentTitle("心语悬浮窗已开启")
            .setContentText("点按悬浮按钮回到图片库")
            .setContentIntent(pending)
            .setOngoing(true)
            .build();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
