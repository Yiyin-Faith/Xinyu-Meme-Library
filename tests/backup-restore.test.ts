import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { assembleBackup, commitBackupExportPlan, createBackupExportPlan, exportBackupPlan, mergeBackup, normalizeBackupLayout, readBackup, type ReadyBackupExportPlan } from '../src/lib/backup';
import { LibraryDB, sha256 } from '../src/lib/library';
import type { Meme } from '../src/types';

const native = vi.hoisted(() => ({
  chooseBackupFolder: vi.fn(), openFileForRead: vi.fn(), readChunk: vi.fn(), closeReader: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({ registerPlugin: () => native, Capacitor: { getPlatform: () => 'android' } }));

const { pickAndroidBackupFolder, readAndroidBackupFolder } = await import('../src/lib/android-restore');

const databases: LibraryDB[] = [];
afterEach(async () => { for (const database of databases.splice(0)) await database.delete(); });

function database(label: string) {
  const next = new LibraryDB(`puff-restore-${label}-${crypto.randomUUID()}`);
  databases.push(next);
  return next;
}

/** Starts with a PNG signature so MIME/hash/dimension checks can run headless. */
async function meme(title: string, createdAt = 1): Promise<Meme> {
  const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), title, 0x01, 0x02, 0x03], { type: 'image/png' });
  return {
    id: await sha256(blob), title, tags: ['测试'], note: '', collectionId: '', favorite: false,
    createdAt, updatedAt: createdAt, lastUsedAt: 0, useCount: 0, mime: 'image/png', size: blob.size,
    width: 1, height: 1, source: '测试', blob,
  };
}

async function readyPlan(mode: 'full' | 'incremental', source: LibraryDB) {
  const plan = await createBackupExportPlan(mode, source);
  if (plan.status !== 'ready') throw new Error(`Expected ready ${mode} plan, received ${plan.status}`);
  return plan as ReadyBackupExportPlan;
}

/** The flat `manifest.json` + `images/<sha256>` payload a backup is made of. */
async function payload(source: LibraryDB, mode: 'full' | 'incremental' = 'full') {
  const plan = await readyPlan(mode, source);
  const archive = await exportBackupPlan(plan, source);
  const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
  return { plan, files };
}

function zipBlob(files: Record<string, Uint8Array>) {
  return new Blob([zipSync(files)], { type: 'application/zip' });
}

function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// ---- Android folder restore doubles ---------------------------------------

let folderFiles = new Map<string, Uint8Array>();
let readerCounter = 0;
const openReaders = new Map<string, { bytes: Uint8Array; offset: number }>();

beforeEach(() => {
  folderFiles = new Map();
  readerCounter = 0;
  openReaders.clear();
  native.chooseBackupFolder.mockReset().mockImplementation(async () => ({
    cancelled: false,
    treeUri: 'content://tree',
    location: '测试目录',
    entries: [...folderFiles].map(([path, bytes]) => ({ path, size: bytes.length })),
  }));
  native.openFileForRead.mockReset().mockImplementation(async ({ path }: { path: string }) => {
    const bytes = folderFiles.get(path);
    if (!bytes) throw new Error(`备份文件已不存在：${path}`);
    const readerId = String(++readerCounter);
    openReaders.set(readerId, { bytes, offset: 0 });
    return { readerId, size: bytes.length };
  });
  native.readChunk.mockReset().mockImplementation(async ({ readerId, length }: { readerId: string; length: number }) => {
    const reader = openReaders.get(readerId);
    if (!reader) throw new Error('备份读取会话已失效');
    const slice = reader.bytes.subarray(reader.offset, Math.min(reader.offset + length, reader.bytes.length));
    reader.offset += slice.length;
    return { data: toBase64(slice), done: reader.offset >= reader.bytes.length };
  });
  native.closeReader.mockReset().mockImplementation(async () => undefined);
});

function useFolder(files: Record<string, Uint8Array>) {
  folderFiles = new Map(Object.entries(files));
}

async function restoreFolder(target: LibraryDB, checkDimensions = false) {
  const folder = await pickAndroidBackupFolder();
  if (!folder) throw new Error('Expected a picked folder');
  const progress: [number, number][] = [];
  const backup = await readAndroidBackupFolder(folder, (completed, total) => progress.push([completed, total]), checkDimensions);
  return { result: await mergeBackup(backup, true, true, target), progress };
}

describe('backup restore compatibility', () => {
  it('1 · restores the ZIP the app itself exports', async () => {
    const source = database('self-zip');
    const target = database('self-zip-target');
    const item = await meme('自生成备份');
    await source.memes.add(item);
    const { plan } = await payload(source);
    const archive = await exportBackupPlan(plan, source);

    await mergeBackup(await readBackup(archive, false), true, true, target);
    expect(await target.memes.get(item.id)).toMatchObject({ title: '自生成备份' });
  });

  it('2 · restores a hand-compressed folder that kept an images/ directory entry', async () => {
    const source = database('manual-folder');
    const target = database('manual-folder-target');
    const item = await meme('手动压缩');
    await source.memes.add(item);
    const { files } = await payload(source);
    // A desktop archive tool emits the folder itself as a zero-byte entry.
    const archive = zipBlob({ 'images/': new Uint8Array(0), ...files });

    await mergeBackup(await readBackup(archive, false), true, true, target);
    expect(await target.memes.get(item.id)).toMatchObject({ title: '手动压缩' });
  });

  it('3 · restores a ZIP wrapped in a single xinyu-backup-* folder', async () => {
    const source = database('wrapper');
    const target = database('wrapper-target');
    const item = await meme('带外层目录');
    await source.memes.add(item);
    const { files } = await payload(source);
    const root = 'xinyu-backup-2026-09-12-120000';
    const wrapped: Record<string, Uint8Array> = {};
    for (const [name, data] of Object.entries(files)) wrapped[`${root}/${name}`] = data;

    await mergeBackup(await readBackup(zipBlob(wrapped), false), true, true, target);
    expect(await target.memes.get(item.id)).toMatchObject({ title: '带外层目录' });
  });

  it('4 · restores a ZIP wrapped in one renamed folder, directory entries included', async () => {
    const source = database('renamed-root');
    const target = database('renamed-root-target');
    const item = await meme('重命名目录');
    await source.memes.add(item);
    const { files } = await payload(source);
    const root = '我的备份 2026';
    const wrapped: Record<string, Uint8Array> = { [`${root}/images/`]: new Uint8Array(0) };
    for (const [name, data] of Object.entries(files)) wrapped[`${root}/${name}`] = data;

    await mergeBackup(await readBackup(zipBlob(wrapped), false), true, true, target);
    expect(await target.memes.get(item.id)).toMatchObject({ title: '重命名目录' });
  });

  it('5 · refuses parent-directory traversal', async () => {
    const source = database('traversal');
    const item = await meme('穿越');
    await source.memes.add(item);
    const { files } = await payload(source);
    const archive = zipBlob({ ...files, '../evil.png': new Uint8Array([1, 2, 3]) });

    await expect(readBackup(archive, false)).rejects.toThrow('非法路径');
    const layout = normalizeBackupLayout(['manifest.json', '..\\evil.png']);
    expect(layout.illegal).toContain('..\\evil.png');
  });

  it('6 · refuses several unrelated roots instead of guessing one', async () => {
    const source = database('multi-root');
    const item = await meme('多根');
    await source.memes.add(item);
    const { files } = await payload(source);
    const archive = zipBlob({
      'backup-a/manifest.json': files['manifest.json'],
      'backup-b/manifest.json': files['manifest.json'],
      'backup-b/images/placeholder': new Uint8Array([1]),
    });

    await expect(readBackup(archive, false)).rejects.toThrow('多个不相关的根目录');
  });

  it('7 · restores directly from a backup folder through SAF', async () => {
    const source = database('folder-source');
    const target = database('folder-target');
    const item = await meme('文件夹恢复');
    await source.memes.add(item);
    const { files } = await payload(source);
    useFolder({ 'images/': new Uint8Array(0), ...files });

    const { result, progress } = await restoreFolder(target);
    expect(result.added).toBe(1);
    expect(await target.memes.get(item.id)).toMatchObject({ title: '文件夹恢复' });
    expect(progress.length).toBeGreaterThan(0);
  });

  it('8 · restores a complete folder and applies tombstone deletions', async () => {
    const source = database('folder-full');
    const target = database('folder-full-target');
    const first = await meme('完整目录', 1);
    const second = await meme('将被删除', 2);
    await source.memes.add(first);
    await source.memes.add(second);
    const full = await payload(source);
    await mergeBackup(await readBackup(zipBlob({ ...full.files }), false), true, true, target);
    await commitBackupExportPlan(full.plan, source);

    await source.transaction('rw', source.memes, source.tombstones, async () => {
      await source.tombstones.put({ id: second.id, deletedAt: 10 });
      await source.memes.delete(second.id);
    });
    const incremental = await payload(source, 'incremental');
    useFolder(incremental.files);

    await restoreFolder(target);
    expect(await target.memes.get(second.id)).toBeUndefined();
    expect(await target.memes.get(first.id)).toBeDefined();
  });

  it('9 · restores a metadata-only incremental folder that omits images/', async () => {
    const source = database('folder-metadata');
    const target = database('folder-metadata-target');
    const item = await meme('仅元数据');
    await source.memes.add(item);
    const full = await payload(source);
    await mergeBackup(await readBackup(zipBlob({ ...full.files }), false), true, true, target);
    await commitBackupExportPlan(full.plan, source);

    await source.memes.update(item.id, { title: '改名后', updatedAt: 9 });
    const incremental = await payload(source, 'incremental');
    expect(Object.keys(incremental.files)).toEqual(['manifest.json']);
    useFolder(incremental.files);

    await restoreFolder(target);
    expect(await target.memes.get(item.id)).toMatchObject({ title: '改名后' });
  });

  it('10 · reports a plain folder without manifest.json instead of treating it as a backup', async () => {
    const target = database('no-manifest-target');
    // Looks like a half-copied backup: real image slots, but no manifest.
    useFolder({ [`images/${'b'.repeat(64)}`]: new Uint8Array([1, 2, 3]) });

    await expect(restoreFolder(target)).rejects.toThrow('未找到 manifest.json');
    expect(await target.memes.count()).toBe(0);
  });

  it('10b · reports an ordinary photo folder as unknown files, never as a broken backup', async () => {
    const target = database('photo-folder-target');
    useFolder({ 'cat.png': new Uint8Array([1, 2, 3]), 'holiday/dog.jpg': new Uint8Array([4]) });

    await expect(restoreFolder(target)).rejects.toThrow('未知文件');
    expect(await target.memes.count()).toBe(0);
  });

  it('11 · ZIP and folder share one validation core, so the same tampering fails identically', async () => {
    const source = database('shared-core');
    const zipTarget = database('shared-core-zip');
    const folderTarget = database('shared-core-folder');
    const item = await meme('共享校验');
    await source.memes.add(item);
    const { files } = await payload(source);

    const imageKey = `images/${item.id}`;
    const tampered = new Uint8Array(files[imageKey]);
    tampered[tampered.length - 1] ^= 0xff;

    useFolder({ ...files, [imageKey]: tampered });
    await expect(restoreFolder(folderTarget)).rejects.toThrow('图片 hash 校验失败：共享校验');
    expect(await folderTarget.memes.count()).toBe(0);

    await expect(readBackup(zipBlob({ ...files, [imageKey]: tampered }), false)).rejects.toThrow('图片 hash 校验失败：共享校验');
    expect(await zipTarget.memes.count()).toBe(0);
  });
});

describe('backup layout whitelist', () => {
  it('accepts only manifest.json and images/<sha256>, reporting everything else', () => {
    const id = 'a'.repeat(64);
    const layout = normalizeBackupLayout(['manifest.json', `images/${id}`, 'notes.txt', 'images/sub/other']);
    expect(layout.manifestKey).toBe('manifest.json');
    expect([...layout.images.keys()]).toEqual([id]);
    expect(layout.unknown).toEqual(['notes.txt', 'images/sub/other']);
  });

  it('drops archive-tool junk but keeps rejecting real unknown files', () => {
    const layout = normalizeBackupLayout(['manifest.json', '__MACOSX/._manifest.json', '.DS_Store', 'images/notes.txt']);
    expect(layout.unknown).toEqual(['images/notes.txt']);
  });

  it('flags absolute paths, drive letters and backslashes as illegal', () => {
    const layout = normalizeBackupLayout(['/etc/passwd', 'C:/secret', 'a\\b', './manifest.json']);
    expect(layout.illegal).toEqual(['/etc/passwd', 'C:/secret', 'a\\b', './manifest.json']);
  });

  it('never unwraps more than one level', () => {
    const layout = normalizeBackupLayout(['outer/inner/manifest.json', 'outer/other/manifest.json']);
    expect(layout.manifestKey).toBeUndefined();
    expect(layout.unknown).toContain('outer/inner/manifest.json');
  });
});

describe('shared manifest validation', () => {
  it('reports a malformed manifest before touching the library', async () => {
    await expect(assembleBackup('{ not json', new Map(), false)).rejects.toThrow('manifest 格式不正确');
  });

  it('reports an incremental backup with no comparison base', async () => {
    const source = database('no-base-manifest');
    const item = await meme('缺少基准');
    await source.memes.add(item);
    const { files } = await payload(source);
    const manifest = JSON.parse(strFromU8(files['manifest.json']));
    manifest.backupType = 'incremental';
    delete manifest.baseExportedAt;

    await expect(assembleBackup(JSON.stringify(manifest), new Map(), false)).rejects.toThrow('增量备份缺少比较基准信息');
  });
});
