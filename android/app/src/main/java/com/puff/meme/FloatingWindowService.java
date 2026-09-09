package com.puff.meme;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.IBinder;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;

import androidx.annotation.Nullable;

/** A small draggable shortcut shown above other Android applications. */
public class FloatingWindowService extends Service {
    private static final String CHANNEL_ID = "xinyu-floating-window";
    private static final int NOTIFICATION_ID = 4042;
    private static volatile boolean overlayShowing = false;

    private WindowManager windowManager;
    private View bubble;
    private WindowManager.LayoutParams layoutParams;

    public static boolean isOverlayShowing() {
        return overlayShowing;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!Settings.canDrawOverlays(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        try {
            showBubble();
            startAsForeground();
            return START_STICKY;
        } catch (Exception ignored) {
            hideBubble();
            stopSelf();
            return START_NOT_STICKY;
        }
    }

    @Override
    public void onDestroy() {
        hideBubble();
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
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE;
        layoutParams = new WindowManager.LayoutParams(dp(56), dp(56), type, WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS, PixelFormat.TRANSLUCENT);
        layoutParams.gravity = Gravity.TOP | Gravity.START;
        layoutParams.x = dp(12);
        layoutParams.y = dp(180);
        attachDrag(view);
        windowManager.addView(view, layoutParams);
        bubble = view;
        overlayShowing = true;
    }

    private void hideBubble() {
        overlayShowing = false;
        if (windowManager != null && bubble != null) {
            try { windowManager.removeView(bubble); } catch (Exception ignored) { }
        }
        bubble = null;
        layoutParams = null;
        windowManager = null;
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
                        int nextX = startX + Math.round(event.getRawX() - downX);
                        int nextY = startY + Math.round(event.getRawY() - downY);
                        moved = moved || Math.abs(nextX - startX) > dp(4) || Math.abs(nextY - startY) > dp(4);
                        layoutParams.x = nextX;
                        layoutParams.y = nextY;
                        try { windowManager.updateViewLayout(touched, layoutParams); } catch (Exception ignored) { }
                        return true;
                    case MotionEvent.ACTION_UP:
                        if (!moved) openApp();
                        return true;
                    default:
                        return true;
                }
            }
        });
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
