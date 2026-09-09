package com.puff.meme;

import android.provider.Settings;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(BackupExportPlugin.class);
        registerPlugin(FloatingWindowPlugin.class);
        super.onCreate(savedInstanceState);
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
    }
}
