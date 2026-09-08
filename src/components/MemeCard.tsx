import { useEffect, useRef, useState } from 'react';
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
export default function MemeCard({ meme, active, selecting, selected, onPreview, onManage, onFavorite, onUse, onTagSelect, onSelect }: { meme: Meme; active: boolean; selecting: boolean; selected: boolean; onPreview: () => void; onManage: () => void; onFavorite: () => void; onUse: () => void; onTagSelect: (tag: string) => void; onSelect: () => void }) {
  const url = useBlobUrl(meme.blob);
  const longPress = useRef<number | undefined>(undefined);
  const didLongPress = useRef(false);
  const clearLongPress = () => { const timer = longPress.current; if (timer !== undefined) window.clearTimeout(timer); longPress.current = undefined; };
  const beginLongPress = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (selecting || event.pointerType === 'mouse') return;
    didLongPress.current = false;
    longPress.current = window.setTimeout(() => { didLongPress.current = true; onManage(); }, 520);
  };
  const open = () => {
    if (selecting) { onSelect(); return; }
    if (didLongPress.current) { didLongPress.current = false; return; }
    onPreview();
  };
  return <article className={`meme-card ${active ? 'active' : ''} ${selected ? 'selected' : ''}`}>
    <button className="meme-art" onPointerDown={beginLongPress} onPointerUp={clearLongPress} onPointerLeave={clearLongPress} onPointerCancel={clearLongPress} onContextMenu={(event) => { if (!selecting) { event.preventDefault(); onManage(); } }} onClick={open} aria-label={`${selecting ? '选择' : '预览'} ${meme.title}`}>
      {url && <img src={url} alt={meme.title} loading="lazy" draggable={false} />}
      {meme.mime === 'image/gif' && <span className="format-badge">GIF</span>}
      {selecting && <span className={`select-check ${selected ? 'checked' : ''}`}>{selected && <Check size={14} />}</span>}
    </button>
    {!selecting && <button className={`favorite-button ${meme.favorite ? 'on' : ''}`} aria-label={`${meme.favorite ? '取消喜欢' : '喜欢'} ${meme.title}`} onClick={onFavorite}><Heart size={16} fill={meme.favorite ? 'currentColor' : 'none'} /></button>}
    <div className="card-caption"><button onClick={onPreview} className="card-name">{meme.title}</button><button className="card-more icon-button" aria-label={`管理 ${meme.title}`} onClick={onManage}><MoreHorizontal size={17} /></button></div>
    <div className="card-bottom"><div className="card-tags">{meme.tags.length ? meme.tags.slice(0, 2).map((tag) => <button key={tag} type="button" onClick={() => onTagSelect(tag)}># {tag}</button>) : <span>添加一点小标签</span>}</div><button className="quick-copy" onClick={onUse} aria-label={`${isAndroid ? '分享' : '复制'} ${meme.title}`}>{isAndroid ? <Share2 size={13} /> : <Copy size={13} />}</button></div>
  </article>;
}
