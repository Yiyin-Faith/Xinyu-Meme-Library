import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Meme } from '../src/types';
import { createBackupExportPlan, type ReadyBackupExportPlan } from '../src/lib/backup';
import { db, sha256 } from '../src/lib/library';

const native = vi.hoisted(() => ({
  chooseDirectory: vi.fn(), openFile: vi.fn(), writeChunk: vi.fn(), closeFile: vi.fn(),
  compress: vi.fn(), addListener: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({ registerPlugin: () => native }));

const { exportAndroidBackup } = await import('../src/lib/android-backup');

let paths: string[] = [];

async function testMeme(title: string, createdAt = 1): Promise<Meme> {
  const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), title], { type: 'image/png' });
  return {
    id: await sha256(blob), title, tags: [], note: '', collectionId: '', favorite: false,
    createdAt, updatedAt: createdAt, lastUsedAt: 0, useCount: 0, mime: 'image/png', size: blob.size,
    width: 1, height: 1, source: '测试', blob,
  };
}

async function plan(mode: 'full' | 'incremental') {
  const result = await createBackupExportPlan(mode);
  if (result.status !== 'ready') throw new Error(`Expected ready ${mode} export plan`);
  return result as ReadyBackupExportPlan;
}

beforeEach(async () => {
  paths = [];
  await Promise.all([db.memes.clear(), db.collections.clear(), db.tombstones.clear(), db.settings.clear(), db.backupBaselines.clear()]);
  native.chooseDirectory.mockReset().mockResolvedValue({ cancelled: false, treeUri: 'content://tree', folderName: 'xinyu-backup-2026-09-12-120000', location: '测试目录 / xinyu-backup-2026-09-12-120000' });
  native.openFile.mockReset().mockImplementation(async ({ path }: { path: string }) => { paths.push(path); return { writerId: `${paths.length}` }; });
  native.writeChunk.mockReset().mockResolvedValue(undefined);
  native.closeFile.mockReset().mockResolvedValue(undefined);
  native.compress.mockReset().mockResolvedValue({ zipUri: 'content://zip', zipName: 'xinyu-backup-2026-09-12-120000.puff.zip', location: '测试目录 / backup.zip' });
  native.addListener.mockReset().mockResolvedValue({ remove: async () => undefined });
});

afterEach(async () => { await Promise.all([db.memes.clear(), db.collections.clear(), db.tombstones.clear(), db.settings.clear(), db.backupBaselines.clear()]); });

describe('Android backup export', () => {
  it('keeps the existing raw backup path when ZIP is unchecked and records the baseline after manifest write', async () => {
    await db.memes.add(await testMeme('完整备份'));
    const full = await plan('full');
    const result = await exportAndroidBackup(full, () => undefined, false);

    expect(result).toMatchObject({ kind: 'raw' });
    expect(paths).toContain('manifest.json');
    expect(paths.some((path) => path.startsWith('images/'))).toBe(true);
    expect(native.compress).not.toHaveBeenCalled();
    expect(await db.backupBaselines.get('latest')).toBeDefined();
  });

  it('returns complete with both raw and ZIP locations after normal compression', async () => {
    await db.memes.add(await testMeme('原始目录由 provider 写入扩展名'));
    const result = await exportAndroidBackup(await plan('full'), () => undefined, true);

    expect(result).toMatchObject({
      kind: 'complete',
      rawLocation: '测试目录 / xinyu-backup-2026-09-12-120000',
      zipLocation: '测试目录 / backup.zip',
      zipName: 'xinyu-backup-2026-09-12-120000.puff.zip',
    });
    expect(await db.backupBaselines.get('latest')).toBeDefined();
  });

  it('keeps the baseline when optional native ZIP compression fails', async () => {
    await db.memes.add(await testMeme('压缩失败仍有效'));
    native.compress.mockRejectedValueOnce(new Error('模拟 ZIP 压缩失败'));
    const result = await exportAndroidBackup(await plan('full'), () => undefined, true);

    expect(result).toMatchObject({ kind: 'raw-only', compressionError: '模拟 ZIP 压缩失败' });
    expect(paths).toContain('manifest.json');
    expect(await db.backupBaselines.get('latest')).toBeDefined();
  });

  it('writes no image path for a metadata-only incremental backup', async () => {
    const item = await testMeme('旧标签');
    await db.memes.add(item);
    await exportAndroidBackup(await plan('full'), () => undefined, false);
    await db.memes.update(item.id, { tags: ['新标签'], updatedAt: 2 });
    paths = [];

    const incremental = await plan('incremental');
    expect(incremental.snapshot.manifest.memes).toEqual([expect.objectContaining({ id: item.id, imageIncluded: false })]);
    const result = await exportAndroidBackup(incremental, () => undefined, true);

    expect(result).toMatchObject({ kind: 'complete' });
    expect(paths).toEqual(['manifest.json']);
  });
});
