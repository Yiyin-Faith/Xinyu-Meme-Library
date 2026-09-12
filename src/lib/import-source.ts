import { strFromU8, unzipSync } from 'fflate';
import { describeBackupLayoutProblem, isBackupImagePath, normalizeBackupLayout, parseBackupManifest, readBackup, type Backup, type BackupManifest } from './backup';
import { sha256, type PrefilledImage } from './library';

const MAX_IMPORT_ARCHIVE = 256 * 1024 * 1024;
const MAX_IMPORT_EXPANDED = 512 * 1024 * 1024;
const MAX_IMPORT_ENTRIES = 5000;

const IMAGE_NAME = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
// A 心语 backup stores originals as `images/<sha256>` with no extension, so an
// extension check alone would silently drop every image of a real backup.

export function isSupportedImageName(name: string) {
  return IMAGE_NAME.test(name);
}

export function isImportableImageEntry(name: string) {
  return isSupportedImageName(name) || isBackupImagePath(name);
}

export function isManifestEntry(name: string) {
  return baseName(name).toLowerCase() === 'manifest.json';
}

export function baseName(path: string) {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/**
 * What a "from folder / ZIP" selection actually contains.
 *
 * - `images`   : no compatible 心语 manifest. This degrades to a plain batch
 *                image import (merge).
 * - `manifest` : a compatible manifest was found, so each image keeps the name,
 *                tags, group and other migratable metadata. When the source was
 *                a validated 心语 ZIP, `backup` is attached so the caller can
 *                offer the separate restore (full/incremental) flow.
 *
 * Batch import never deletes local records; restore carries tombstone and
 * deletion semantics. They share the manifest parser only.
 */
export type ImportAnalysis =
  | { kind: 'empty' }
  | { kind: 'images'; items: PrefilledImage[] }
  | { kind: 'manifest'; manifest: BackupManifest; items: PrefilledImage[]; matched: number; backup?: Backup };

export type ImportEntry = { name: string; blob: Blob };

async function buildItems(entries: ImportEntry[], manifest?: BackupManifest) {
  const byId = manifest ? new Map(manifest.memes.map((meme) => [meme.id, meme])) : undefined;
  const items: PrefilledImage[] = [];
  let matched = 0;
  for (const entry of entries) {
    const id = await sha256(entry.blob);
    const meta = byId?.get(id);
    if (meta) matched++;
    items.push({
      blob: entry.blob,
      // A manifest title wins over the file name so imports keep the original
      // 名称 instead of something like "IMG_20240101_120000.png".
      title: meta?.title || entry.name,
      tags: meta ? [...meta.tags] : [],
      note: meta?.note ?? '',
      collectionId: meta?.collectionId ?? '',
      favorite: meta?.favorite ?? false,
      source: meta?.source || '本地导入',
      createdAt: meta?.createdAt,
      lastUsedAt: meta?.lastUsedAt,
      useCount: meta?.useCount,
    });
  }
  return { items, matched };
}

async function readManifestEntry(files: Record<string, Uint8Array>): Promise<BackupManifest | undefined> {
  const names = Object.keys(files);
  const layout = normalizeBackupLayout(names);
  const manifestNames = names.filter(isManifestEntry);
  if (!layout.manifestKey) {
    if (manifestNames.length) throw new Error(describeBackupLayoutProblem(layout) || '备份路径不正确，未修改本地表情库');
    return undefined;
  }
  try {
    const manifest = parseBackupManifest(JSON.parse(strFromU8(files[layout.manifestKey])));
    if (!manifest) throw new Error('manifest 格式不正确，未修改本地表情库');
    return manifest;
  } catch (error) {
    if (error instanceof Error && error.message.includes('manifest 格式')) throw error;
    throw new Error('manifest 格式不正确，未修改本地表情库');
  }
}

function isBackupLike(names: string[], layout: ReturnType<typeof normalizeBackupLayout>) {
  // A root-level manifest is the native export shape even when an incremental
  // backup has no images. A wrapper is backup-like once it contains an images
  // directory/hash payload; ordinary manifest-aware photo folders remain
  // importable for backwards compatibility.
  return layout.manifestKey === 'manifest.json'
    || layout.images.size > 0
    || names.some((name) => /(?:^|\/)images(?:\/|$)/.test(name));
}

function validateFolderManifestLayout(names: string[], layout: ReturnType<typeof normalizeBackupLayout>) {
  const manifestNames = names.filter(isManifestEntry);
  if (!manifestNames.length) return;
  if (layout.illegal.length || manifestNames.length !== 1 || isBackupLike(names, layout)) {
    const problem = describeBackupLayoutProblem(layout);
    if (problem) throw new Error(problem);
  }
}

/** A folder (or a multi-file selection) that may or may not carry a manifest. */
export async function analyzeImportEntries(entries: ImportEntry[]): Promise<ImportAnalysis> {
  const names = entries.map((entry) => entry.name);
  const layout = normalizeBackupLayout(names);
  validateFolderManifestLayout(names, layout);
  const backupImageNames = new Set(layout.images.values());
  const images = entries.filter((entry) => isSupportedImageName(entry.name) || backupImageNames.has(entry.name));
  const manifestEntry = layout.manifestKey
    ? entries.find((entry) => entry.name === layout.manifestKey)
    : entries.find((entry) => isManifestEntry(entry.name));
  if (!images.length) return { kind: 'empty' };
  if (!manifestEntry) {
    const { items } = await buildItems(images);
    return { kind: 'images', items };
  }
  const manifest = await parseManifestBlob(manifestEntry.blob);
  if (!manifest) throw new Error('manifest 格式不正确，未修改本地表情库');
  const { items, matched } = await buildItems(images, manifest);
  return manifest ? { kind: 'manifest', manifest, items, matched } : { kind: 'images', items };
}

async function parseManifestBlob(blob: Blob): Promise<BackupManifest | undefined> {
  try {
    return parseBackupManifest(JSON.parse(await blob.text()));
  } catch {
    return undefined;
  }
}

/** A ZIP that is either a 心语 backup or a plain folder of images. */
export async function analyzeImportZip(file: Blob): Promise<ImportAnalysis> {
  if (file.size > MAX_IMPORT_ARCHIVE + 8 * 1024 * 1024) throw new Error('导入包最多支持 256 MB');
  let files: Record<string, Uint8Array>;
  let seen = 0;
  let expanded = 0;
  try {
    files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (entry) => {
        seen++;
        expanded += entry.originalSize;
        if (entry.originalSize > 32 * 1024 * 1024 || expanded > MAX_IMPORT_EXPANDED || seen > MAX_IMPORT_ENTRIES) throw new Error('压缩包内容超出限制');
        return isImportableImageEntry(entry.name) || isManifestEntry(entry.name);
      },
    });
  } catch (error) {
    throw new Error(`无法读取导入包：${error instanceof Error ? error.message : 'ZIP 损坏'}`);
  }
  const manifest = await readManifestEntry(files);
  if (manifest) {
    // A validated 心语 ZIP can also be restored; readBackup enforces the full
    // path/size/hash/dimension contract before the restore flow may use it.
    const backup = await readBackup(file);
    const entries = Object.entries(files)
      .filter(([name]) => isImportableImageEntry(name))
      .map(([name, data]) => ({ name: baseName(name), blob: new Blob([data as Uint8Array<ArrayBuffer>], { type: '' }) }));
    const { items, matched } = await buildItems(entries, manifest);
    return { kind: 'manifest', manifest, items, matched, backup };
  }
  const entries = Object.entries(files)
    .filter(([name]) => isImportableImageEntry(name))
    .map(([name, data]) => ({ name: baseName(name), blob: new Blob([data as Uint8Array<ArrayBuffer>], { type: '' }) }));
  if (!entries.length) return { kind: 'empty' };
  const { items } = await buildItems(entries);
  return { kind: 'images', items };
}

/** Collection ids a manifest needs so imported images keep their 分组. */
export function requiredCollections(manifest: BackupManifest, items: PrefilledImage[]) {
  const used = new Set(items.map((item) => item.collectionId).filter(Boolean));
  return manifest.collections.filter((collection) => used.has(collection.id));
}
