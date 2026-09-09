package com.puff.meme;

import android.content.Context;
import android.media.MediaScannerConnection;

import java.io.File;
import java.io.IOException;

/** Keeps app-owned image copies out of Android's shared media collection. */
public final class MediaStorageIsolation {
    private MediaStorageIsolation() {
    }

    /**
     * The meme library itself lives in WebView IndexedDB (internal app data).
     * This only protects package-owned external cache/files left by older
     * versions or third-party storage implementations. It never moves or
     * deletes a user image.
     */
    public static void protect(Context context) {
        File appExternalRoot = appExternalRoot(context);
        if (appExternalRoot == null) return;

        File marker = new File(appExternalRoot, ".nomedia");
        try {
            if (!appExternalRoot.exists() && !appExternalRoot.mkdirs()) return;
            if (!marker.exists() && !marker.createNewFile()) return;

            // Scanning the marker is the safe Android-supported way to make
            // MediaProvider re-evaluate already indexed app-owned cache files.
            MediaScannerConnection.scanFile(
                context.getApplicationContext(),
                new String[] { marker.getAbsolutePath() },
                null,
                null
            );
        } catch (IOException | SecurityException ignored) {
            // The app still stores its library privately; failure to create a
            // compatibility marker must never block opening the library.
        }
    }

    private static File appExternalRoot(Context context) {
        File externalFiles = context.getExternalFilesDir(null);
        if (externalFiles != null) return externalFiles.getParentFile();
        File externalCache = context.getExternalCacheDir();
        return externalCache == null ? null : externalCache.getParentFile();
    }
}
