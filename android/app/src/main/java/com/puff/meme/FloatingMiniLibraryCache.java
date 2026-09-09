package com.puff.meme;

import android.content.Context;
import android.util.Base64;

import androidx.annotation.Nullable;

import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.text.Collator;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * A tiny private recovery cache for the native floating panel.
 *
 * It intentionally keeps only image metadata plus low-resolution thumbnails
 * received page-by-page from the WebView. The original meme Blobs stay in
 * IndexedDB and are never copied into this cache or public media storage.
 */
final class FloatingMiniLibraryCache {
    private static final String ROOT_NAME = "xinyu-mini-library";
    private static final String CATALOG_NAME = "catalog.json";
    private static final String THUMBNAILS_NAME = "thumbnails";
    private static final int MAX_THUMBNAIL_BYTES = 96 * 1024;
    private static volatile FloatingMiniLibraryCache instance;

    static FloatingMiniLibraryCache get(Context context) {
        FloatingMiniLibraryCache current = instance;
        if (current != null) return current;
        synchronized (FloatingMiniLibraryCache.class) {
            if (instance == null) instance = new FloatingMiniLibraryCache(context.getApplicationContext());
            return instance;
        }
    }

    static final class CachedSnapshot {
        final boolean catalogKnown;
        @Nullable final JSONObject payload;

        CachedSnapshot(boolean catalogKnown, @Nullable JSONObject payload) {
            this.catalogKnown = catalogKnown;
            this.payload = payload;
        }
    }

    private final Object lock = new Object();
    private final File root;
    private final File catalogFile;
    private final File thumbnailDirectory;
    private List<Entry> entries = Collections.emptyList();
    private boolean catalogKnown;
    private boolean loaded;

    private FloatingMiniLibraryCache(Context context) {
        root = new File(context.getFilesDir(), ROOT_NAME);
        catalogFile = new File(root, CATALOG_NAME);
        thumbnailDirectory = new File(root, THUMBNAILS_NAME);
    }

    void syncCatalog(JSONArray input) {
        synchronized (lock) {
            LinkedHashMap<String, Entry> next = new LinkedHashMap<>();
            for (int index = 0; index < input.length(); index++) {
                JSONObject value = input.optJSONObject(index);
                Entry entry = Entry.fromJson(value);
                if (entry != null) next.put(entry.id, entry);
            }
            entries = Collections.unmodifiableList(new ArrayList<>(next.values()));
            catalogKnown = true;
            loaded = true;
            writeCatalogLocked();
            pruneThumbnailsLocked(next.keySet());
        }
    }

    void cacheSnapshot(JSONObject snapshot) {
        synchronized (lock) {
            ensureLoadedLocked();
            JSONArray items = snapshot.optJSONArray("items");
            if (items == null) return;
            for (int index = 0; index < items.length(); index++) {
                JSONObject item = items.optJSONObject(index);
                if (item == null) continue;
                String id = item.optString("id", "").trim();
                String thumbnail = item.optString("thumbnail", "");
                if (!id.isEmpty() && !thumbnail.isEmpty()) writeThumbnailLocked(id, thumbnail);
            }
        }
    }

    CachedSnapshot snapshot(JSONObject request) {
        synchronized (lock) {
            ensureLoadedLocked();
            if (!catalogKnown) return new CachedSnapshot(false, null);
            try {
                String filter = request.optString("filter", "frequent");
                String search = request.optString("search", "");
                String selectedTag = normalize(request.optString("tag", ""));
                Set<String> recommendationTags = normalizedTags(request.optJSONArray("recommendedTags"));
                ArrayList<Entry> selected = new ArrayList<>();
                for (Entry entry : entries) {
                    if (!matchesSearch(entry, search)) continue;
                    if ("tag".equals(filter) && !entry.hasTag(selectedTag)) continue;
                    if ("recommended".equals(filter) && !entry.hasAnyTag(recommendationTags)) continue;
                    selected.add(entry);
                }

                if ("recent".equals(filter)) {
                    ArrayList<Entry> used = new ArrayList<>();
                    for (Entry entry : selected) if (entry.lastUsedAt > 0) used.add(entry);
                    if (!used.isEmpty()) selected = used;
                    Collections.sort(selected, (left, right) -> compareRecent(left, right));
                } else if ("frequent".equals(filter)) {
                    Collections.sort(selected, (left, right) -> compareFrequent(left, right));
                } else {
                    Collections.sort(selected, (left, right) -> compareDefault(left, right));
                }

                int offset = Math.max(0, request.optInt("offset", 0));
                int limit = Math.max(1, Math.min(30, request.optInt("limit", 24)));
                int end = Math.min(selected.size(), offset + limit);
                JSONArray page = new JSONArray();
                for (int index = Math.min(offset, selected.size()); index < end; index++) {
                    Entry entry = selected.get(index);
                    JSONObject item = new JSONObject();
                    item.put("id", entry.id);
                    item.put("title", entry.title);
                    item.put("thumbnail", readThumbnailLocked(entry.id));
                    page.put(item);
                }

                JSONObject payload = new JSONObject();
                payload.put("ready", true);
                payload.put("total", selected.size());
                payload.put("libraryTotal", entries.size());
                payload.put("tags", tagsLocked());
                payload.put("items", page);
                return new CachedSnapshot(true, payload);
            } catch (Exception ignored) {
                return new CachedSnapshot(true, null);
            }
        }
    }

    private void ensureLoadedLocked() {
        if (loaded) return;
        loaded = true;
        if (!catalogFile.isFile()) return;
        try {
            Object decoded = new JSONTokener(readText(catalogFile)).nextValue();
            if (!(decoded instanceof JSONObject)) return;
            JSONObject rootJson = (JSONObject) decoded;
            JSONArray values = rootJson.optJSONArray("items");
            if (values == null) return;
            LinkedHashMap<String, Entry> next = new LinkedHashMap<>();
            for (int index = 0; index < values.length(); index++) {
                Entry entry = Entry.fromJson(values.optJSONObject(index));
                if (entry != null) next.put(entry.id, entry);
            }
            entries = Collections.unmodifiableList(new ArrayList<>(next.values()));
            catalogKnown = true;
        } catch (Exception ignored) {
            entries = Collections.emptyList();
            catalogKnown = false;
        }
    }

    private void writeCatalogLocked() {
        try {
            if (!root.exists() && !root.mkdirs()) return;
            JSONArray values = new JSONArray();
            for (Entry entry : entries) values.put(entry.toJson());
            JSONObject payload = new JSONObject();
            payload.put("version", 1);
            payload.put("items", values);
            writeTextAtomically(catalogFile, payload.toString());
        } catch (Exception ignored) {
        }
    }

    private JSONArray tagsLocked() {
        Map<String, TagSummary> summaries = new HashMap<>();
        for (Entry entry : entries) {
            for (String tag : entry.tags) {
                String key = normalize(tag);
                if (key.isEmpty()) continue;
                TagSummary summary = summaries.get(key);
                if (summary == null) {
                    summary = new TagSummary(tag);
                    summaries.put(key, summary);
                }
                summary.count++;
                summary.useCount += entry.useCount;
                summary.lastUsedAt = Math.max(summary.lastUsedAt, entry.lastUsedAt);
            }
        }
        ArrayList<TagSummary> values = new ArrayList<>(summaries.values());
        final Collator collator = Collator.getInstance(Locale.CHINA);
        Collections.sort(values, (left, right) -> {
            int compare = Long.compare(right.lastUsedAt, left.lastUsedAt);
            if (compare != 0) return compare;
            compare = Long.compare(right.useCount, left.useCount);
            if (compare != 0) return compare;
            compare = Integer.compare(right.count, left.count);
            if (compare != 0) return compare;
            return collator.compare(left.name, right.name);
        });
        JSONArray tags = new JSONArray();
        for (TagSummary value : values) {
            JSONObject tag = new JSONObject();
            try {
                tag.put("name", value.name);
                tag.put("count", value.count);
            } catch (Exception ignored) {
            }
            tags.put(tag);
        }
        return tags;
    }

    private void writeThumbnailLocked(String id, String dataUrl) {
        try {
            int comma = dataUrl.indexOf(',');
            if (comma < 0) return;
            String encoded = dataUrl.substring(comma + 1);
            if (encoded.length() > MAX_THUMBNAIL_BYTES * 2) return;
            byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
            if (bytes.length == 0 || bytes.length > MAX_THUMBNAIL_BYTES) return;
            if (!thumbnailDirectory.exists() && !thumbnailDirectory.mkdirs()) return;
            File output = thumbnailFile(id);
            File temporary = new File(thumbnailDirectory, output.getName() + ".tmp");
            try (FileOutputStream stream = new FileOutputStream(temporary, false)) {
                stream.write(bytes);
            }
            if (!temporary.renameTo(output)) {
                // This is a replaceable cache file, never a user original.
                output.delete();
                temporary.renameTo(output);
            }
        } catch (Exception ignored) {
        }
    }

    private String readThumbnailLocked(String id) {
        File file = thumbnailFile(id);
        if (!file.isFile() || file.length() <= 0 || file.length() > MAX_THUMBNAIL_BYTES) return "";
        try {
            byte[] bytes = readBytes(file);
            return "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP);
        } catch (Exception ignored) {
            return "";
        }
    }

    private void pruneThumbnailsLocked(Set<String> currentIds) {
        if (!thumbnailDirectory.isDirectory()) return;
        HashSet<String> allowed = new HashSet<>();
        for (String id : currentIds) allowed.add(thumbnailFile(id).getName());
        File[] files = thumbnailDirectory.listFiles();
        if (files == null) return;
        for (File file : files) {
            if (!allowed.contains(file.getName())) file.delete();
        }
    }

    private File thumbnailFile(String id) {
        String safe = id.replaceAll("[^A-Za-z0-9_-]", "_");
        if (safe.isEmpty()) safe = Integer.toHexString(id.hashCode());
        return new File(thumbnailDirectory, safe + ".jpg");
    }

    private static int compareRecent(Entry left, Entry right) {
        int compare = Long.compare(right.lastUsedAt, left.lastUsedAt);
        return compare != 0 ? compare : Long.compare(right.createdAt, left.createdAt);
    }

    private static int compareFrequent(Entry left, Entry right) {
        int compare = Long.compare(right.useCount, left.useCount);
        if (compare != 0) return compare;
        compare = Long.compare(right.lastUsedAt, left.lastUsedAt);
        return compare != 0 ? compare : Long.compare(right.createdAt, left.createdAt);
    }

    private static int compareDefault(Entry left, Entry right) {
        int compare = Long.compare(right.lastUsedAt, left.lastUsedAt);
        if (compare != 0) return compare;
        compare = Long.compare(right.useCount, left.useCount);
        return compare != 0 ? compare : Long.compare(right.createdAt, left.createdAt);
    }

    private static boolean matchesSearch(Entry entry, String search) {
        String normalized = normalize(search);
        if (normalized.isEmpty()) return true;
        String haystack = normalize(entry.title + " " + join(entry.tags) + " " + entry.note);
        String[] terms = normalized.split("\\s+");
        for (String term : terms) {
            String current = term.replaceFirst("^#", "");
            if (!current.isEmpty() && !haystack.contains(current)) return false;
        }
        return true;
    }

    private static Set<String> normalizedTags(@Nullable JSONArray values) {
        LinkedHashSet<String> result = new LinkedHashSet<>();
        if (values == null) return result;
        for (int index = 0; index < values.length(); index++) {
            String value = normalize(values.optString(index, ""));
            if (!value.isEmpty()) result.add(value);
        }
        return result;
    }

    private static String join(List<String> values) {
        StringBuilder result = new StringBuilder();
        for (String value : values) {
            if (result.length() > 0) result.append(' ');
            result.append(value);
        }
        return result.toString();
    }

    private static String normalize(String value) {
        if (value == null) return "";
        return Normalizer.normalize(value, Normalizer.Form.NFKC).trim().toLowerCase(Locale.ROOT);
    }

    private static String readText(File file) throws Exception {
        return new String(readBytes(file), StandardCharsets.UTF_8);
    }

    private static byte[] readBytes(File file) throws Exception {
        try (FileInputStream input = new FileInputStream(file); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            return output.toByteArray();
        }
    }

    private static void writeTextAtomically(File destination, String value) throws Exception {
        File temporary = new File(destination.getParentFile(), destination.getName() + ".tmp");
        try (FileOutputStream output = new FileOutputStream(temporary, false)) {
            output.write(value.getBytes(StandardCharsets.UTF_8));
        }
        if (!temporary.renameTo(destination)) {
            destination.delete();
            temporary.renameTo(destination);
        }
    }

    private static final class TagSummary {
        final String name;
        int count;
        long useCount;
        long lastUsedAt;

        TagSummary(String name) {
            this.name = name;
        }
    }

    private static final class Entry {
        final String id;
        final String title;
        final List<String> tags;
        final String note;
        final long createdAt;
        final long updatedAt;
        final long lastUsedAt;
        final long useCount;

        Entry(String id, String title, List<String> tags, String note, long createdAt, long updatedAt, long lastUsedAt, long useCount) {
            this.id = id;
            this.title = title;
            this.tags = tags;
            this.note = note;
            this.createdAt = createdAt;
            this.updatedAt = updatedAt;
            this.lastUsedAt = lastUsedAt;
            this.useCount = useCount;
        }

        @Nullable
        static Entry fromJson(@Nullable JSONObject value) {
            if (value == null) return null;
            String id = value.optString("id", "").trim();
            if (id.isEmpty()) return null;
            ArrayList<String> tags = new ArrayList<>();
            JSONArray rawTags = value.optJSONArray("tags");
            if (rawTags != null) {
                for (int index = 0; index < rawTags.length(); index++) {
                    String tag = rawTags.optString(index, "").trim();
                    if (!tag.isEmpty()) tags.add(tag);
                }
            }
            return new Entry(
                id,
                value.optString("title", "未命名表情"),
                Collections.unmodifiableList(tags),
                value.optString("note", ""),
                value.optLong("createdAt", 0L),
                value.optLong("updatedAt", 0L),
                value.optLong("lastUsedAt", 0L),
                value.optLong("useCount", 0L)
            );
        }

        JSONObject toJson() {
            JSONObject value = new JSONObject();
            try {
                value.put("id", id);
                value.put("title", title);
                value.put("tags", new JSONArray(tags));
                value.put("note", note);
                value.put("createdAt", createdAt);
                value.put("updatedAt", updatedAt);
                value.put("lastUsedAt", lastUsedAt);
                value.put("useCount", useCount);
            } catch (Exception ignored) {
            }
            return value;
        }

        boolean hasTag(String expected) {
            if (expected.isEmpty()) return false;
            for (String tag : tags) if (expected.equals(normalize(tag))) return true;
            return false;
        }

        boolean hasAnyTag(Set<String> expected) {
            if (expected.isEmpty()) return false;
            for (String tag : tags) if (expected.contains(normalize(tag))) return true;
            return false;
        }
    }
}
