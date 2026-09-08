import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { LibraryDB } from '../src/lib/library';
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
    expect(upgraded.verno).toBe(2);
  });
});
