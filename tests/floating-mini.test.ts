import { describe, expect, it } from 'vitest';
import { createFloatingMiniBridge, floatingMiniCatalog, floatingMiniTags, selectFloatingMiniMemes } from '../src/lib/floating-mini';
import type { Meme } from '../src/types';

function meme(id: string, tags: string[], overrides: Partial<Meme> = {}): Meme {
  return {
    id,
    title: id,
    tags,
    note: '',
    collectionId: '',
    favorite: false,
    createdAt: 1,
    updatedAt: 1,
    lastUsedAt: 0,
    useCount: 0,
    mime: 'image/png',
    size: 1,
    width: 1,
    height: 1,
    source: 'test',
    blob: new Blob(['x'], { type: 'image/png' }),
    ...overrides,
  };
}

describe('floating mini library selection', () => {
  const memes = [
    meme('new', ['开心']),
    meme('used', ['无语'], { lastUsedAt: 30, useCount: 3 }),
    meme('also-used', ['无语', '猫猫'], { lastUsedAt: 20, useCount: 1 }),
  ];

  it('uses existing tags without a separate keyword dataset', () => {
    expect(floatingMiniTags(memes)).toEqual([
      { name: '无语', count: 2 },
      { name: '猫猫', count: 1 },
      { name: '开心', count: 1 },
    ]);
  });

  it('filters a single existing tag and preserves recent ordering', () => {
    expect(selectFloatingMiniMemes(memes, { filter: 'tag', tag: '无语' }).map((item) => item.id)).toEqual(['used', 'also-used']);
  });

  it('uses the frequent view when a caller omits a filter', () => {
    expect(selectFloatingMiniMemes(memes, {}).map((item) => item.id)).toEqual(['used', 'also-used', 'new']);
  });

  it('shows multiple accessibility matches as a deterministic local union', () => {
    expect(selectFloatingMiniMemes(memes, { filter: 'recommended', recommendedTags: ['猫猫', '开心'] }).map((item) => item.id)).toEqual(['also-used', 'new']);
  });

  it('creates a metadata-only recovery catalog without copying original Blobs', () => {
    const [entry] = floatingMiniCatalog([meme('cached', ['猫猫'], { note: '聊天时用', useCount: 8, updatedAt: 9 })]);
    expect(entry).toMatchObject({ id: 'cached', title: 'cached', tags: ['猫猫'], note: '聊天时用', useCount: 8, updatedAt: 9 });
    expect(entry).not.toHaveProperty('blob');
  });

  it('reports the finished IndexedDB page through the native callback channel', async () => {
    let resolveReport!: () => void;
    const report = new Promise<void>((resolve) => { resolveReport = resolve; });
    const reports: Array<{ requestId: string; snapshot: { ready: boolean; total?: number; libraryTotal?: number } }> = [];
    const bridge = createFloatingMiniBridge(memes, async (requestId, snapshot) => {
      reports.push({ requestId, snapshot });
      resolveReport();
    });

    bridge.requestNativeSnapshot('page-1', { filter: 'frequent', limit: 1 });
    await report;

    expect(reports).toEqual([{ requestId: 'page-1', snapshot: expect.objectContaining({ ready: true, total: 3, libraryTotal: 3 }) }]);
  });
});
