import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultSettings, LibraryDB, normalizeTags } from '../src/lib/library';
const databases: LibraryDB[] = [];
afterEach(async () => { for (const db of databases.splice(0)) await db.delete(); });

describe('database migration', () => {
  it('preserves v1 records and makes collection ordering valid', async () => {
    const name = `puff-migration-${crypto.randomUUID()}`;
    const old = new Dexie(name);
    old.version(1).stores({ memes: 'id, title, collectionId, *tags, createdAt, lastUsedAt', collections: 'id', tombstones: 'id', settings: 'id' });
    await old.table('collections').bulkPut([{ id: 'personal', name: '旧收藏夹', color: '#aabbcc', updatedAt: 20 }, { id: 'earlier', name: '更早', color: '#aabbcc', updatedAt: 1 }]);
    await old.table('memes').put({ id: 'old-image', title: '我的旧表情', tags: ['保存'], collectionId: 'personal', createdAt: 1, lastUsedAt: 0 });
    old.close();
    const upgraded = new LibraryDB(name); databases.push(upgraded);
    expect((await upgraded.collections.orderBy('updatedAt').toArray()).map((c) => c.id)).toEqual(['earlier', 'personal']);
    expect((await upgraded.memes.get('old-image'))?.title).toBe('我的旧表情');
    expect(upgraded.verno).toBe(3);
  });

  it('removes legacy built-in demos without touching personal images', async () => {
    const name = `puff-demo-cleanup-${crypto.randomUUID()}`;
    const old = new Dexie(name);
    old.version(1).stores({ memes: 'id, title, collectionId, *tags, createdAt, lastUsedAt', collections: 'id', tombstones: 'id', settings: 'id' });
    old.version(2).stores({ collections: 'id, updatedAt' });
    await old.table('collections').bulkPut([{ id: 'daily', name: '日常营业', color: '#96af91', updatedAt: 1 }, { id: 'cute', name: '可爱即正义', color: '#dda898', updatedAt: 1 }]);
    await old.table('memes').bulkPut([
      { id: 'demo', title: '内置示例', tags: [], collectionId: 'cute', createdAt: 1, lastUsedAt: 0, source: '心语表情库原创示例' },
      { id: 'personal', title: '我的图', tags: [], collectionId: 'daily', createdAt: 2, lastUsedAt: 0, source: '本地导入' },
    ]);
    old.close();
    const upgraded = new LibraryDB(name); databases.push(upgraded);
    expect(await upgraded.memes.get('demo')).toBeUndefined();
    expect((await upgraded.memes.get('personal'))?.title).toBe('我的图');
    expect(await upgraded.collections.get('daily')).toBeDefined();
    expect(await upgraded.collections.get('cute')).toBeUndefined();
  });

  it('uses a dense grid for a fresh library', () => {
    expect(defaultSettings.dense).toBe(true);
  });

  it('normalizes and de-duplicates import tags', () => {
    expect(normalizeTags([' #开心 ', '开心', ' 反应 ', '', '##朋友'])).toEqual(['开心', '反应', '朋友']);
  });
});
