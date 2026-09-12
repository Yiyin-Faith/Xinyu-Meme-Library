import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { commitBackupExportPlan, createBackupExportPlan, exportBackupPlan, exportLibrary, mergeBackup, readBackup, type ExportProgress, type ReadyBackupExportPlan } from '../src/lib/backup';
import { defaultSettings, LibraryDB, sha256 } from '../src/lib/library';
import type { Meme } from '../src/types';

const databases: LibraryDB[] = [];
afterEach(async () => { for (const database of databases.splice(0)) await database.delete(); });

function database(label: string) {
  const next = new LibraryDB(`puff-export-${label}-${crypto.randomUUID()}`);
  databases.push(next);
  return next;
}

async function meme(title: string, createdAt = 1): Promise<Meme> {
  // Starts with a PNG signature so backup validation can exercise MIME/hash
  // checks without needing a canvas implementation in this unit-test runtime.
  const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), title], { type: 'image/png' });
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

async function restoreArchive(archive: Blob, target: LibraryDB) {
  await mergeBackup(await readBackup(archive, false), true, true, target);
}

describe('library export', () => {
  it('reports collection progress before producing a complete archive', async () => {
    const source = database('progress');
    const item = await meme('测试表情');
    await source.memes.add(item);
    await source.settings.put(defaultSettings);
    const progress: ExportProgress[] = [];

    const archive = await exportLibrary(source, (next) => progress.push(next));

    expect(progress[0]).toEqual({ phase: 'collecting', completed: 0, total: 1, bytesCompleted: 0, totalBytes: item.blob.size });
    expect(progress).toContainEqual({ phase: 'collecting', completed: 1, total: 1, bytesCompleted: item.blob.size, totalBytes: item.blob.size });
    expect(progress[progress.length - 1]).toEqual({ phase: 'packing', completed: 1, total: 1, bytesCompleted: item.blob.size, totalBytes: item.blob.size });

    const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    const manifest = JSON.parse(strFromU8(files['manifest.json']));
    expect(manifest.memes).toEqual([expect.objectContaining({ id: item.id, title: item.title })]);
    expect(files[`images/${item.id}`]).toBeDefined();
  });

  it('continues to read a legacy v1 full manifest without the new optional fields', async () => {
    const source = database('legacy');
    const target = database('legacy-target');
    const item = await meme('旧版完整备份');
    await source.memes.add(item);
    const archive = await exportLibrary(source);
    const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    const manifest = JSON.parse(strFromU8(files['manifest.json']));
    delete manifest.backupType;
    delete manifest.baseExportedAt;
    const legacyArchive = new Blob([zipSync({ ...files, 'manifest.json': strToU8(JSON.stringify(manifest)) })], { type: 'application/zip' });

    await restoreArchive(legacyArchive, target);
    expect(await target.memes.get(item.id)).toMatchObject({ title: '旧版完整备份' });
  });

  it('requires a complete backup before incremental export is available', async () => {
    const source = database('no-base');
    await source.memes.add(await meme('第一张'));
    expect(await createBackupExportPlan('incremental', source)).toEqual({ status: 'missing-baseline', mode: 'incremental' });
  });

  it('exports a new image as an incremental archive and restores it after the full backup', async () => {
    const source = database('new-source');
    const target = database('new-target');
    const first = await meme('第一张');
    await source.memes.add(first);
    const full = await readyPlan('full', source);
    const fullArchive = await exportBackupPlan(full, source);
    await commitBackupExportPlan(full, source);
    await restoreArchive(fullArchive, target);

    const added = await meme('新增图片', 2);
    await source.memes.add(added);
    const incremental = await readyPlan('incremental', source);
    expect(incremental.snapshot.manifest.backupType).toBe('incremental');
    expect(incremental.snapshot.manifest.memes).toEqual([expect.objectContaining({ id: added.id, imageIncluded: true })]);
    const incrementalArchive = await exportBackupPlan(incremental, source);
    await restoreArchive(incrementalArchive, target);

    expect((await target.memes.toArray()).map((item) => item.title).sort()).toEqual(['新增图片', '第一张']);
  });

  it('exports tag/name changes without duplicating the unchanged original image', async () => {
    const source = database('metadata-source');
    const target = database('metadata-target');
    const first = await meme('旧名称');
    await source.memes.add(first);
    const full = await readyPlan('full', source);
    await restoreArchive(await exportBackupPlan(full, source), target);
    await commitBackupExportPlan(full, source);

    await source.memes.update(first.id, { title: '新名称', tags: ['更新'], updatedAt: 9 });
    const incremental = await readyPlan('incremental', source);
    expect(incremental.snapshot.manifest.memes).toEqual([expect.objectContaining({ id: first.id, title: '新名称', imageIncluded: false })]);
    expect(incremental.snapshot.totalBytes).toBe(0);
    const archive = await exportBackupPlan(incremental, source);
    const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    expect(Object.keys(files)).toEqual(['manifest.json']);
    await restoreArchive(archive, target);

    expect(await target.memes.get(first.id)).toMatchObject({ title: '新名称', tags: ['更新'] });
  });

  it('records deletions in an incremental backup and applies them during restore', async () => {
    const source = database('delete-source');
    const target = database('delete-target');
    const first = await meme('将被删除');
    await source.memes.add(first);
    const full = await readyPlan('full', source);
    await restoreArchive(await exportBackupPlan(full, source), target);
    await commitBackupExportPlan(full, source);

    await source.transaction('rw', source.memes, source.tombstones, async () => {
      await source.tombstones.put({ id: first.id, deletedAt: 10 });
      await source.memes.delete(first.id);
    });
    const incremental = await readyPlan('incremental', source);
    expect(incremental.snapshot.manifest.tombstones).toEqual([{ id: first.id, deletedAt: 10 }]);
    await restoreArchive(await exportBackupPlan(incremental, source), target);

    expect(await target.memes.get(first.id)).toBeUndefined();
  });

  it('does not create an empty incremental backup when nothing changed', async () => {
    const source = database('unchanged');
    await source.memes.add(await meme('不变'));
    const full = await readyPlan('full', source);
    await commitBackupExportPlan(full, source);
    expect(await createBackupExportPlan('incremental', source)).toEqual({ status: 'no-changes', mode: 'incremental' });
  });

  it('keeps a valid next baseline once raw manifest content is written, even if a later ZIP step fails', async () => {
    const source = database('zip-failure-base');
    const first = await meme('原始备份');
    await source.memes.add(first);
    const full = await readyPlan('full', source);
    // Android commits at this exact point: all raw images and manifest.json
    // are present; native ZIP compression is deliberately after it.
    await commitBackupExportPlan(full, source);
    await source.memes.update(first.id, { note: 'ZIP 后仍可做增量', updatedAt: 11 });
    const incremental = await readyPlan('incremental', source);
    expect(incremental.snapshot.manifest.memes).toEqual([expect.objectContaining({ imageIncluded: false, note: 'ZIP 后仍可做增量' })]);
  });

  it('reconstructs the final library from one full backup followed by chained incrementals', async () => {
    const source = database('chain-source');
    const target = database('chain-target');
    const first = await meme('初始', 1);
    await source.memes.add(first);
    const full = await readyPlan('full', source);
    const fullArchive = await exportBackupPlan(full, source);
    await commitBackupExportPlan(full, source);

    const second = await meme('后来新增', 2);
    await source.memes.add(second);
    const addPlan = await readyPlan('incremental', source);
    const addArchive = await exportBackupPlan(addPlan, source);
    await commitBackupExportPlan(addPlan, source);

    await source.memes.update(first.id, { title: '初始（已改名）', tags: ['最终'], updatedAt: 20 });
    const metadataPlan = await readyPlan('incremental', source);
    const metadataArchive = await exportBackupPlan(metadataPlan, source);
    await commitBackupExportPlan(metadataPlan, source);

    await source.transaction('rw', source.memes, source.tombstones, async () => {
      await source.tombstones.put({ id: second.id, deletedAt: 30 });
      await source.memes.delete(second.id);
    });
    const deletePlan = await readyPlan('incremental', source);
    const deleteArchive = await exportBackupPlan(deletePlan, source);

    await restoreArchive(fullArchive, target);
    await restoreArchive(addArchive, target);
    await restoreArchive(metadataArchive, target);
    await restoreArchive(deleteArchive, target);
    expect(await target.memes.get(second.id)).toBeUndefined();
    expect(await target.memes.get(first.id)).toMatchObject({ title: '初始（已改名）', tags: ['最终'] });
  });

  it('refuses a metadata-only incremental backup without its base image', async () => {
    const source = database('missing-base-source');
    const target = database('missing-base-target');
    const first = await meme('需要完整备份');
    await source.memes.add(first);
    const full = await readyPlan('full', source);
    await commitBackupExportPlan(full, source);
    await source.memes.update(first.id, { title: '只有元数据', updatedAt: 4 });
    const incremental = await readyPlan('incremental', source);
    const backup = await readBackup(await exportBackupPlan(incremental, source), false);
    await expect(mergeBackup(backup, true, true, target)).rejects.toThrow('请先恢复它所依赖的完整备份');
    expect(await target.memes.count()).toBe(0);
  });
});
