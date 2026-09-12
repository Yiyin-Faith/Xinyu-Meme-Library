package com.puff.meme;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.util.Base64;

import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;
import java.util.zip.Deflater;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * Streams backup data to a user-picked Storage Access Framework directory.
 * The WebView only sends one small Base64 chunk at a time; the full library is
 * never materialized as a JS ArrayBuffer, Base64 string, or ZIP blob.
 */
@CapacitorPlugin(name = "BackupExport")
public class BackupExportPlugin extends Plugin {
    private static final int BUFFER_SIZE = 64 * 1024;
    private static final int MAX_CHUNK_BYTES = 1024 * 1024;
    private static final int MAX_FOLDER_ENTRIES = 5000;
    private static final int MAX_FOLDER_DEPTH = 3;
    private static final String TASK_CHANNEL_ID = "xinyu-background-tasks";
    private static final Pattern BACKUP_FOLDER = Pattern.compile("xinyu-backup-[0-9-]{17}(?:-[0-9]{1,2})?");
    private static final Pattern IMAGE_PATH = Pattern.compile("images/[a-f0-9]{64}");
    private static final Pattern IMAGE_NAME = Pattern.compile("[a-f0-9]{64}");
    private static final Pattern ZIP_NAME = Pattern.compile("xinyu-backup-[0-9-]{17}\\.puff\\.zip");
    /** Control characters, backslashes and parent-segment traversal. */
    private static final Pattern UNSAFE_RELATIVE_PATH = Pattern.compile("[\\u0000-\\u001f\\\\]|\\.\\.");
    private final Map<String, OutputStream> writers = new ConcurrentHashMap<>();
    private final Map<String, InputStream> readers = new ConcurrentHashMap<>();

    @PluginMethod
    public void chooseDirectory(PluginCall call) {
        String folderName = call.getString("folderName");
        if (!isBackupFolder(folderName)) {
            call.reject("备份目录名称不正确");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        startActivityForResult(call, intent, "directorySelected");
    }

    @ActivityCallback
    private void directorySelected(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject response = new JSObject();
            response.put("cancelled", true);
            call.resolve(response);
            return;
        }
        try {
            String requestedName = call.getString("folderName");
            if (!isBackupFolder(requestedName)) throw new IOException("备份目录名称不正确");
            Intent resultIntent = result.getData();
            Uri treeUri = resultIntent.getData();
            int grantFlags = resultIntent.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            if ((grantFlags & Intent.FLAG_GRANT_WRITE_URI_PERMISSION) == 0) throw new IOException("没有获得该文件夹的写入权限");
            getContext().getContentResolver().takePersistableUriPermission(treeUri, grantFlags);
            DocumentFile root = DocumentFile.fromTreeUri(getContext(), treeUri);
            if (root == null || !root.isDirectory() || !root.canWrite()) throw new IOException("无法写入所选文件夹");
            DocumentFile backupFolder = createUniqueDirectory(root, requestedName);
            if (backupFolder == null) throw new IOException("无法创建备份目录");
            JSObject response = new JSObject();
            response.put("cancelled", false);
            response.put("treeUri", treeUri.toString());
            response.put("folderName", backupFolder.getName());
            response.put("location", location(root, backupFolder.getName()));
            call.resolve(response);
        } catch (Exception error) {
            call.reject("无法创建外部备份目录：" + message(error), error);
        }
    }

    @PluginMethod
    public void openFile(PluginCall call) {
        try {
            String treeUri = required(call, "treeUri");
            String folderName = required(call, "folderName");
            String path = required(call, "path");
            String mimeType = required(call, "mimeType");
            if (!isBackupFolder(folderName) || !isSafeBackupPath(path)) throw new IOException("备份文件路径不正确");
            DocumentFile backupFolder = backupFolder(treeUri, folderName);
            DocumentFile parent = backupFolder;
            String fileName;
            if ("manifest.json".equals(path)) {
                fileName = "manifest.json";
            } else {
                DocumentFile images = parent.findFile("images");
                if (images == null) images = parent.createDirectory("images");
                if (images == null || !images.isDirectory()) throw new IOException("无法创建图片备份目录");
                parent = images;
                fileName = path.substring("images/".length());
            }
            DocumentFile existing = parent.findFile(fileName);
            if (existing != null && !existing.delete()) throw new IOException("无法覆盖已有备份文件");
            DocumentFile target = parent.createFile(mimeType, fileName);
            if (target == null) throw new IOException("无法创建备份文件");
            OutputStream stream = getContext().getContentResolver().openOutputStream(target.getUri(), "w");
            if (stream == null) throw new IOException("无法打开备份文件");
            String writerId = UUID.randomUUID().toString();
            writers.put(writerId, new BufferedOutputStream(stream, BUFFER_SIZE));
            JSObject response = new JSObject();
            response.put("writerId", writerId);
            call.resolve(response);
        } catch (Exception error) {
            call.reject("无法写入原始备份：" + message(error), error);
        }
    }

    @PluginMethod
    public void writeChunk(PluginCall call) {
        String writerId = call.getString("writerId");
        String data = call.getString("data");
        OutputStream stream = writerId == null ? null : writers.get(writerId);
        if (stream == null || data == null) {
            call.reject("备份写入会话已失效");
            return;
        }
        try {
            stream.write(Base64.decode(data, Base64.DEFAULT));
            call.resolve();
        } catch (Exception error) {
            try {
                closeWriter(writerId);
            } catch (IOException ignored) {
                // The original write error is the useful one to surface.
            }
            call.reject("写入备份数据失败：" + message(error), error);
        }
    }

    @PluginMethod
    public void closeFile(PluginCall call) {
        String writerId = call.getString("writerId");
        if (writerId == null) {
            call.reject("备份写入会话已失效");
            return;
        }
        try {
            closeWriter(writerId);
            call.resolve();
        } catch (Exception error) {
            call.reject("关闭备份文件失败：" + message(error), error);
        }
    }

    @PluginMethod
    public void compress(PluginCall call) {
        DocumentFile zipFile = null;
        try {
            String treeUri = required(call, "treeUri");
            String folderName = required(call, "folderName");
            String zipName = required(call, "zipFileName");
            if (!isBackupFolder(folderName) || !ZIP_NAME.matcher(zipName).matches()) throw new IOException("ZIP 文件名称不正确");
            DocumentFile root = root(treeUri);
            DocumentFile backupFolder = backupFolder(treeUri, folderName);
            DocumentFile manifest = backupFolder.findFile("manifest.json");
            DocumentFile images = backupFolder.findFile("images");
            if (manifest == null || !manifest.isFile()) throw new IOException("原始备份不完整，未开始压缩");
            // Metadata-only incremental backups intentionally have no images
            // directory. A manifest by itself is still a valid ZIP backup.
            if (images != null && !images.isDirectory()) throw new IOException("原始备份图片目录不正确");
            DocumentFile[] imageFiles = images == null ? new DocumentFile[0] : images.listFiles();
            long totalBytes = manifest.length();
            for (DocumentFile image : imageFiles) {
                String name = image.getName();
                if (name == null || !image.isFile() || !IMAGE_NAME.matcher(name).matches()) throw new IOException("原始备份包含未知图片文件");
                totalBytes += Math.max(0, image.length());
            }
            zipFile = root.createFile("application/zip", zipName);
            if (zipFile == null) throw new IOException("无法创建 ZIP 文件");
            OutputStream output = getContext().getContentResolver().openOutputStream(zipFile.getUri(), "w");
            if (output == null) throw new IOException("无法打开 ZIP 文件");
            long copied = 0;
            int completed = 0;
            try (ZipOutputStream zip = new ZipOutputStream(new BufferedOutputStream(output, BUFFER_SIZE))) {
                zip.setLevel(Deflater.NO_COMPRESSION);
                copied += copyEntry(manifest, "manifest.json", zip);
                notifyCompression(completed, imageFiles.length, copied, totalBytes);
                for (DocumentFile image : imageFiles) {
                    copied += copyEntry(image, "images/" + image.getName(), zip);
                    completed++;
                    notifyCompression(completed, imageFiles.length, copied, totalBytes);
                }
                zip.finish();
            }
            JSObject response = new JSObject();
            response.put("zipUri", zipFile.getUri().toString());
            response.put("zipName", zipFile.getName());
            response.put("location", location(root, zipFile.getName()));
            call.resolve(response);
        } catch (Exception error) {
            if (zipFile != null) zipFile.delete();
            call.reject("ZIP 压缩失败：" + message(error), error);
        }
    }

    /**
     * Restore side: lets the user pick a backup folder. The tree URI stays a
     * persisted `content://` grant and is never rewritten into a real path.
     */
    @PluginMethod
    public void chooseBackupFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        startActivityForResult(call, intent, "backupFolderSelected");
    }

    @ActivityCallback
    private void backupFolderSelected(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject response = new JSObject();
            response.put("cancelled", true);
            call.resolve(response);
            return;
        }
        try {
            Intent resultIntent = result.getData();
            Uri treeUri = resultIntent.getData();
            int grantFlags = resultIntent.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION;
            if (grantFlags == 0) throw new IOException("没有获得该文件夹的读取权限");
            getContext().getContentResolver().takePersistableUriPermission(treeUri, grantFlags);
            DocumentFile root = DocumentFile.fromTreeUri(getContext(), treeUri);
            if (root == null || !root.isDirectory() || !root.canRead()) throw new IOException("无法读取所选文件夹");
            DocumentFile backupRoot = findBackupRoot(root);
            String prefix = backupRoot != root && backupRoot.getName() != null ? backupRoot.getName() + "/" : "";
            JSONArray entries = new JSONArray();
            collectEntries(backupRoot, prefix, entries, 0);
            JSObject response = new JSObject();
            response.put("cancelled", false);
            response.put("treeUri", treeUri.toString());
            response.put("location", root.getName() == null || root.getName().isEmpty() ? "所选文件夹" : root.getName());
            response.put("entries", entries);
            call.resolve(response);
        } catch (Exception error) {
            call.reject("无法读取备份文件夹：" + message(error), error);
        }
    }

    @PluginMethod
    public void openFileForRead(PluginCall call) {
        try {
            String treeUri = required(call, "treeUri");
            String path = required(call, "path");
            if (!isSafeRelativePath(path)) throw new IOException("备份文件路径不正确");
            DocumentFile root = DocumentFile.fromTreeUri(getContext(), Uri.parse(treeUri));
            if (root == null || !root.isDirectory() || !root.canRead()) throw new IOException("备份文件夹已不可读，请重新选择");
            DocumentFile file = resolveFile(root, path);
            if (file == null || !file.isFile()) throw new IOException("备份文件已不存在：" + path);
            InputStream stream = getContext().getContentResolver().openInputStream(file.getUri());
            if (stream == null) throw new IOException("无法打开备份文件");
            String readerId = UUID.randomUUID().toString();
            readers.put(readerId, new BufferedInputStream(stream, BUFFER_SIZE));
            JSObject response = new JSObject();
            response.put("readerId", readerId);
            response.put("size", file.length());
            call.resolve(response);
        } catch (Exception error) {
            call.reject("无法读取备份文件：" + message(error), error);
        }
    }

    @PluginMethod
    public void readChunk(PluginCall call) {
        String readerId = call.getString("readerId");
        InputStream stream = readerId == null ? null : readers.get(readerId);
        if (stream == null) {
            call.reject("备份读取会话已失效");
            return;
        }
        int length = call.getInt("length", BUFFER_SIZE);
        if (length <= 0 || length > MAX_CHUNK_BYTES) length = BUFFER_SIZE;
        try {
            byte[] buffer = new byte[length];
            int filled = 0;
            while (filled < length) {
                int read = stream.read(buffer, filled, length - filled);
                if (read == -1) break;
                filled += read;
            }
            boolean done = filled < length;
            JSObject response = new JSObject();
            response.put("data", filled == 0 ? "" : Base64.encodeToString(buffer, 0, filled, Base64.NO_WRAP));
            response.put("done", done);
            if (done) closeReaderStream(readerId);
            call.resolve(response);
        } catch (Exception error) {
            try {
                closeReaderStream(readerId);
            } catch (IOException ignored) {
                // The original read error is the useful one to surface.
            }
            call.reject("读取备份数据失败：" + message(error), error);
        }
    }

    @PluginMethod
    public void closeReader(PluginCall call) {
        String readerId = call.getString("readerId");
        if (readerId == null) {
            call.reject("备份读取会话已失效");
            return;
        }
        try {
            closeReaderStream(readerId);
            call.resolve();
        } catch (Exception error) {
            call.reject("关闭备份文件失败：" + message(error), error);
        }
    }

    @Override
    protected void handleOnDestroy() {
        for (String writerId : writers.keySet()) {
            try { closeWriter(writerId); } catch (IOException ignored) { }
        }
        for (String readerId : readers.keySet()) {
            try { closeReaderStream(readerId); } catch (IOException ignored) { }
        }
    }

    /**
     * Posts a completion notification for a long background task (backup
     * export, restore, batch import). Kept in this plugin so the app does not
     * need an extra Capacitor dependency just to show one notification.
     */
    @PluginMethod
    public void notify(PluginCall call) {
        try {
            String title = call.getString("title", "心语表情库");
            String body = call.getString("body");
            if (body == null || body.isEmpty()) {
                call.resolve();
                return;
            }
            NotificationManager manager = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager == null) throw new IOException("系统通知服务不可用");
            // Android 13+ gates notifications behind a runtime permission.
            // When it has not been granted the post is dropped; that is fine,
            // the in-app task dock still shows the result.
            if (!manager.areNotificationsEnabled()) {
                call.resolve();
                return;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel channel = new NotificationChannel(TASK_CHANNEL_ID, "后台任务", NotificationManager.IMPORTANCE_DEFAULT);
                channel.setDescription("备份、恢复和批量导入完成后的提醒");
                manager.createNotificationChannel(channel);
            }
            Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    ? new Notification.Builder(getContext(), TASK_CHANNEL_ID)
                    : new Notification.Builder(getContext());
            builder.setContentTitle(title)
                    .setContentText(body)
                    .setStyle(new Notification.BigTextStyle().bigText(body))
                    .setSmallIcon(android.R.drawable.stat_sys_download_done)
                    .setAutoCancel(true);
            manager.notify((int) (System.currentTimeMillis() & 0x7fffffff), builder.build());
            call.resolve();
        } catch (Exception error) {
            call.reject("无法发送通知：" + message(error), error);
        }
    }

    private void notifyCompression(int completed, int total, long bytesCompleted, long totalBytes) {
        JSObject progress = new JSObject();
        progress.put("completed", completed);
        progress.put("total", total);
        progress.put("bytesCompleted", bytesCompleted);
        progress.put("totalBytes", totalBytes);
        notifyListeners("compressionProgress", progress);
    }

    private long copyEntry(DocumentFile file, String entryName, ZipOutputStream zip) throws IOException {
        zip.putNextEntry(new ZipEntry(entryName));
        long copied = 0;
        try (InputStream input = getContext().getContentResolver().openInputStream(file.getUri())) {
            if (input == null) throw new IOException("无法读取原始备份文件");
            try (BufferedInputStream buffered = new BufferedInputStream(input, BUFFER_SIZE)) {
                byte[] buffer = new byte[BUFFER_SIZE];
                int read;
                while ((read = buffered.read(buffer)) != -1) {
                    zip.write(buffer, 0, read);
                    copied += read;
                }
            }
        } finally {
            zip.closeEntry();
        }
        return copied;
    }

    private DocumentFile root(String treeUri) throws IOException {
        DocumentFile root = DocumentFile.fromTreeUri(getContext(), Uri.parse(treeUri));
        if (root == null || !root.isDirectory() || !root.canWrite()) throw new IOException("外部备份位置已不可写，请重新选择文件夹");
        return root;
    }

    private DocumentFile backupFolder(String treeUri, String folderName) throws IOException {
        DocumentFile root = root(treeUri);
        DocumentFile folder = root.findFile(folderName);
        if (folder == null || !folder.isDirectory() || !folder.canWrite()) throw new IOException("原始备份目录已不可用");
        return folder;
    }

    /**
     * The user may pick the backup folder itself or the folder that contains
     * it. Only a single, unambiguous wrapper is descended into; every reported
     * path is still re-validated by the shared web-side whitelist.
     */
    private DocumentFile findBackupRoot(DocumentFile root) {
        if (root.findFile("manifest.json") != null) return root;
        DocumentFile only = null;
        for (DocumentFile child : root.listFiles()) {
            if (!child.isDirectory() || child.findFile("manifest.json") == null) continue;
            if (only != null) return root;
            only = child;
        }
        return only == null ? root : only;
    }

    private void collectEntries(DocumentFile dir, String prefix, JSONArray out, int depth) {
        if (depth > MAX_FOLDER_DEPTH) return;
        for (DocumentFile child : dir.listFiles()) {
            if (out.length() >= MAX_FOLDER_ENTRIES) return;
            String name = child.getName();
            if (name == null || name.isEmpty()) continue;
            String path = prefix.isEmpty() ? name : prefix + name;
            if (child.isDirectory()) {
                collectEntries(child, path + "/", out, depth + 1);
            } else if (child.isFile()) {
                JSObject entry = new JSObject();
                entry.put("path", path);
                entry.put("size", child.length());
                out.put(entry);
            }
        }
    }

    private void closeReaderStream(String readerId) throws IOException {
        InputStream stream = readers.remove(readerId);
        if (stream == null) return;
        stream.close();
    }

    /**
     * Blacklist rather than whitelist: a hand-made backup folder is very often
     * named in Chinese, so any non-control character has to stay allowed.
     */
    private boolean isSafeRelativePath(String path) {
        if (path == null || path.isEmpty() || path.length() > 300) return false;
        if (path.startsWith("/") || path.endsWith("/") || path.contains("//")) return false;
        return !UNSAFE_RELATIVE_PATH.matcher(path).find();
    }

    private DocumentFile resolveFile(DocumentFile root, String path) {
        DocumentFile current = root;
        for (String segment : path.split("/")) {
            if (segment.isEmpty()) return null;
            current = current.findFile(segment);
            if (current == null) return null;
        }
        return current;
    }

    private DocumentFile createUniqueDirectory(DocumentFile root, String preferredName) {
        for (int index = 0; index < 100; index++) {
            String name = index == 0 ? preferredName : preferredName + "-" + (index + 1);
            if (root.findFile(name) != null) continue;
            DocumentFile directory = root.createDirectory(name);
            if (directory != null) return directory;
        }
        return null;
    }

    private void closeWriter(String writerId) throws IOException {
        OutputStream stream = writers.remove(writerId);
        if (stream == null) return;
        try {
            stream.flush();
        } finally {
            stream.close();
        }
    }

    private boolean isSafeBackupPath(String path) {
        return "manifest.json".equals(path) || (path != null && IMAGE_PATH.matcher(path).matches());
    }

    private boolean isBackupFolder(String folderName) {
        return folderName != null && BACKUP_FOLDER.matcher(folderName).matches();
    }

    private String required(PluginCall call, String key) throws IOException {
        String value = call.getString(key);
        if (value == null || value.isEmpty()) throw new IOException("缺少 " + key);
        return value;
    }

    private String location(DocumentFile root, String childName) {
        String rootName = root.getName();
        return (rootName == null || rootName.isEmpty() ? "所选文件夹" : rootName) + " / " + childName;
    }

    private String message(Exception error) {
        return error.getMessage() == null ? "未知错误" : error.getMessage();
    }
}
