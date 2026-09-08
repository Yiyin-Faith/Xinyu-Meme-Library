import Dexie, { type EntityTable } from 'dexie';
import type { Collection, Meme, Settings, Tombstone } from '../types';

const legacyDefaultCollectionIds = ['daily', 'cute', 'work'];

export class LibraryDB extends Dexie {
  memes!: EntityTable<Meme, 'id'>;
  collections!: EntityTable<Collection, 'id'>;
  tombstones!: EntityTable<Tombstone, 'id'>;
  settings!: EntityTable<Settings, 'id'>;
  constructor(name = 'puff-library') {
    super(name);
    this.version(1).stores({ memes: 'id, title, collectionId, *tags, createdAt, lastUsedAt', collections: 'id', tombstones: 'id', settings: 'id' });
    // v1 ordered collections by an unindexed field, which throws while mounting the UI.
    this.version(2).stores({ collections: 'id, updatedAt' });
    this.version(3).stores({ memes: 'id, title, collectionId, *tags, createdAt, lastUsedAt', collections: 'id, updatedAt', tombstones: 'id', settings: 'id' }).upgrade(async (tx) => {
      // Only remove the old built-in demo records; user-imported images always have a different source.
      await tx.table('memes').filter((m) => m.source === '心语表情库原创示例').delete();
      for (const collectionId of legacyDefaultCollectionIds) {
        if (await tx.table('memes').where('collectionId').equals(collectionId).count() === 0) await tx.table('collections').delete(collectionId);
      }
    });
    this.version(4).stores({ memes: 'id, title, collectionId, *tags, createdAt, lastUsedAt', collections: 'id, updatedAt', tombstones: 'id', settings: 'id' }).upgrade(async (tx) => {
      await tx.table('settings').toCollection().modify((settings) => {
        if (typeof settings.floatingWindow !== 'boolean') settings.floatingWindow = false;
      });
    });
  }
}
export const db = new LibraryDB();
export const MAX_IMAGE_SIZE = 32 * 1024 * 1024;
export const defaultSettings: Settings = { id: 'preferences', reduceMotion: false, dense: true, onlineSupplement: false, floatingWindow: false };
export const defaultCollections: Collection[] = [
  { id: 'daily', name: '日常营业', color: '#96af91', updatedAt: 1 },
  { id: 'cute', name: '可爱即正义', color: '#dda898', updatedAt: 1 },
  { id: 'work', name: '打工人的精神状态', color: '#aaa2c1', updatedAt: 1 },
];
const collectionColors = ['#9cb99a', '#dba79b', '#aaa2c3', '#d5b27c'];

export interface ImportOptions {
  collectionId?: string;
  title?: string;
  tags?: string[];
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
export async function sha256(blob: Blob) {
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, '0')).join('');
}
export function detectMime(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (String.fromCharCode(...bytes.slice(0, 6)).match(/^GIF8[79]a$/)) return 'image/gif';
  if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  if (String.fromCharCode(...bytes.slice(4, 12)).match(/^ftypavif/)) return 'image/avif';
  const text = new TextDecoder().decode(bytes.slice(0, 256)).trimStart().toLowerCase();
  if (text.startsWith('<svg') || text.startsWith('<?xml') && text.includes('<svg')) return 'image/svg+xml';
  throw new Error('仅支持有效的 PNG、JPG、GIF、WebP、AVIF 和 SVG 图片');
}
export async function imageDimensions(blob: Blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (!img.naturalWidth || img.naturalWidth * img.naturalHeight > 40_000_000) throw new Error('图片尺寸过大，最多支持 4000 万像素');
    return { width: img.naturalWidth, height: img.naturalHeight };
  } catch (error) { throw new Error(error instanceof Error && error.message.includes('4000') ? error.message : '图片损坏或设备不支持此格式'); }
  finally { URL.revokeObjectURL(url); }
}
export async function prepareImage(file: Blob, title: string, collectionId = '', source = '本地导入'): Promise<Meme> {
  if (file.size > MAX_IMAGE_SIZE || !file.size) throw new Error('单张图片必须在 0～32 MB 之间');
  const mime = detectMime(new Uint8Array(await file.slice(0, 256).arrayBuffer()));
  const blob = new Blob([file], { type: mime });
  const [id, dimensions] = await Promise.all([sha256(blob), imageDimensions(blob)]);
  const now = Date.now();
  return { id, blob, ...dimensions, title: title.replace(/\.[^.]+$/, '').slice(0, 120) || '未命名表情', tags: [], note: '', collectionId, favorite: false, createdAt: now, updatedAt: now, lastUsedAt: 0, useCount: 0, mime, size: blob.size, source };
}
export function normalizeTags(tags: string[]) {
  const seen = new Set<string>();
  return tags.map((tag) => tag.normalize('NFKC').trim().replace(/^#+/, '').trim()).filter((tag) => {
    const key = tag.toLocaleLowerCase();
    if (!tag || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 30);
}
export async function getOrCreateCollection(name: string) {
  const trimmed = name.normalize('NFKC').trim().slice(0, 40);
  if (!trimmed) return undefined;
  const normalized = trimmed.toLocaleLowerCase();
  const existing = await db.collections.filter((collection) => collection.name.normalize('NFKC').trim().toLocaleLowerCase() === normalized).first();
  if (existing) return existing;
  const count = await db.collections.count();
  const collection: Collection = { id: crypto.randomUUID(), name: trimmed, color: collectionColors[count % collectionColors.length], updatedAt: Date.now() };
  await db.collections.add(collection);
  return collection;
}
export async function importImages(files: File[], options: ImportOptions | string = '') {
  const importOptions: ImportOptions = typeof options === 'string' ? { collectionId: options } : options;
  const collectionId = importOptions.collectionId ?? '';
  const customTitle = importOptions.title?.trim().slice(0, 120) ?? '';
  const tags = normalizeTags(importOptions.tags ?? []);
  let added = 0, skipped = 0;
  const errors: string[] = [];
  for (const [index, file] of files.entries()) {
    try {
      const title = customTitle ? (files.length === 1 ? customTitle : `${customTitle} ${index + 1}`) : file.name;
      const meme = await prepareImage(file, title, collectionId);
      if (customTitle) meme.title = title;
      meme.tags = tags;
      await db.transaction('rw', db.memes, db.tombstones, async () => {
        if (await db.memes.get(meme.id)) { skipped++; return; }
        await db.memes.add(meme);
        await db.tombstones.delete(meme.id);
        added++;
      });
    } catch (error) { errors.push(`${file.name}: ${error instanceof Error ? error.message : '导入失败'}`); }
  }
  return { added, skipped, errors };
}
export async function updateMeme(id: string, changes: Partial<Pick<Meme, 'title' | 'tags' | 'note' | 'collectionId' | 'favorite'>>) {
  await db.memes.update(id, { ...changes, updatedAt: Date.now() });
}
export async function markUsed(id: string) {
  await db.memes.where('id').equals(id).modify((m) => { m.lastUsedAt = Date.now(); m.useCount++; });
}
export async function deleteMemes(ids: string[]) {
  await db.transaction('rw', db.memes, db.tombstones, async () => {
    await db.tombstones.bulkPut(ids.map((id) => ({ id, deletedAt: Date.now() })));
    await db.memes.bulkDelete(ids);
  });
}
export function matchesSearch(meme: Pick<Meme, 'title' | 'tags' | 'note'>, search: string) {
  const haystack = `${meme.title} ${meme.tags.join(' ')} ${meme.note}`.normalize('NFKC').toLocaleLowerCase();
  return search.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean).every((term) => haystack.includes(term.replace(/^#/, '')));
}
let seedPromise: Promise<void> | undefined;
export function initializeLibrary() {
  return seedPromise ??= (async () => {
    if (await db.settings.get('preferences')) return;
    await db.transaction('rw', db.settings, async () => {
      if (await db.settings.get('preferences')) return;
      await db.settings.put(defaultSettings);
    });
    navigator.storage?.persist?.().catch(() => undefined);
  })().catch((error) => { seedPromise = undefined; throw error; });
}
