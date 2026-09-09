import type { Meme } from '../types';
import { db, markUsed, matchesSearch } from './library';

export type FloatingMiniFilter = 'recent' | 'frequent' | 'recommended' | 'tag' | 'all';
export type FloatingMiniRequest = {
  search?: string;
  filter?: FloatingMiniFilter;
  tag?: string;
  recommendedTags?: string[];
  offset?: number;
  limit?: number;
};
export type FloatingMiniSnapshot = {
  ready: true;
  total: number;
  tags: { name: string; count: number }[];
  items: { id: string; title: string; thumbnail: string }[];
};

export type FloatingMiniBridge = {
  getSnapshot: (request: FloatingMiniRequest) => Promise<FloatingMiniSnapshot>;
  share: (id: string) => Promise<boolean>;
};

const normalize = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase();

export function floatingMiniTags(memes: Meme[]) {
  const tags = new Map<string, { name: string; count: number; useCount: number; lastUsedAt: number }>();
  for (const meme of memes) {
    for (const tag of meme.tags) {
      const key = normalize(tag);
      if (!key) continue;
      const current = tags.get(key) ?? { name: tag, count: 0, useCount: 0, lastUsedAt: 0 };
      current.count++;
      current.useCount += meme.useCount;
      current.lastUsedAt = Math.max(current.lastUsedAt, meme.lastUsedAt);
      tags.set(key, current);
    }
  }
  return [...tags.values()]
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt || b.useCount - a.useCount || b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'))
    .map(({ name, count }) => ({ name, count }));
}

/** Pure selection against the existing in-memory IndexedDB records. */
export function selectFloatingMiniMemes(memes: Meme[], request: FloatingMiniRequest) {
  const search = request.search?.trim() ?? '';
  const filter = request.filter ?? 'recent';
  const selectedTag = normalize(request.tag ?? '');
  const recommended = new Set((request.recommendedTags ?? []).map(normalize).filter(Boolean));
  let selected = memes.filter((meme) => {
    if (search && !matchesSearch(meme, search)) return false;
    if (filter === 'tag') return meme.tags.some((tag) => normalize(tag) === selectedTag);
    if (filter === 'recommended') return meme.tags.some((tag) => recommended.has(normalize(tag)));
    return true;
  });

  if (filter === 'recent') {
    const used = selected.filter((meme) => meme.lastUsedAt > 0);
    // A fresh library should still be usable from the floating panel.
    selected = used.length ? used : selected;
    selected.sort((a, b) => b.lastUsedAt - a.lastUsedAt || b.createdAt - a.createdAt);
  } else if (filter === 'frequent') {
    selected.sort((a, b) => b.useCount - a.useCount || b.lastUsedAt - a.lastUsedAt || b.createdAt - a.createdAt);
  } else {
    selected.sort((a, b) => b.lastUsedAt - a.lastUsedAt || b.useCount - a.useCount || b.createdAt - a.createdAt);
  }
  return selected;
}

async function thumbnail(blob: Blob) {
  const source = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = source;
    await image.decode();
    const largest = Math.max(image.naturalWidth, image.naturalHeight);
    if (!largest) return '';
    const scale = Math.min(1, 144 / largest);
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return '';
    context.fillStyle = '#f4f9f5';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.78);
  } catch {
    return '';
  } finally {
    URL.revokeObjectURL(source);
  }
}

export function createFloatingMiniBridge(memes: Meme[]): FloatingMiniBridge {
  return {
    async getSnapshot(request) {
      const selected = selectFloatingMiniMemes(memes, request);
      const offset = Math.max(0, Math.floor(request.offset ?? 0));
      const limit = Math.max(1, Math.min(30, Math.floor(request.limit ?? 24)));
      // Deliberately generate only the requested page. The native panel asks
      // for more as the user scrolls, so a large library is never materialized
      // as a full-resolution or full-library native copy.
      const page = selected.slice(offset, offset + limit);
      const items: FloatingMiniSnapshot['items'] = [];
      for (const meme of page) items.push({ id: meme.id, title: meme.title, thumbnail: await thumbnail(meme.blob) });
      return { ready: true, total: selected.length, tags: floatingMiniTags(memes), items };
    },
    async share(id) {
      const meme = await db.memes.get(id);
      if (!meme) return false;
      // Keep the selector independently testable in the Node test runner;
      // platform access is needed only for a real user-initiated share.
      const { useImage } = await import('./platform');
      await useImage(meme, true);
      await markUsed(id);
      return true;
    },
  };
}
