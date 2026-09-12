import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { analyzeImportEntries, analyzeImportZip, baseName, isSupportedImageName, requiredCollections } from '../src/lib/import-source';
import { sha256 } from '../src/lib/library';

// Node has no Image/canvas; readBackup() only needs naturalWidth/Height.
beforeAll(() => {
  class FakeImage {
    naturalWidth = 1;
    naturalHeight = 1;
    onload: (() => void) | null = null;
    set src(_value: string) { setTimeout(() => this.onload?.(), 0); }
    async decode() { return undefined; }
  }
  (globalThis as unknown as { Image: unknown }).Image = FakeImage;
});

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const pngBlob = () => new Blob([PNG_BYTES], { type: 'image/png' });

async function manifestFor(id: string, size: number) {
  return {
    format: 'puff-library', version: 1, exportedAt: 1,
    memes: [{
      id, title: '来自清单的名称', tags: ['分类A', '分类B'], note: '清单里的备注', collectionId: 'grp1', favorite: true,
      createdAt: 5, updatedAt: 5, lastUsedAt: 7, useCount: 3, mime: 'image/png', size, width: 1, height: 1, source: '清单来源',
    }],
    collections: [{ id: 'grp1', name: '游戏', color: '#9cb99a', updatedAt: 1 }],
    tombstones: [],
  };
}

describe('folder / ZIP import analysis', () => {
  it('recognises a 心语 manifest inside a ZIP and keeps name, tags and group', async () => {
    const blob = pngBlob();
    const id = await sha256(blob);
    const manifest = await manifestFor(id, blob.size);
    const archive = new Blob([zipSync({
      'manifest.json': strToU8(JSON.stringify(manifest)),
      [`images/${id}`]: PNG_BYTES,
    })], { type: 'application/zip' });

    const analysis = await analyzeImportZip(archive);

    expect(analysis.kind).toBe('manifest');
    if (analysis.kind !== 'manifest') return;
    expect(analysis.matched).toBe(1);
    expect(analysis.items[0]).toMatchObject({ title: '来自清单的名称', tags: ['分类A', '分类B'], collectionId: 'grp1', favorite: true, note: '清单里的备注' });
    // The validated backup is offered separately so restore semantics stay distinct from batch import.
    expect(analysis.backup).toBeDefined();
    expect(requiredCollections(analysis.manifest, analysis.items).map((c) => c.id)).toEqual(['grp1']);
  });

  it('degrades to a plain batch import when the ZIP has no manifest', async () => {
    const archive = new Blob([zipSync({ 'photos/猫猫.png': PNG_BYTES, 'photos/readme.txt': strToU8('ignore me') })], { type: 'application/zip' });

    const analysis = await analyzeImportZip(archive);

    expect(analysis.kind).toBe('images');
    if (analysis.kind !== 'images') return;
    expect(analysis.items).toHaveLength(1);
    expect(analysis.items[0].title).toBe('猫猫.png');
    expect(analysis.items[0].tags).toEqual([]);
  });

  it('reads a folder selection, matching manifest entries by content hash', async () => {
    const blob = pngBlob();
    const id = await sha256(blob);
    const manifest = await manifestFor(id, blob.size);

    const analysis = await analyzeImportEntries([
      { name: 'my-folder/manifest.json', blob: new Blob([JSON.stringify(manifest)], { type: 'application/json' }) },
      { name: 'my-folder/random-name.png', blob },
      { name: 'my-folder/notes.txt', blob: new Blob(['x'], { type: 'text/plain' }) },
    ]);

    expect(analysis.kind).toBe('manifest');
    if (analysis.kind !== 'manifest') return;
    expect(analysis.matched).toBe(1);
    expect(analysis.items[0].title).toBe('来自清单的名称');
    // A folder is not a validated archive, so no restore path is offered.
    expect(analysis.backup).toBeUndefined();
  });

  it('treats a folder without a manifest as plain bulk import', async () => {
    const analysis = await analyzeImportEntries([{ name: 'a.png', blob: pngBlob() }, { name: 'b.txt', blob: new Blob(['x']) }]);
    expect(analysis.kind).toBe('images');
    if (analysis.kind !== 'images') return;
    expect(analysis.items).toHaveLength(1);
  });

  it('reports an empty selection instead of guessing', async () => {
    expect((await analyzeImportEntries([{ name: 'notes.txt', blob: new Blob(['x']) }])).kind).toBe('empty');
  });

  it('keeps backup-style image paths that carry no file extension', async () => {
    // A 心语 backup stores originals as images/<sha256>; an extension-only
    // filter would drop every one of them.
    const blob = pngBlob();
    const id = await sha256(blob);
    const archive = new Blob([zipSync({ [`images/${id}`]: PNG_BYTES })], { type: 'application/zip' });

    const analysis = await analyzeImportZip(archive);

    expect(analysis.kind).toBe('images');
    if (analysis.kind !== 'images') return;
    expect(analysis.items).toHaveLength(1);
    expect(await sha256(analysis.items[0].blob)).toBe(id);
  });

  it('recognises a renamed wrapper folder with extensionless backup originals', async () => {
    const blob = pngBlob();
    const id = await sha256(blob);
    const manifest = await manifestFor(id, blob.size);
    const analysis = await analyzeImportEntries([
      { name: `my-renamed-backup/manifest.json`, blob: new Blob([JSON.stringify(manifest)]) },
      { name: `my-renamed-backup/images/${id}`, blob },
    ]);

    expect(analysis.kind).toBe('manifest');
    if (analysis.kind !== 'manifest') return;
    expect(analysis.matched).toBe(1);
    expect(await sha256(analysis.items[0].blob)).toBe(id);
  });

  it('recognises the exported xinyu-backup-xxx wrapper and extensionless hash', async () => {
    const blob = pngBlob();
    const id = await sha256(blob);
    const manifest = await manifestFor(id, blob.size);
    const analysis = await analyzeImportEntries([
      { name: 'xinyu-backup-xxx/manifest.json', blob: new Blob([JSON.stringify(manifest)]) },
      { name: `xinyu-backup-xxx/images/${id}`, blob },
    ]);

    expect(analysis.kind).toBe('manifest');
    if (analysis.kind !== 'manifest') return;
    expect(analysis.matched).toBe(1);
  });

  it('rejects illegal, unknown and duplicate manifest entries for backup-like folders', async () => {
    const blob = pngBlob();
    const id = await sha256(blob);
    const manifest = new Blob([JSON.stringify(await manifestFor(id, blob.size))]);
    const image = { name: `images/${id}`, blob };
    await expect(analyzeImportEntries([
      { name: 'manifest.json', blob: manifest }, image, { name: '../evil.png', blob },
    ])).rejects.toThrow('非法路径');
    await expect(analyzeImportEntries([
      { name: 'manifest.json', blob: manifest }, image, { name: 'images/not-a-hash.txt', blob },
    ])).rejects.toThrow('未知文件');
    await expect(analyzeImportEntries([
      { name: 'manifest.json', blob: manifest }, { name: 'copy/manifest.json', blob: manifest }, image,
    ])).rejects.toThrow();
  });

  it('does not downgrade malformed ZIP manifests or invalid manifest roots to plain images', async () => {
    const malformed = new Blob([zipSync({
      'manifest.json': strToU8('{broken'),
      [`images/${'d'.repeat(64)}`]: PNG_BYTES,
    })], { type: 'application/zip' });
    await expect(analyzeImportZip(malformed)).rejects.toThrow('manifest 格式不正确');

    const invalidRoot = new Blob([zipSync({
      'one/manifest.json': strToU8('{broken'),
      'two/manifest.json': strToU8('{broken'),
      [`one/images/${'e'.repeat(64)}`]: PNG_BYTES,
    })], { type: 'application/zip' });
    await expect(analyzeImportZip(invalidRoot)).rejects.toThrow();
  });

  it('helpers recognise image names and basenames', () => {
    expect(isSupportedImageName('a.PNG')).toBe(true);
    expect(isSupportedImageName('a.jpeg')).toBe(true);
    expect(isSupportedImageName('a.txt')).toBe(false);
    expect(baseName('x/y\\z.png')).toBe('z.png');
  });
});
