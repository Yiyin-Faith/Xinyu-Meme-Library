import type { Meme } from '../types';

export interface CommunityAuthor {
  id: string;
  name: string;
  handle: string;
  avatar: string;
}

export interface CommunityPost {
  id: string;
  author: CommunityAuthor;
  imageUrl: string;
  title: string;
  tags: string[];
  caption: string;
  createdAt: number;
  likes: number;
  liked: boolean;
  isLocalMock?: boolean;
}

export interface MockProfile extends CommunityAuthor {
  bio: string;
  following: number;
  followers: number;
  postCount: number;
}

export interface UploadQuota {
  limit: number;
  used: number;
  remaining: number;
  resetsLabel: string;
}

export interface CommunityDataSource {
  listPosts(): Promise<CommunityPost[]>;
  getProfile(): Promise<MockProfile>;
  getQuota(): Promise<UploadQuota>;
  toggleLike(postId: string): Promise<CommunityPost>;
  publishMeme(meme: Pick<Meme, 'blob' | 'title' | 'tags' | 'note'>): Promise<CommunityPost>;
}

interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const quotaStorageKey = 'puff-community-mock-quota-v1';
const base = import.meta.env.BASE_URL;
const sample = (name: string) => `${base}samples/${name}`;

const currentUser: MockProfile = {
  id: 'local-user',
  name: '心语用户',
  handle: '@local_mock',
  avatar: '心',
  bio: '这里暂时是本地 Mock 账号。表情仍只保存在你的设备上。',
  following: 12,
  followers: 28,
  postCount: 0,
};

const initialPosts: Array<Omit<CommunityPost, 'createdAt'> & { ageMinutes: number }> = [
  {
    id: 'mock-cat-cute',
    author: { id: 'momo', name: '摸摸猫', handle: '@momo', avatar: '猫' },
    imageUrl: sample('cat-cute.svg'),
    title: '今天也要探头一下',
    tags: ['猫猫', '可爱', '日常'],
    caption: '适合在群里悄悄出现的时候发。',
    ageMinutes: 18,
    likes: 86,
    liked: false,
  },
  {
    id: 'mock-work-coffee',
    author: { id: 'soup', name: '一碗热汤', handle: '@soup', avatar: '汤' },
    imageUrl: sample('work-coffee.svg'),
    title: '工位续命咖啡',
    tags: ['打工', '咖啡', '摸鱼'],
    caption: '周一到周五都能复用的表情。',
    ageMinutes: 54,
    likes: 132,
    liked: true,
  },
  {
    id: 'mock-done',
    author: { id: 'lulu', name: '噜噜', handle: '@lulu', avatar: '噜' },
    imageUrl: sample('done.svg'),
    title: '收到，马上办',
    tags: ['好的', '收到', '工作'],
    caption: '不想打字时的万能回应。',
    ageMinutes: 120,
    likes: 57,
    liked: false,
  },
];

function dayKey(now: number) {
  return new Date(now).toLocaleDateString('sv-SE');
}

function memoryStore(): KeyValueStore {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

export class LocalMockCommunityDataSource implements CommunityDataSource {
  private posts: CommunityPost[];
  private profile = { ...currentUser };
  private readonly storage: KeyValueStore;
  private readonly now: () => number;

  constructor(options: { storage?: KeyValueStore; now?: () => number } = {}) {
    this.storage = options.storage ?? (typeof localStorage === 'undefined' ? memoryStore() : localStorage);
    this.now = options.now ?? Date.now;
    this.posts = initialPosts.map(({ ageMinutes, ...post }) => ({ ...post, createdAt: this.now() - ageMinutes * 60 * 1000, author: { ...post.author }, tags: [...post.tags] }));
  }

  async listPosts() {
    return this.posts
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((post) => ({ ...post, author: { ...post.author }, tags: [...post.tags] }));
  }

  async getProfile() {
    return { ...this.profile };
  }

  async getQuota() {
    const now = this.now();
    const today = dayKey(now);
    const raw = this.storage.getItem(quotaStorageKey);
    let used = 0;
    try {
      const saved = raw ? JSON.parse(raw) as { date?: string; used?: number } : undefined;
      if (saved?.date === today && Number.isInteger(saved.used) && saved.used! >= 0) used = saved.used!;
    } catch {
      // A broken mock record should never prevent local image management from opening.
    }
    const quota = { date: today, used: Math.min(used, 3) };
    this.storage.setItem(quotaStorageKey, JSON.stringify(quota));
    return { limit: 3, used: quota.used, remaining: 3 - quota.used, resetsLabel: '明天自动恢复' };
  }

  async toggleLike(postId: string) {
    const post = this.posts.find((item) => item.id === postId);
    if (!post) throw new Error('这条社区内容已不存在');
    post.liked = !post.liked;
    post.likes += post.liked ? 1 : -1;
    return { ...post, author: { ...post.author }, tags: [...post.tags] };
  }

  async publishMeme(meme: Pick<Meme, 'blob' | 'title' | 'tags' | 'note'>) {
    const quota = await this.getQuota();
    if (!quota.remaining) throw new Error('今日本地模拟发布额度已用完，明天会自动恢复');
    this.storage.setItem(quotaStorageKey, JSON.stringify({ date: dayKey(this.now()), used: quota.used + 1 }));
    const post: CommunityPost = {
      id: `mock-local-${crypto.randomUUID()}`,
      author: { id: this.profile.id, name: this.profile.name, handle: this.profile.handle, avatar: this.profile.avatar },
      imageUrl: URL.createObjectURL(meme.blob),
      title: meme.title,
      tags: meme.tags.slice(0, 6),
      caption: meme.note || '这是一条只在当前设备展示的本地 Mock 发布。',
      createdAt: this.now(),
      likes: 0,
      liked: false,
      isLocalMock: true,
    };
    this.posts.unshift(post);
    this.profile.postCount += 1;
    return { ...post, author: { ...post.author }, tags: [...post.tags] };
  }
}

// Replace this single instance with an HTTP-backed implementation when real accounts and APIs arrive.
export const communityData: CommunityDataSource = new LocalMockCommunityDataSource();
