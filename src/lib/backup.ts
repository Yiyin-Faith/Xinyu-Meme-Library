import { unzipSync, zip, strFromU8, strToU8 } from 'fflate';
import { z } from 'zod';
import { db, detectMime, sha256, imageDimensions, type LibraryDB } from './library';
import type { Meme } from '../types';

const MAX_ARCHIVE = 256 * 1024 * 1024;
const MAX_EXPANDED = 512 * 1024 * 1024;
const MAX_SINGLE_FILE = 32 * 1024 * 1024;
const MAX_ENTRIES = 10002;
const IMAGE_ID = /^[a-f0-9]{64}$/;
const BACKUP_IMAGE_KEY = /^images\/[a-f0-9]{64}$/;
const timestamp = z.number().int().nonnegative().max(8640000000000000);
const hash = z.string().regex(/^[a-f0-9]{64}$/);

// `imageIncluded` and the two manifest-level fields are deliberately optional.
// That keeps every v1 full backup readable by older app versions and lets a
// delta omit an unchanged original image without changing the format version.
const metadata = z.object({
  id: hash, title: z.string().min(1).max(120), tags: z.array(z.string().min(1).max(40)).max(100),
  note: z.string().max(10000), collectionId: z.string().max(200), favorite: z.boolean(),
  createdAt: timestamp, updatedAt: timestamp, lastUsedAt: timestamp, useCount: z.number().int().nonnegative(),
  mime: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/svg+xml']),
  size: z.number().int().positive().max(32 * 1024 * 1024), width: z.number().int().positive(), height: z.number().int().positive(), source: z.string().max(2000),
  imageIncluded: z.boolean().optional(),
});
const schema = z.object({
  format: z.literal('puff-library'), version: z.literal(1), exportedAt: timestamp,
  backupType: z.enum(['full', 'incremental']).optional(),
  baseExportedAt: timestamp.optional(),
  memes: z.array(metadata).max(10000),
  collections: z.array(z.object({ id: z.string().min(1).max(200), name: z.string().min(1).max(60), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), updatedAt: timestamp })).max(1000),
  tombstones: z.array(z.object({ id: hash, deletedAt: timestamp })).max(50000),
  settings: z.object({ id: z.literal('preferences'), reduceMotion: z.boolean(), dense: z.boolean(), onlineSupplement: z.boolean(), floatingWindow: z.boolean().default(false) }).optional(),
});

export type BackupManifest = z.infer<typeof schema>;
export type BackupMemeMetadata = BackupManifest['memes'][number];
export type BackupImage = Omit<Meme, 'blob'> & { imageIncluded?: boolean; blob?: Blob };
export type Backup = BackupManifest & { images: BackupImage[] };
export type BackupSnapshot = { manifest: BackupManifest; totalBytes: number };
export type BackupMode = 'full' | 'incremental';
export type ReadyBackupExportPlan = { status: 'ready'; mode: BackupMode; snapshot: BackupSnapshot; nextBaseline: BackupSnapshot };
export type BackupExportPlan = ReadyBackupExportPlan | { status: 'missing-baseline'; mode: 'incremental' } | { status: 'no-changes'; mode: 'incremental' };
export type ExportProgress =
  | { phase: 'collecting'; completed: number; total: number; bytesCompleted: number; totalBytes: number }
  | { phase: 'packing'; completed: number; total: number; bytesCompleted: number; totalBytes: number };

function withoutImageMarker(meta: BackupMemeMetadata) {
  const { imageIncluded: _imageIncluded, ...plain } = meta;
  return plain;
}

function sameTags(a: string[], b: string[]) {
  return a.length === b.length && a.every((tag, index) => tag === b[index]);
}

function sameMemeMetadata(a: BackupMemeMetadata, b: BackupMemeMetadata) {
  const left = withoutImageMarker(a);
  const right = withoutImageMarker(b);
  return left.id === right.id && left.title === right.title && sameTags(left.tags, right.tags)
    && left.note === right.note && left.collectionId === right.collectionId && left.favorite === right.favorite
    && left.createdAt === right.createdAt && left.updatedAt === right.updatedAt && left.lastUsedAt === right.lastUsedAt
    && left.useCount === right.useCount && left.mime === right.mime && left.size === right.size
    && left.width === right.width && left.height === right.height && left.source === right.source;
}

function sameCollection(a: BackupManifest['collections'][number], b: BackupManifest['collections'][number]) {
  return a.id === b.id && a.name === b.name && a.color === b.color && a.updatedAt === b.updatedAt;
}

function sameTombstone(a: BackupManifest['tombstones'][number], b: BackupManifest['tombstones'][number]) {
  return a.id === b.id && a.deletedAt === b.deletedAt;
}

function sameSettings(a: BackupManifest['settings'], b: BackupManifest['settings']) {
  if (!a || !b) return a === b;
  return a.id === b.id && a.reduceMotion === b.reduceMotion && a.dense === b.dense
    && a.onlineSupplement === b.onlineSupplement && a.floatingWindow === b.floatingWindow;
}

function snapshotTotalBytes(manifest: BackupManifest) {
  return manifest.memes.reduce((total, meme) => total + (meme.imageIncluded === false ? 0 : meme.size), 0);
}

/**
 * Build the small JSON part of a backup without reading every image into an
 * ArrayBuffer. Android export consumes this snapshot one Blob at a time.
 */
export async function createBackupSnapshot(database: LibraryDB = db): Promise<BackupSnapshot> {
  const [collections, tombstones, settings] = await Promise.all([
    database.collections.toArray(), database.tombstones.toArray(), database.settings.get('preferences'),
  ]);
  const memes: BackupManifest['memes'] = [];
  let totalBytes = 0;
  await database.memes.orderBy('createdAt').each((meme) => {
    const { blob: _blob, ...meta } = meme;
    memes.push(metadata.parse(meta));
    totalBytes += meta.size;
  });
  return { manifest: { format: 'puff-library', version: 1, exportedAt: Date.now(), backupType: 'full', memes, collections, tombstones, settings }, totalBytes };
}

/** Returns the last locally recorded manifest that was fully written. */
export async function getBackupBaseline(database: LibraryDB = db): Promise<BackupManifest | undefined> {
  const baseline = await database.backupBaselines.get('latest');
  if (!baseline) return undefined;
  try {
    const manifest = schema.parse(baseline.manifest);
    // A stored comparison base is always a full current-state snapshot. Do
    // not trust a malformed/old incremental record as a new base.
    return manifest.backupType === 'incremental' ? undefined : manifest;
  } catch {
    return undefined;
  }
}

/**
 * Creates a full export or the smallest safe v1-compatible delta. The next
 * baseline is always a complete metadata snapshot so chained deltas compare
 * against the immediately preceding successful export.
 */
export async function createBackupExportPlan(mode: BackupMode, database: LibraryDB = db): Promise<BackupExportPlan> {
  const current = await createBackupSnapshot(database);
  if (mode === 'full') return { status: 'ready', mode, snapshot: current, nextBaseline: current };

  const baseline = await getBackupBaseline(database);
  if (!baseline) return { status: 'missing-baseline', mode };

  const baselineMemes = new Map(baseline.memes.map((meme) => [meme.id, meme]));
  const baselineCollections = new Map(baseline.collections.map((collection) => [collection.id, collection]));
  const baselineTombstones = new Map(baseline.tombstones.map((tombstone) => [tombstone.id, tombstone]));

  const memes = current.manifest.memes.flatMap((meme) => {
    const previous = baselineMemes.get(meme.id);
    if (!previous) return [{ ...meme, imageIncluded: true }];
    return sameMemeMetadata(meme, previous) ? [] : [{ ...meme, imageIncluded: false }];
  });
  const collections = current.manifest.collections.filter((collection) => {
    const previous = baselineCollections.get(collection.id);
    return !previous || !sameCollection(collection, previous);
  });
  const tombstones = current.manifest.tombstones.filter((tombstone) => {
    const previous = baselineTombstones.get(tombstone.id);
    return !previous || !sameTombstone(tombstone, previous);
  });
  const settings = sameSettings(current.manifest.settings, baseline.settings) ? undefined : current.manifest.settings;
  if (!memes.length && !collections.length && !tombstones.length && !settings) return { status: 'no-changes', mode };

  const manifest: BackupManifest = {
    format: 'puff-library', version: 1, exportedAt: current.manifest.exportedAt,
    backupType: 'incremental', baseExportedAt: baseline.exportedAt,
    memes, collections, tombstones, settings,
  };
  return { status: 'ready', mode, snapshot: { manifest, totalBytes: snapshotTotalBytes(manifest) }, nextBaseline: current };
}

/**
 * Marks a plan as a valid future incremental base. Call this only after the
 * manifest and all declared original files have been written. Android calls
 * it before optional ZIP compression so a compression failure keeps its base.
 */
export async function commitBackupExportPlan(plan: ReadyBackupExportPlan, database: LibraryDB = db) {
  await database.backupBaselines.put({ id: 'latest', manifest: plan.nextBaseline.manifest, savedAt: Date.now() });
}

function isUsableImage(blob: unknown): blob is Blob {
  return blob instanceof Blob && blob.size > 0;
}

export async function getBackupImage(id: string, database: LibraryDB = db): Promise<Blob> {
  const meme = await database.memes.get(id);
  if (!meme || !isUsableImage(meme.blob)) throw new Error('导出期间找不到一张图片，请重新开始备份');
  return meme.blob;
}

export function backupManifestText(snapshot: BackupSnapshot) {
  return JSON.stringify(snapshot.manifest, null, 2);
}

/**
 * Shared manifest reader for both flows that can meet a 心语 manifest:
 * batch import (merge into the current library) and backup restore (restore
 * per full/incremental semantics). Returning `undefined` instead of throwing
 * lets batch import degrade to plain image import.
 */
export function parseBackupManifest(value: unknown): BackupManifest | undefined {
  const result = schema.safeParse(value);
  return result.success ? result.data : undefined;
}

export async function exportBackupPlan(plan: ReadyBackupExportPlan, database: LibraryDB = db, onProgress?: (progress: ExportProgress) => void): Promise<Blob> {
  const snapshot = plan.snapshot;
  const images = snapshot.manifest.memes.filter((meme) => meme.imageIncluded !== false);
  const totalBytes = snapshot.totalBytes;
  if (totalBytes > MAX_ARCHIVE) throw new Error('当前版本单个备份最多 256 MB，请先减少库大小');
  const files: Record<string, Uint8Array> = {};
  let bytesCompleted = 0;
  onProgress?.({ phase: 'collecting', completed: 0, total: images.length, bytesCompleted, totalBytes });
  for (const [index, meme] of images.entries()) {
    const blob = await getBackupImage(meme.id, database);
    files[`images/${meme.id}`] = new Uint8Array(await blob.arrayBuffer());
    bytesCompleted += meme.size;
    onProgress?.({ phase: 'collecting', completed: index + 1, total: images.length, bytesCompleted, totalBytes });
  }
  files['manifest.json'] = strToU8(backupManifestText(snapshot));
  onProgress?.({ phase: 'packing', completed: images.length, total: images.length, bytesCompleted, totalBytes });
  return new Promise((resolve, reject) => zip(files, { level: 0 }, (error, result) => error ? reject(error) : resolve(new Blob([result as Uint8Array<ArrayBuffer>], { type: 'application/zip' }))));
}

/** Existing callers can continue to request a one-shot full ZIP. */
export async function exportLibrary(database: LibraryDB = db, onProgress?: (progress: ExportProgress) => void): Promise<Blob> {
  const plan = await createBackupExportPlan('full', database);
  if (plan.status !== 'ready') throw new Error('无法创建完整备份');
  return exportBackupPlan(plan, database, onProgress);
}

/** Archive-tool metadata that is harmless, so it is dropped instead of rejected. */
function isArchiveJunk(name: string) {
  const base = name.split('/').pop() ?? name;
  return base === '.DS_Store' || base === 'Thumbs.db' || base === 'desktop.ini'
    || name === '__MACOSX' || name.startsWith('__MACOSX/');
}

/** Absolute paths, Windows drives, backslashes, traversal and empty segments. */
function isIllegalEntryPath(name: string) {
  if (!name) return true;
  if (name.startsWith('/') || name.startsWith('\\')) return true;
  if (/^[A-Za-z]:/.test(name)) return true;
  if (name.includes('\\')) return true;
  if (/[\u0000-\u001f]/.test(name)) return true;
  const trimmed = name.replace(/\/+$/, '');
  if (!trimmed) return true;
  return trimmed.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');
}

/**
 * Only these two shapes may hold backup payload, so nothing else is ever read
 * into memory. Nested names still qualify because a hand-made archive usually
 * keeps the exported `xinyu-backup-*` wrapper folder around the payload.
 */
function isCandidateBackupFile(name: string) {
  if (!name || name.endsWith('/')) return false;
  const base = name.split('/').pop() ?? name;
  return base === 'manifest.json' || IMAGE_ID.test(base);
}

export type BackupLayout = {
  /** Raw entry name that holds manifest.json, once the wrapper is stripped. */
  manifestKey?: string;
  /** Image id (`<sha256>`) → raw entry name inside the source. */
  images: Map<string, string>;
  /** Paths that must always be refused (traversal, absolute, drive letter…). */
  illegal: string[];
  /** Paths that look legal but are not part of a 心语 backup. */
  unknown: string[];
};

/**
 * Maps a ZIP entry list or folder file list onto the only two path shapes a
 * 心语 backup may contain. It absorbs the two ways a hand-made archive usually
 * differs from an app export — a trailing `images/` directory entry, and a
 * single wrapper folder that directly holds `manifest.json` — while still
 * reporting every path that is not a legal backup path. Nothing is silently
 * dropped except archive-tool junk and directory markers.
 */
export function normalizeBackupLayout(names: string[]): BackupLayout {
  const illegal: string[] = [];
  const files: string[] = [];
  for (const name of names) {
    if (isIllegalEntryPath(name)) { illegal.push(name); continue; }
    if (name.endsWith('/')) continue;
    if (isArchiveJunk(name)) continue;
    files.push(name);
  }
  // Strip exactly one wrapper folder, and only when it directly holds the
  // manifest. A renamed folder still works; `images/` can never match.
  let root = '';
  if (files.length && files.every((name) => name.includes('/'))) {
    const heads = new Set(files.map((name) => name.split('/')[0]));
    if (heads.size === 1) {
      const candidate = [...heads][0];
      if (files.includes(`${candidate}/manifest.json`)) root = `${candidate}/`;
    }
  }
  const images = new Map<string, string>();
  const unknown: string[] = [];
  let manifestKey: string | undefined;
  for (const name of files) {
    const relative = root && name.startsWith(root) ? name.slice(root.length) : name;
    if (relative === 'manifest.json' && !manifestKey) { manifestKey = name; continue; }
    if (BACKUP_IMAGE_KEY.test(relative)) {
      const id = relative.slice('images/'.length);
      if (!images.has(id)) { images.set(id, name); continue; }
    }
    unknown.push(name);
  }
  return { manifestKey, images, illegal, unknown };
}

function samplePaths(paths: string[], limit = 3) {
  const shown = paths.slice(0, limit).join('、');
  return paths.length > limit ? `${shown} 等 ${paths.length} 项` : shown;
}

/**
 * One rejection message per failure kind, shared by ZIP and folder restore so
 * the user can tell "wrong file" apart from "damaged archive" apart from
 * "incomplete folder". `undefined` means the layout is safe to read.
 */
export function describeBackupLayoutProblem(layout: BackupLayout): string | undefined {
  if (layout.illegal.length) return `备份包含非法路径，未修改本地表情库：${samplePaths(layout.illegal)}`;
  if (layout.unknown.length) {
    const heads = new Set(layout.unknown.filter((name) => name.includes('/')).map((name) => name.split('/')[0]));
    if (!layout.manifestKey && heads.size > 1 && layout.unknown.every((name) => name.includes('/'))) {
      return `备份包含多个不相关的根目录，未修改本地表情库：${samplePaths(layout.unknown)}`;
    }
    return `备份包含未知文件或目录，未修改本地表情库：${samplePaths(layout.unknown)}`;
  }
  if (!layout.manifestKey) return '备份中未找到 manifest.json，请选择心语表情库导出的备份（ZIP 或备份文件夹）';
  return undefined;
}

/** One declared image, readable on demand so restore never loads everything. */
export type BackupImageSource = { size: number; load: () => Promise<Blob> };

/**
 * The single validation core behind both restore paths. ZIP and Android folder
 * restore reduce their source to a manifest plus one lazy reader per declared
 * image, so sizes, MIME, SHA-256, dimensions, collection integrity and every
 * error message are guaranteed to stay identical.
 */
export async function assembleBackup(manifestText: string, sources: Map<string, BackupImageSource>, checkDimensions = true, onProgress?: (completed: number, total: number) => void): Promise<Backup> {
  let manifest: BackupManifest;
  try { manifest = schema.parse(JSON.parse(manifestText)); }
  catch { throw new Error('manifest 格式不正确，未修改本地表情库'); }
  if (manifest.backupType === 'incremental' && !manifest.baseExportedAt) throw new Error('增量备份缺少比较基准信息，未修改本地表情库');
  if (new Set(manifest.memes.map((m) => m.id)).size !== manifest.memes.length) throw new Error('备份中存在重复图片记录');
  if (new Set(manifest.collections.map((c) => c.id)).size !== manifest.collections.length) throw new Error('备份中存在重复收藏夹');
  const collectionIds = new Set(manifest.collections.map((c) => c.id));
  const required = manifest.memes.filter((meta) => manifest.backupType !== 'incremental' || meta.imageIncluded !== false);
  let completed = 0;
  onProgress?.(0, required.length);
  const images: BackupImage[] = [];
  for (const meta of manifest.memes) {
    const requiresImage = manifest.backupType !== 'incremental' || meta.imageIncluded !== false;
    if (!requiresImage) { images.push({ ...meta }); continue; }
    const source = sources.get(meta.id);
    if (!source) throw new Error(`备份缺少原图：${meta.title}`);
    if (source.size !== meta.size) throw new Error(`原图大小不匹配：${meta.title}`);
    const loaded = await source.load();
    if (loaded.size !== meta.size) throw new Error(`原图大小不匹配：${meta.title}`);
    if (detectMime(new Uint8Array(await loaded.slice(0, 256).arrayBuffer())) !== meta.mime) throw new Error(`图片格式校验失败：${meta.title}`);
    if (await sha256(loaded) !== meta.id) throw new Error(`图片 hash 校验失败：${meta.title}`);
    if (checkDimensions) {
      const dims = await imageDimensions(loaded);
      if (dims.width !== meta.width || dims.height !== meta.height) throw new Error(`图片尺寸不匹配：${meta.title}`);
    }
    if (manifest.backupType !== 'incremental' && meta.collectionId && !collectionIds.has(meta.collectionId)) throw new Error(`收藏夹缺失：${meta.title}`);
    images.push({ ...meta, blob: new Blob([loaded], { type: meta.mime }) });
    completed++;
    onProgress?.(completed, required.length);
  }
  return { ...manifest, images };
}

/**
 * Reads a 心语 backup ZIP. Besides the app's own export it accepts the two
 * shapes a hand-compressed backup folder produces: a trailing `images/`
 * directory entry, and a single wrapper folder around the payload. Every
 * security rule is unchanged — traversal, absolute paths, unknown files,
 * oversize archive/member, entry count and expansion limits are still refused
 * before any merge.
 */
export async function readBackup(file: Blob, checkDimensions = true): Promise<Backup> {
  if (file.size > MAX_ARCHIVE + 8 * 1024 * 1024) throw new Error('备份包过大，最多支持 256 MB 图片');
  let expanded = 0, entries = 0;
  const names: string[] = [];
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: (entry) => {
      expanded += entry.originalSize;
      entries++;
      // Bounded from the central directory, before decompression, so neither a
      // crafted nor an accidental archive can exhaust memory.
      if (expanded > MAX_EXPANDED || entry.originalSize > MAX_SINGLE_FILE || entries > MAX_ENTRIES) throw new Error('压缩包解压体积或文件数超过限制');
      names.push(entry.name);
      return isCandidateBackupFile(entry.name);
    } });
  } catch (error) { throw new Error(`无法读取备份：${error instanceof Error ? error.message : 'ZIP 损坏'}`); }

  const layout = normalizeBackupLayout(names);
  const problem = describeBackupLayoutProblem(layout);
  if (problem) throw new Error(problem);
  const manifestKey = layout.manifestKey;
  if (!manifestKey) throw new Error('备份中未找到 manifest.json，请选择心语表情库导出的备份（ZIP 或备份文件夹）');
  const manifestData = unzipped[manifestKey];
  if (!manifestData) throw new Error('备份中的 manifest.json 无法读取，未修改本地表情库');
  const sources = new Map<string, BackupImageSource>();
  for (const [id, key] of layout.images) {
    const data = unzipped[key];
    if (data) sources.set(id, { size: data.length, load: async () => new Blob([data as Uint8Array<ArrayBuffer>]) });
  }
  return assembleBackup(strFromU8(manifestData), sources, checkDimensions);
}

function asMeme(incoming: BackupImage, blob: Blob): Meme {
  const { imageIncluded: _imageIncluded, blob: _blob, ...metadataOnly } = incoming;
  return { ...metadataOnly, blob };
}

export async function mergeBackup(backup: Backup, applyDeletions: boolean, restoreSettings: boolean, database: LibraryDB = db) {
  let added = 0, updated = 0, skipped = 0, deleted = 0;
  await database.transaction('rw', database.memes, database.collections, database.tombstones, database.settings, async () => {
    for (const collection of backup.collections) {
      const existing = await database.collections.get(collection.id);
      if (!existing || existing.updatedAt < collection.updatedAt) await database.collections.put(collection);
    }
    if (applyDeletions) for (const tomb of backup.tombstones) {
      const existing = await database.memes.get(tomb.id);
      const previous = await database.tombstones.get(tomb.id);
      if (!previous || previous.deletedAt < tomb.deletedAt) await database.tombstones.put(tomb);
      if (existing && existing.updatedAt <= tomb.deletedAt) { await database.memes.delete(tomb.id); deleted++; }
    }
    for (const incoming of backup.images) {
      const local = await database.memes.get(incoming.id);
      const tomb = await database.tombstones.get(incoming.id);
      if (tomb && tomb.deletedAt >= incoming.updatedAt) { skipped++; continue; }
      if (incoming.collectionId && !await database.collections.get(incoming.collectionId)) {
        throw new Error(backup.backupType === 'incremental'
          ? `增量备份缺少收藏夹“${incoming.collectionId}”，请先恢复它所依赖的完整备份`
          : `收藏夹缺失：${incoming.title}`);
      }
      // A record may only be written when real image bytes exist for it. A
      // metadata-only incremental entry reuses the local blob, but never a
      // missing or zero-length one, otherwise the restored card would render
      // an unreadable image.
      const source = isUsableImage(incoming.blob) ? incoming.blob
        : isUsableImage(local?.blob) ? local.blob
          : undefined;
      if (!source) {
        throw new Error(local
          ? `本机“${incoming.title}”的原图已损坏，增量备份无法修复它，请先恢复包含原图的完整备份`
          : `增量备份缺少“${incoming.title}”的原图，请先恢复它所依赖的完整备份`);
      }
      const candidate = asMeme(incoming, source);
      if (!local) { await database.memes.put(candidate); added++; }
      else if (incoming.updatedAt > local.updatedAt) {
        await database.memes.put({ ...candidate, lastUsedAt: Math.max(local.lastUsedAt, incoming.lastUsedAt), useCount: Math.max(local.useCount, incoming.useCount) });
        updated++;
      } else if (incoming.lastUsedAt > local.lastUsedAt || incoming.useCount > local.useCount) {
        await database.memes.put({ ...local, lastUsedAt: Math.max(local.lastUsedAt, incoming.lastUsedAt), useCount: Math.max(local.useCount, incoming.useCount) });
        updated++;
      } else { skipped++; }
      if (tomb && incoming.updatedAt > tomb.deletedAt) await database.tombstones.delete(incoming.id);
    }
    if (restoreSettings && backup.settings) await database.settings.put(backup.settings);
  });
  return { added, updated, skipped, deleted };
}
