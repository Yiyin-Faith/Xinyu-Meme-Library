import { useEffect, useState } from 'react';
import { Heart, Copy, Check, MoreHorizontal, Share2 } from 'lucide-react';
import type { Meme } from '../types';
import { isAndroid } from '../lib/platform';

export function useBlobUrl(blob?: Blob) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!blob) { setUrl(''); return; }
    const next = URL.createObjectURL(blob); setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}
export default function MemeCard({ meme, active, selecting, selected, onOpen, onFavorite, onUse, onSelect }: { meme: Meme; active: boolean; selecting: boolean; selected: boolean; onOpen: () => void; onFavorite: () => void; onUse: () => void; onSelect: () => void }) {
  const url = useBlobUrl(meme.blob);
  return <article className={`meme-card ${active ? 'active' : ''} ${selected ? 'selected' : ''}`}>
    <button className="meme-art" onClick={selecting ? onSelect : onOpen} aria-label={`${selecting ? '选择' : '查看'} ${meme.title}`}>
      {url && <img src={url} alt={meme.title} loading="lazy" draggable={false} />}
      {meme.mime === 'image/gif' && <span className="format-badge">GIF</span>}
      {selecting && <span className={`select-check ${selected ? 'checked' : ''}`}>{selected && <Check size={14} />}</span>}
    </button>
    {!selecting && <button className={`favorite-button ${meme.favorite ? 'on' : ''}`} aria-label={`${meme.favorite ? '取消喜欢' : '喜欢'} ${meme.title}`} onClick={onFavorite}><Heart size={16} fill={meme.favorite ? 'currentColor' : 'none'} /></button>}
    <div className="card-caption"><button onClick={onOpen} className="card-name">{meme.title}</button><button className="card-more icon-button" aria-label={`编辑 ${meme.title}`} onClick={onOpen}><MoreHorizontal size={17} /></button></div>
    <div className="card-bottom"><span>{meme.tags.slice(0, 2).map((tag) => `# ${tag}`).join('  ') || '添加一点小标签'}</span><button className="quick-copy" onClick={onUse} aria-label={`${isAndroid ? '分享' : '复制'} ${meme.title}`}>{isAndroid ? <Share2 size={13} /> : <Copy size={13} />}</button></div>
  </article>;
}
