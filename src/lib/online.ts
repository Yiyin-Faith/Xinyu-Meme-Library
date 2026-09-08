import type { OnlineMeme } from '../types';
import { MAX_IMAGE_SIZE, prepareImage } from './library';

const synonyms: Record<string, string[]> = {
  开心: ['happy', 'success', 'smile', 'excited'], 快乐: ['happy', 'smile'], 无语: ['facepalm', 'disappointed', 'awkward'],
  猫猫: ['cat', 'kitten'], 猫: ['cat', 'kitten'], 狗: ['dog', 'doge'], 可爱: ['cute', 'cat', 'doge'],
  打工: ['work', 'office', 'boss'], 摸鱼: ['work', 'office', 'lazy'], 震惊: ['surprised', 'what', 'disaster'],
  生气: ['angry', 'rage'], 难过: ['sad', 'cry'], 哭: ['cry', 'sad'], 好的: ['ok', 'yes', 'success'],
};
let templates: OnlineMeme[] | undefined;
export async function searchOnline(query: string, signal?: AbortSignal): Promise<OnlineMeme[]> {
  if (!templates) {
    const response = await fetch('https://api.memegen.link/templates/', { signal: signal ?? AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('在线图库暂时不可用，请稍后重试');
    const data = await response.json() as { id: string; name: string; blank: string; keywords?: string[]; example?: { url: string } }[];
    if (!Array.isArray(data)) throw new Error('在线图库返回格式错误');
    templates = data.filter((t) => typeof t.id === 'string' && typeof t.blank === 'string' && typeof t.name === 'string' && t.blank.startsWith('https://api.memegen.link/')).map((t) => ({ id: `memegen:${t.id}`, title: t.name, url: t.example?.url?.startsWith('https://api.memegen.link/') ? t.example.url : t.blank, tags: (t.keywords || []).filter((k) => typeof k === 'string'), source: 'Memegen', width: 0, height: 0 }));
  }
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return templates.slice(0, 48);
  return templates.filter((m) => terms.every((term) => [term, ...(synonyms[term] || [])].some((needle) => `${m.title} ${m.tags.join(' ')}`.toLowerCase().includes(needle)))).slice(0, 60);
}
export async function fetchOnlineImage(item: OnlineMeme) {
  const url = new URL(item.url);
  if (url.protocol !== 'https:' || url.hostname !== 'api.memegen.link') throw new Error('不支持的图片来源');
  const response = await fetch(item.url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('图片加载失败，请重试');
  if (Number(response.headers.get('content-length')) > MAX_IMAGE_SIZE) throw new Error('在线图片超过 32 MB');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('无法读取在线图片');
  const chunks: Uint8Array<ArrayBuffer>[] = []; let size = 0;
  try {
    while (true) {
      const result = await reader.read(); if (result.done) break;
      size += result.value.length;
      if (size > MAX_IMAGE_SIZE) throw new Error('在线图片超过 32 MB');
      chunks.push(result.value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  return prepareImage(new Blob(chunks), item.title, '', `Memegen · ${item.url}`);
}
