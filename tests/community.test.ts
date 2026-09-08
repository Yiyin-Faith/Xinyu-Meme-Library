import { describe, expect, it } from 'vitest';
import { LocalMockCommunityDataSource } from '../src/lib/community';

class MemoryStore {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe('local mock community data source', () => {
  it('keeps likes and simulated upload quota in the local data layer', async () => {
    const source = new LocalMockCommunityDataSource({ storage: new MemoryStore(), now: () => Date.UTC(2026, 8, 8, 10) });
    const initial = await source.listPosts();
    expect(initial).toHaveLength(3);
    expect(initial.map((post) => post.title)).toContain('今天也要探头一下');
    const first = initial[0];
    const toggled = await source.toggleLike(first.id);
    expect(toggled.liked).toBe(!first.liked);
    expect(toggled.likes).toBe(first.likes + (first.liked ? -1 : 1));

    expect((await source.getQuota()).remaining).toBe(3);
    await source.publishMeme({ blob: new Blob(['mock'], { type: 'image/png' }), title: '本地发布', tags: ['测试'], note: '' });
    expect((await source.getQuota()).remaining).toBe(2);
    expect((await source.listPosts())[0]).toMatchObject({ title: '本地发布', isLocalMock: true });
  });
});
