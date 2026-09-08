import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { exportLibrary, type ExportProgress } from '../src/lib/backup';
import { defaultSettings, LibraryDB } from '../src/lib/library';
import type { Meme } from '../src/types';

const databases: LibraryDB[] = [];
afterEach(async () => { for (const database of databases.splice(0)) await database.delete(); });

describe('library export', () => {
  it('reports collection progress before producing a complete archive', async () => {
    const database = new LibraryDB(`puff-export-${crypto.randomUUID()}`);
    databases.push(database);
    const blob = new Blob(['tiny image'], { type: 'image/png' });
    const meme: Meme = {
      id: 'a'.repeat(64), title: '测试表情', tags: ['测试'], note: '', collectionId: '', favorite: false,
      createdAt: 1, updatedAt: 1, lastUsedAt: 0, useCount: 0, mime: 'image/png', size: blob.size,
      width: 1, height: 1, source: '测试', blob,
    };
    await database.memes.add(meme);
    await database.settings.put(defaultSettings);
    const progress: ExportProgress[] = [];

    const archive = await exportLibrary(database, (next) => progress.push(next));

    expect(progress[0]).toEqual({ phase: 'collecting', completed: 0, total: 1, bytesCompleted: 0, totalBytes: blob.size });
    expect(progress).toContainEqual({ phase: 'collecting', completed: 1, total: 1, bytesCompleted: blob.size, totalBytes: blob.size });
    expect(progress[progress.length - 1]).toEqual({ phase: 'packing', completed: 1, total: 1, bytesCompleted: blob.size, totalBytes: blob.size });

    const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    const manifest = JSON.parse(strFromU8(files['manifest.json']));
    expect(manifest.memes).toEqual([expect.objectContaining({ id: meme.id, title: meme.title })]);
    expect(files[`images/${meme.id}`]).toBeDefined();
  });
});
