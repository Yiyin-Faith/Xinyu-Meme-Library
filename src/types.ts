export interface Meme {
  id: string;
  title: string;
  tags: string[];
  note: string;
  collectionId: string;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number;
  useCount: number;
  mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/avif' | 'image/svg+xml' | string;
  size: number;
  width: number;
  height: number;
  source: string;
  blob: Blob;
}
export interface Collection { id: string; name: string; color: string; updatedAt: number }
export interface Tombstone { id: string; deletedAt: number }
export interface Settings { id: 'preferences'; reduceMotion: boolean; dense: boolean; onlineSupplement: boolean }
export interface OnlineMeme { id: string; title: string; url: string; tags: string[]; source: string; width: number; height: number }
export type View = 'all' | 'favorites' | 'recent' | 'online' | 'tags' | 'sync' | 'settings' | `collection:${string}`;
declare global {
  interface Window {
    puffDesktop?: {
      copyImage(data: number[], mime: string): Promise<void>;
      saveFile(data: number[], name: string): Promise<boolean>;
      minimize(): void;
      close(): void;
      onQuickOpen(callback: () => void): () => void;
      info(): Promise<{ version: string; shortcut: boolean }>;
    };
  }
}
