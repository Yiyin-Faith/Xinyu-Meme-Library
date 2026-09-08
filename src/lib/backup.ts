import { unzipSync, zip, strFromU8, strToU8 } from 'fflate';
import { z } from 'zod';
import { db, detectMime, sha256, imageDimensions, type LibraryDB } from './library';
import type { Meme } from '../types';

const MAX_ARCHIVE = 256 * 1024 * 1024;
const MAX_EXPANDED = 512 * 1024 * 1024;
const timestamp = z.number().int().nonnegative().max(8640000000000000);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const metadata = z.object({
  id: hash, title: z.string().min(1).max(120), tags: z.array(z.string().min(1).max(40)).max(100),
  note: z.string().max(10000), collectionId: z.string().max(200), favorite: z.boolean(),
  createdAt: timestamp, updatedAt: timestamp, lastUsedAt: timestamp, useCount: z.number().int().nonnegative(),
  mime: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/svg+xml']),
  size: z.number().int().positive().max(32 * 1024 * 1024), width: z.number().int().positive(), height: z.number().int().positive(), source: z.string().max(2000),
});
const schema = z.object({
  format: z.literal('puff-library'), version: z.literal(1), exportedAt: timestamp,
  memes: z.array(metadata).max(10000),
  collections: z.array(z.object({ id: z.string().min(1).max(200), name: z.string().min(1).max(60), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), updatedAt: timestamp })).max(1000),
  tombstones: z.array(z.object({ id: hash, deletedAt: timestamp })).max(50000),
  settings: z.object({ id: z.literal('preferences'), reduceMotion: z.boolean(), dense: z.boolean(), onlineSupplement: z.boolean(), floatingWindow: z.boolean().default(false) }).optional(),
});
export type Backup = z.infer<typeof schema> & { images: Meme[] };
export type ExportProgress =
  | { phase: 'collecting'; completed: number; total: number; bytesCompleted: number; totalBytes: number }
  | { phase: 'packing'; completed: number; total: number; bytesCompleted: number; totalBytes: number };

export async function exportLibrary(database: LibraryDB = db, onProgress?: (progress: ExportProgress) => void): Promise<Blob> {
  const snapshot = await database.transaction('r', database.memes, database.collections, database.tombstones, database.settings, async () => ({
    memes: await database.memes.toArray(), collections: await database.collections.toArray(), tombstones: await database.tombstones.toArray(), settings: await database.settings.get('preferences'),
  }));
  const totalBytes = snapshot.memes.reduce((n, m) => n + m.size, 0);
  if (totalBytes > MAX_ARCHIVE) throw new Error('当前版本单个备份最多 256 MB，请先减少库大小');
  const files: Record<string, Uint8Array> = {};
  let bytesCompleted = 0;
  onProgress?.({ phase: 'collecting', completed: 0, total: snapshot.memes.length, bytesCompleted, totalBytes });
  for (const [index, meme] of snapshot.memes.entries()) {
    files[`images/${meme.id}`] = new Uint8Array(await meme.blob.arrayBuffer());
    bytesCompleted += meme.size;
    onProgress?.({ phase: 'collecting', completed: index + 1, total: snapshot.memes.length, bytesCompleted, totalBytes });
  }
  files['manifest.json'] = strToU8(JSON.stringify({ format: 'puff-library', version: 1, exportedAt: Date.now(), ...snapshot, memes: snapshot.memes.map(({ blob: _blob, ...meta }) => meta) }, null, 2));
  onProgress?.({ phase: 'packing', completed: snapshot.memes.length, total: snapshot.memes.length, bytesCompleted, totalBytes });
  return new Promise((resolve, reject) => zip(files, { level: 0 }, (error, result) => error ? reject(error) : resolve(new Blob([result as Uint8Array<ArrayBuffer>], { type: 'application/zip' }))));
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
  let manifest: z.infer<typeof schema>;
  try { manifest = schema.parse(JSON.parse(strFromU8(files['manifest.json']))); }
  catch { throw new Error('备份格式、版本或元数据不正确，未修改本地表情库'); }
  if (new Set(manifest.memes.map((m) => m.id)).size !== manifest.memes.length) throw new Error('备份中存在重复图片记录');
  if (new Set(manifest.collections.map((c) => c.id)).size !== manifest.collections.length) throw new Error('备份中存在重复收藏夹');
  const collectionIds = new Set(manifest.collections.map((c) => c.id));
  const images: Meme[] = [];
  for (const meta of manifest.memes) {
    const data = files[`images/${meta.id}`];
    if (!data || data.length !== meta.size) throw new Error(`原图缺失或大小错误：${meta.title}`);
    if (detectMime(data) !== meta.mime) throw new Error(`图片格式校验失败：${meta.title}`);
    const blob = new Blob([data as Uint8Array<ArrayBuffer>], { type: meta.mime });
    if (await sha256(blob) !== meta.id) throw new Error(`图片校验失败：${meta.title}`);
    if (checkDimensions) {
      const dims = await imageDimensions(blob);
      if (dims.width !== meta.width || dims.height !== meta.height) throw new Error(`图片尺寸不匹配：${meta.title}`);
    }
    if (meta.collectionId && !collectionIds.has(meta.collectionId)) throw new Error(`收藏夹缺失：${meta.title}`);
    images.push({ ...meta, blob });
  }
  return { ...manifest, images };
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
      if (!local) { await database.memes.put(incoming); added++; }
      else if (incoming.updatedAt > local.updatedAt) { await database.memes.put({ ...incoming, lastUsedAt: Math.max(local.lastUsedAt, incoming.lastUsedAt), useCount: Math.max(local.useCount, incoming.useCount) }); updated++; }
      else { skipped++; }
      if (tomb && incoming.updatedAt > tomb.deletedAt) await database.tombstones.delete(incoming.id);
    }
    if (restoreSettings && backup.settings) await database.settings.put(backup.settings);
  });
  return { added, updated, skipped, deleted };
}
