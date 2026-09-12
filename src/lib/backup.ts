import { unzipSync, zip, strFromU8, strToU8 } from 'fflate';
import { z } from 'zod';
import { db, detectMime, sha256, imageDimensions, type LibraryDB } from './library';
import type { Meme } from '../types';

const MAX_ARCHIVE = 256 * 1024 * 1024;
const MAX_EXPANDED = 512 * 1024 * 1024;
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

export async function getBackupImage(id: string, database: LibraryDB = db): Promise<Blob> {
  const meme = await database.memes.get(id);
  if (!meme) throw new Error('导出期间找不到一张图片，请重新开始备份');
  return meme.blob;
}

export function backupManifestText(snapshot: BackupSnapshot) {
  return JSON.stringify(snapshot.manifest, null, 2);
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

export async function readBackup(file: Blob, checkDimensions = true): Promise<Backup> {
  if (file.size > MAX_ARCHIVE + 8 * 1024 * 1024) throw new Error('备份包过大，最多支持 256 MB 图片');
  let expanded = 0, entries = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: (entry) => {
      expanded += entry.originalSize;
      entries++;
      if (expanded > MAX_EXPANDED || entry.originalSize > 32 * 1024 * 1024 || entries > 10002) throw new Error('压缩包解压体积或文件数超过限制');
      if (entry.name !== 'manifest.json' && !/^images\/[a-f0-9]{64}$/.test(entry.name)) throw new Error('备份包含未知路径，请使用心语表情库导出的完整备份');
      return true;
    } });
  } catch (error) { throw new Error(`无法读取备份：${error instanceof Error ? error.message : 'ZIP 损坏'}`); }
  if (!files['manifest.json']) throw new Error('缺少 manifest.json，请选择心语表情库完整备份 ZIP；普通图片请使用导入表情');
  let manifest: BackupManifest;
  try { manifest = schema.parse(JSON.parse(strFromU8(files['manifest.json']))); }
  catch { throw new Error('备份格式、版本或元数据不正确，未修改本地表情库'); }
  if (manifest.backupType === 'incremental' && !manifest.baseExportedAt) throw new Error('增量备份缺少比较基准信息，未修改本地表情库');
  if (new Set(manifest.memes.map((m) => m.id)).size !== manifest.memes.length) throw new Error('备份中存在重复图片记录');
  if (new Set(manifest.collections.map((c) => c.id)).size !== manifest.collections.length) throw new Error('备份中存在重复收藏夹');
  const collectionIds = new Set(manifest.collections.map((c) => c.id));
  const images: BackupImage[] = [];
  for (const meta of manifest.memes) {
    const requiresImage = manifest.backupType !== 'incremental' || meta.imageIncluded !== false;
    const data = files[`images/${meta.id}`];
    if (!requiresImage) {
      images.push({ ...meta });
      continue;
    }
    if (!data || data.length !== meta.size) throw new Error(`原图缺失或大小错误：${meta.title}`);
    if (detectMime(data) !== meta.mime) throw new Error(`图片格式校验失败：${meta.title}`);
    const blob = new Blob([data as Uint8Array<ArrayBuffer>], { type: meta.mime });
    if (await sha256(blob) !== meta.id) throw new Error(`图片校验失败：${meta.title}`);
    if (checkDimensions) {
      const dims = await imageDimensions(blob);
      if (dims.width !== meta.width || dims.height !== meta.height) throw new Error(`图片尺寸不匹配：${meta.title}`);
    }
    if (manifest.backupType !== 'incremental' && meta.collectionId && !collectionIds.has(meta.collectionId)) throw new Error(`收藏夹缺失：${meta.title}`);
    images.push({ ...meta, blob });
  }
  return { ...manifest, images };
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
      if (!local && !incoming.blob) throw new Error(`增量备份缺少“${incoming.title}”的原图，请先恢复它所依赖的完整备份`);
      const candidate = asMeme(incoming, incoming.blob ?? local!.blob);
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
