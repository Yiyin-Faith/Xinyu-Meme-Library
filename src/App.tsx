import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Archive, ArrowDownToLine, ArrowUpFromLine, Check, ChevronRight, Clipboard, Cloud, CloudOff, Copy,
  Download, FileImage, FolderPlus, Grid2X2, Heart, History, ImagePlus, Info, Keyboard, Layers3, Menu,
  MoreHorizontal, Pencil, Plus, Search, Settings, Share2, Sparkles, Tag, Trash2, Upload, X, Zap,
} from 'lucide-react';
import type { Collection, Meme, OnlineMeme, View } from './types';
import MemeCard, { useBlobUrl } from './components/MemeCard';
import Modal from './components/Modal';
import { db, defaultSettings, deleteMemes, formatBytes, importImages, initializeLibrary, markUsed, matchesSearch, updateMeme } from './lib/library';
import { exportLibrary, mergeBackup, readBackup } from './lib/backup';
import { fetchOnlineImage, searchOnline } from './lib/online';
import { isAndroid, isDesktop, platformName, saveBlob, useImage } from './lib/platform';

const viewLabels: Record<string, string> = { all: '全部表情', favorites: '喜欢的', recent: '最近使用', online: '在线补充', tags: '标签管理', sync: '导入与同步', settings: '偏好设置' };

function App() {
  const memes = useLiveQuery(() => db.memes.orderBy('createdAt').reverse().toArray(), []) ?? [];
  const collections = useLiveQuery(() => db.collections.orderBy('updatedAt').toArray(), []) ?? [];
  const settings = useLiveQuery(() => db.settings.get('preferences'), []) ?? defaultSettings;
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>('all');
  const [search, setSearch] = useState('');
  const [online, setOnline] = useState<OnlineMeme[]>([]);
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [onlineError, setOnlineError] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const [editId, setEditId] = useState<string>();
  const [toast, setToast] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tagFilter, setTagFilter] = useState('');
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [collectionName, setCollectionName] = useState('');

  const notify = useCallback((message: string) => { setToast(message); window.setTimeout(() => setToast(''), 3000); }, []);
  useEffect(() => { initializeLibrary().then(() => setReady(true)).catch((error) => { notify(error instanceof Error ? error.message : '表情库初始化失败'); setReady(true); }); }, [notify]);
  useEffect(() => { const listener = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); document.querySelector<HTMLInputElement>('#global-search')?.focus(); } if (event.key === 'Escape') { setEditId(undefined); setImportOpen(false); setBackupOpen(false); setMobileNav(false); } }; window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener); }, []);
  useEffect(() => { if (window.puffDesktop) return window.puffDesktop.onQuickOpen(() => document.querySelector<HTMLInputElement>('#global-search')?.focus()); }, []);

  const tags = useMemo(() => { const counts = new Map<string, number>(); memes.forEach((m) => m.tags.forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1))); return [...counts].sort((a, b) => b[1] - a[1]); }, [memes]);
  const visibleMemes = useMemo(() => {
    if (view === 'online' || view === 'sync' || view === 'settings' || view === 'tags') return [];
    return memes.filter((meme) => {
      if (view === 'favorites' && !meme.favorite) return false;
      if (view === 'recent' && !meme.lastUsedAt) return false;
      if (view.startsWith('collection:') && meme.collectionId !== view.slice(11)) return false;
      if (tagFilter && !meme.tags.includes(tagFilter)) return false;
      return matchesSearch(meme, search);
    }).sort((a, b) => view === 'recent' ? b.lastUsedAt - a.lastUsedAt : b.createdAt - a.createdAt);
  }, [memes, view, search, tagFilter]);
  const selectedMeme = memes.find((m) => m.id === selectedId);
  const editMeme = memes.find((m) => m.id === editId);
  const currentTitle = view.startsWith('collection:') ? collections.find((c) => c.id === view.slice(11))?.name || '收藏夹' : viewLabels[view] || '全部表情';

  async function copyMeme(meme: Meme, share = false) { try { const result = await useImage(meme, share); if (!result.includes('取消')) await markUsed(meme.id); notify(result); } catch (error) { notify(error instanceof Error ? error.message : '操作失败'); } }
  async function deleteSelected() { const ids = selecting && selected.size ? [...selected] : selectedId ? [selectedId] : []; if (!ids.length) return; await deleteMemes(ids); setSelected(new Set()); setSelecting(false); setSelectedId(undefined); notify(`已移除 ${ids.length} 张表情`); }
  function addCollection() { setCollectionName(''); setCollectionOpen(true); }
  async function createCollection() {
    const name = collectionName.trim(); if (!name) return;
    try {
      const collection: Collection = { id: crypto.randomUUID(), name: name.slice(0, 40), color: ['#9cb99a', '#dba79b', '#aaa2c3', '#d5b27c'][collections.length % 4], updatedAt: Date.now() };
      await db.collections.add(collection); setView(`collection:${collection.id}`); setCollectionOpen(false); notify('收藏夹已创建');
    } catch (error) { notify(error instanceof Error ? error.message : '收藏夹创建失败'); }
  }
  async function loadOnline() { if (!settings.onlineSupplement && view !== 'online') return; setOnlineLoading(true); setOnlineError(''); try { setOnline(await searchOnline(search)); } catch (error) { setOnlineError(error instanceof Error ? error.message : '在线图库暂时不可用'); } finally { setOnlineLoading(false); } }
  useEffect(() => { if (view !== 'online') return; const handle = window.setTimeout(loadOnline, search ? 380 : 0); return () => window.clearTimeout(handle); }, [view, search]);
  async function useOnline(item: OnlineMeme) { try { const meme = await fetchOnlineImage(item); notify(await useImage(meme, !isDesktop)); } catch (error) { notify(error instanceof Error ? error.message : '在线表情使用失败'); } }
  async function saveOnline(item: OnlineMeme) { try { const meme = await fetchOnlineImage(item); const exists = await db.memes.get(meme.id); if (exists) { notify('这张表情已在本地库中'); return; } await db.memes.add({ ...meme, tags: item.tags.slice(0, 20), source: item.source }); notify('已保存到本地表情库'); } catch (error) { notify(error instanceof Error ? error.message : '保存失败'); } }

  if (!ready) return <div className="loading-screen"><div className="brand-mark">心</div><strong>正在打开你的心语表情库</strong><span>离线数据只保存在这台设备上</span></div>;
  return <div className={`app-shell ${settings.reduceMotion ? 'reduce-motion' : ''}`}>
    <div className="ambient ambient-one" /><div className="ambient ambient-two" />
    <header className="topbar glass">
      <button className="mobile-menu icon-button" aria-label="打开导航" onClick={() => setMobileNav(true)}><Menu size={20} /></button>
      <button className="brand" onClick={() => { setView('all'); setSearch(''); }}><span className="brand-icon">心</span><span><strong>心语表情库</strong><small>MEME LIBRARY</small></span></button>
      <div className="topbar-status"><span className="status-dot" />{platformName}<span className="status-separator" />{memes.length} 张私藏</div>
      <div className="topbar-actions"><button className="glass-button subtle" onClick={() => setBackupOpen(true)}><ArrowUpFromLine size={16} /> <span>导入 / 同步</span></button><button className="primary-button" onClick={() => setImportOpen(true)}><Plus size={18} /><span>添加表情</span></button><button className="icon-button window-action" aria-label="更多" onClick={() => setView('settings')}><MoreHorizontal size={19} /></button></div>
    </header>
    <div className="layout">
      <aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
        <div className="sidebar-mobile-head"><strong>心语表情库</strong><button className="icon-button" aria-label="关闭导航" onClick={() => setMobileNav(false)}><X size={19} /></button></div>
        <div className="nav-section"><span className="nav-label">我的表情</span>
          <NavButton icon={<Grid2X2 size={17} />} label="全部表情" count={memes.length} active={view === 'all'} onClick={() => { setView('all'); setMobileNav(false); }} />
          <NavButton icon={<Heart size={17} />} label="喜欢的" count={memes.filter((m) => m.favorite).length} active={view === 'favorites'} onClick={() => { setView('favorites'); setMobileNav(false); }} />
          <NavButton icon={<History size={17} />} label="最近使用" count={memes.filter((m) => m.lastUsedAt).length} active={view === 'recent'} onClick={() => { setView('recent'); setMobileNav(false); }} />
        </div>
        <div className="nav-section collections"><div className="nav-label-row"><span className="nav-label">收藏夹</span><button className="mini-add" aria-label="新建收藏夹" onClick={addCollection}><Plus size={14} /></button></div>{collections.map((collection) => <NavButton key={collection.id} icon={<span className="collection-dot" style={{ background: collection.color }} />} label={collection.name} count={memes.filter((m) => m.collectionId === collection.id).length} active={view === `collection:${collection.id}`} onClick={() => { setView(`collection:${collection.id}`); setMobileNav(false); }} />)}<button className="add-collection" onClick={addCollection}><FolderPlus size={15} /> 新建收藏夹</button></div>
        <div className="nav-section sidebar-tools"><span className="nav-label">探索与工具</span><NavButton icon={<Sparkles size={17} />} label="在线补充" active={view === 'online'} onClick={() => { setView('online'); setMobileNav(false); }} /><NavButton icon={<Tag size={17} />} label="标签管理" count={tags.length} active={view === 'tags'} onClick={() => { setView('tags'); setMobileNav(false); }} /><NavButton icon={<Archive size={17} />} label="导入与同步" active={view === 'sync'} onClick={() => { setView('sync'); setMobileNav(false); }} /></div>
        <div className="sidebar-bottom"><button className="nav-button" onClick={() => setView('settings')}><Settings size={17} /><span>偏好设置</span></button><div className="privacy-note"><CloudOff size={14} /><span>本地优先 · 数据归你</span></div></div>
      </aside>
      {mobileNav && <button className="sidebar-scrim" aria-label="关闭导航" onClick={() => setMobileNav(false)} />}
      <main className="main-content">
        <section className="page-head"><div><div className="eyebrow">{view === 'online' ? 'LOCAL FIRST · ONLINE EXTRA' : 'YOUR PERSONAL COLLECTION'}</div><h1>{currentTitle}<span className="title-count">{view === 'online' ? online.length : visibleMemes.length}</span></h1><p>{view === 'online' ? '先从本地找，想换个口味时再向在线图库借一张。无需收藏也能直接分享。' : view === 'all' ? '把常用的表达放在手边，复制、发送只需要一瞬间。' : view === 'sync' ? '用一个完整备份，在 Windows 与 Android 之间带走图片和所有元数据。' : '整理好自己的语气，下一次找到它会更快。'}</p></div><div className="page-head-actions">{(view === 'all' || view.startsWith('collection:') || view === 'favorites' || view === 'recent') && <button className={`glass-button ${selecting ? 'selected-mode' : ''}`} onClick={() => { setSelecting((s) => !s); setSelected(new Set()); }}><Check size={16} /> {selecting ? '完成选择' : '批量管理'}</button>}</div></section>
        <div className="search-row"><label className="search-box glass"><Search size={19} /><input id="global-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={view === 'online' ? '搜一张想用的表情，例如：猫猫 开心' : '搜索标题、标签、备注…'} /><kbd>⌘ K</kbd>{search && <button className="clear-search" aria-label="清空搜索" onClick={() => setSearch('')}><X size={15} /></button>}</label><span className="search-tip"><Keyboard size={14} /> 支持多个关键词</span></div>
        {tagFilter && <div className="filter-chip"><Tag size={14} /> #{tagFilter}<button aria-label="移除标签筛选" onClick={() => setTagFilter('')}><X size={13} /></button></div>}
        {view === 'online' ? <OnlineView items={online} loading={onlineLoading} error={onlineError} onRetry={loadOnline} onUse={useOnline} onSave={saveOnline} /> : view === 'sync' ? <SyncView onImport={() => setImportOpen(true)} onBackup={() => setBackupOpen(true)} onNotify={notify} /> : view === 'settings' ? <SettingsView settings={settings} onNotify={notify} /> : view === 'tags' ? <TagsView tags={tags} onSelect={(tag) => { setTagFilter(tag); setView('all'); }} /> : <>
          {visibleMemes.length ? <div className={`meme-grid ${settings.dense ? 'dense' : ''}`}>{visibleMemes.map((meme) => <MemeCard key={meme.id} meme={meme} active={meme.id === selectedId} selecting={selecting} selected={selected.has(meme.id)} onOpen={() => setEditId(meme.id)} onFavorite={() => updateMeme(meme.id, { favorite: !meme.favorite })} onUse={() => copyMeme(meme)} onSelect={() => setSelected((old) => { const next = new Set(old); next.has(meme.id) ? next.delete(meme.id) : next.add(meme.id); return next; })} />)}</div> : <EmptyState search={search} view={view} onAdd={() => setImportOpen(true)} onOnline={() => setView('online')} />}
          {selecting && selected.size > 0 && <div className="batch-bar glass"><span>已选择 <strong>{selected.size}</strong> 张</span><button className="danger-button" onClick={deleteSelected}><Trash2 size={16} /> 移除选中</button></div>}
        </>}
      </main>
      {selectedMeme && !editMeme && <button className="detail-scrim" aria-label="关闭详情" onClick={() => setSelectedId(undefined)} />}
    </div>
    {editMeme && <EditModal meme={editMeme} collections={collections} onClose={() => setEditId(undefined)} onNotify={notify} onUse={() => copyMeme(editMeme)} onDelete={async () => { await deleteMemes([editMeme.id]); setEditId(undefined); notify('表情已移除'); }} />}
    {importOpen && <ImportModal collections={collections} onClose={() => setImportOpen(false)} onNotify={notify} />}
    {backupOpen && <BackupModal onClose={() => setBackupOpen(false)} onNotify={notify} />}
    {collectionOpen && <Modal title="新建收藏夹" onClose={() => setCollectionOpen(false)}><form className="edit-fields" onSubmit={(event) => { event.preventDefault(); void createCollection(); }}><label>收藏夹名称<input autoFocus value={collectionName} onChange={(event) => setCollectionName(event.target.value)} required maxLength={40} /></label><button type="submit" className="primary-button">创建收藏夹</button></form></Modal>}
    {toast && <div className="toast glass"><Check size={16} />{toast}</div>}
  </div>;
}

function NavButton({ icon, label, count, active, onClick }: { icon: React.ReactNode; label: string; count?: number; active: boolean; onClick: () => void }) { return <button className={`nav-button ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{label}</span>{count !== undefined && <em>{count}</em>}<ChevronRight className="nav-chevron" size={14} /></button>; }

function EmptyState({ search, view, onAdd, onOnline }: { search: string; view: View; onAdd: () => void; onOnline: () => void }) { return <div className="empty-state glass"><div className="empty-icon"><FileImage size={28} /></div><h2>{search ? `没有找到“${search}”` : view === 'favorites' ? '还没有喜欢的表情' : '这里还空着'}</h2><p>{search ? '换个关键词，或者给表情补充一些标签。' : '把你最常用的图片拖进来，建立自己的表达方式。'}</p><div><button className="primary-button" onClick={onAdd}><ImagePlus size={17} /> 导入表情</button><button className="glass-button" onClick={onOnline}><Sparkles size={16} /> 看在线补充</button></div></div>; }

function OnlineView({ items, loading, error, onRetry, onUse, onSave }: { items: OnlineMeme[]; loading: boolean; error: string; onRetry: () => void; onUse: (item: OnlineMeme) => void; onSave: (item: OnlineMeme) => void }) { return <div className="online-view"><div className="online-callout glass"><Sparkles size={18} /><span><strong>在线补充</strong> · 结果来自 Memegen，搜索只读取公开的模板清单；使用时才加载原图。</span><Cloud size={17} /></div>{loading ? <div className="inline-loading"><span className="spinner" />正在找适合你的表达…</div> : error ? <div className="error-state glass"><CloudOff size={22} /><strong>{error}</strong><button className="glass-button" onClick={onRetry}>重新连接</button></div> : items.length ? <div className="online-grid">{items.map((item) => <OnlineCard key={item.id} item={item} onUse={() => onUse(item)} onSave={() => onSave(item)} />)}</div> : <div className="empty-state glass"><div className="empty-icon"><Sparkles size={27} /></div><h2>换一个关键词试试</h2><p>例如：cat、happy、work，或直接输入中文。</p></div>}</div>; }
function OnlineCard({ item, onUse, onSave }: { item: OnlineMeme; onUse: () => void; onSave: () => void }) { return <article className="online-card glass"><div className="online-image"><img src={item.url} alt={item.title} loading="lazy" /></div><div className="online-card-footer"><span>{item.title}</span><div><button className="mini-action" title="直接分享" onClick={onUse}><Share2 size={15} /></button><button className="mini-action" title="保存到本地" onClick={onSave}><Download size={15} /></button></div></div></article>; }

function SyncView({ onImport, onBackup, onNotify }: { onImport: () => void; onBackup: () => void; onNotify: (message: string) => void }) { const [drag, setDrag] = useState(false); const onDrop = (event: React.DragEvent) => { event.preventDefault(); setDrag(false); onNotify('请点击“添加表情”选择图片，或在弹窗中继续导入'); onImport(); }; return <div className="sync-view"><div className={`drop-zone glass ${drag ? 'dragging' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}><div className="drop-icon"><Upload size={29} /></div><h2>把图片放到这里</h2><p>支持 PNG、JPG、GIF、WebP、AVIF 和 SVG，单张最大 32 MB</p><button className="primary-button" onClick={onImport}><ImagePlus size={17} /> 选择图片</button></div><div className="sync-cards"><button className="sync-card glass" onClick={onBackup}><div className="sync-card-icon"><Archive size={21} /></div><div><strong>完整备份</strong><span>原图、标签、备注、收藏夹一次带走</span></div><ChevronRight size={18} /></button><button className="sync-card glass" onClick={onBackup}><div className="sync-card-icon"><ArrowDownToLine size={21} /></div><div><strong>从备份恢复</strong><span>自动合并较新的修改，保留本机内容</span></div><ChevronRight size={18} /></button></div></div>; }

function TagsView({ tags, onSelect }: { tags: [string, number][]; onSelect: (tag: string) => void }) { return <div className="tags-view glass"><div className="tag-cloud">{tags.map(([tag, count]) => <button key={tag} className="tag-pill" onClick={() => onSelect(tag)}><Tag size={14} />#{tag}<em>{count}</em></button>)}</div>{!tags.length && <div className="empty-inline"><Tag size={22} />导入表情后，这里会出现你的标签。</div>}</div>; }

function SettingsView({ settings, onNotify }: { settings: { reduceMotion: boolean; dense: boolean; onlineSupplement: boolean }; onNotify: (message: string) => void }) { const set = async (key: keyof typeof settings, value: boolean) => { await db.settings.put({ id: 'preferences', ...settings, [key]: value }); onNotify('偏好设置已更新'); }; return <div className="settings-view"><div className="settings-card glass"><div className="setting-title"><div className="setting-icon"><Zap size={18} /></div><div><h2>使用偏好</h2><p>让心语更贴近你的节奏。</p></div></div><SettingToggle title="紧凑网格" description="每屏显示更多表情，适合大收藏库。" value={settings.dense} onChange={(value) => set('dense', value)} /><SettingToggle title="减少动态效果" description="关闭流光和弹性动画。" value={settings.reduceMotion} onChange={(value) => set('reduceMotion', value)} /><SettingToggle title="启用在线补充" description="在本地结果之后提供 Memegen 在线搜索入口。" value={settings.onlineSupplement} onChange={(value) => set('onlineSupplement', value)} /></div><div className="settings-card glass"><div className="setting-title"><div className="setting-icon"><Info size={18} /></div><div><h2>关于心语表情库</h2><p>跨 Windows 与 Android 的私人表情库。</p></div></div><div className="about-row"><span>当前平台</span><strong>{platformName}</strong></div><div className="about-row"><span>数据位置</span><strong>本机 IndexedDB</strong></div><div className="about-row"><span>版本</span><strong>0.1.0 · 离线优先</strong></div><p className="about-note">参考 OhMyMeme 的快捷调用与复制路径，参考 Rays 的标签、正则搜索和分享思路。原图和元数据不上传云端，在线图库仅在你主动打开时请求。</p></div></div>; }
function SettingToggle({ title, description, value, onChange }: { title: string; description: string; value: boolean; onChange: (value: boolean) => void }) { return <label className="setting-toggle"><span><strong>{title}</strong><small>{description}</small></span><input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} /><i /></label>; }

function EditModal({ meme, collections, onClose, onNotify, onUse, onDelete }: { meme: Meme; collections: Collection[]; onClose: () => void; onNotify: (message: string) => void; onUse: () => void; onDelete: () => void }) { const [title, setTitle] = useState(meme.title); const [note, setNote] = useState(meme.note); const [tags, setTags] = useState(meme.tags.join('，')); const [collectionId, setCollectionId] = useState(meme.collectionId); const url = useBlobUrl(meme.blob); const save = async () => { await updateMeme(meme.id, { title: title.trim() || '未命名表情', note, tags: tags.split(/[，,\s]+/).map((x) => x.replace(/^#/, '').trim()).filter(Boolean).slice(0, 30), collectionId }); onNotify('表情信息已保存'); onClose(); }; return <Modal title="编辑表情" subtitle="给它一个更容易被找到的语气。" onClose={onClose}><div className="edit-layout"><div className="edit-preview"><img src={url} alt={meme.title} /></div><div className="edit-fields"><label>标题<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} /></label><label>标签<input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="例如：开心 反应 朋友" /></label><label>收藏夹<select value={collectionId} onChange={(e) => setCollectionId(e.target.value)}><option value="">未分类</option>{collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>备注<textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} maxLength={10000} placeholder="记录这张图最适合什么时候发…" /></label><div className="edit-actions"><button className="danger-ghost" onClick={onDelete}><Trash2 size={15} /> 移除</button><span /><button className="glass-button" onClick={onUse}><Copy size={15} /> {isAndroid ? '分享' : '复制'}</button><button className="primary-button" onClick={save}><Check size={16} /> 保存</button></div></div></div></Modal>; }

function ImportModal({ collections, onClose, onNotify }: { collections: Collection[]; onClose: () => void; onNotify: (message: string) => void }) { const input = useRef<HTMLInputElement>(null); const [collectionId, setCollectionId] = useState(''); const [busy, setBusy] = useState(false); const choose = async (files: FileList | null) => { if (!files?.length) return; setBusy(true); try { const result = await importImages([...files], collectionId); const detail = result.errors.length ? `；${result.errors.slice(0, 2).join('；')}` : ''; onNotify(`已导入 ${result.added} 张，跳过 ${result.skipped} 张${detail}`); onClose(); } catch (error) { onNotify(error instanceof Error ? error.message : '导入失败'); } finally { setBusy(false); } }; return <Modal title="添加表情" subtitle="图片只会保存在当前设备的本地表情库。" onClose={busy ? () => undefined : onClose}><div className="import-modal"><div className="import-picker" onClick={() => input.current?.click()}><input ref={input} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml" multiple hidden onChange={(e) => choose(e.target.files)} /><ImagePlus size={30} /><strong>{busy ? '正在整理图片…' : '点击选择，或把图片拖进来'}</strong><span>支持批量导入，内容相同的图片会自动去重</span></div><label>放入收藏夹<select value={collectionId} onChange={(e) => setCollectionId(e.target.value)}><option value="">未分类</option>{collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label></div></Modal>; }

function BackupModal({ onClose, onNotify }: { onClose: () => void; onNotify: (message: string) => void }) { const input = useRef<HTMLInputElement>(null); const [busy, setBusy] = useState(false); const [deletions, setDeletions] = useState(true); const [restoreSettings, setRestoreSettings] = useState(false); const create = async () => { setBusy(true); try { const blob = await exportLibrary(); await saveBlob(blob, `puff-backup-${new Date().toISOString().slice(0, 10)}.puff.zip`); onNotify('完整备份已生成'); onClose(); } catch (error) { onNotify(error instanceof Error ? error.message : '备份失败'); } finally { setBusy(false); } }; const restore = async (file: File) => { setBusy(true); try { const backup = await readBackup(file); const result = await mergeBackup(backup, deletions, restoreSettings); onNotify(`恢复完成：新增 ${result.added}，更新 ${result.updated}，跳过 ${result.skipped}`); onClose(); } catch (error) { onNotify(error instanceof Error ? error.message : '恢复失败，未修改本地库'); } finally { setBusy(false); } }; return <Modal title="导入与同步" subtitle="心语表情库备份（.puff.zip）是跨 Windows 和 Android 的完整离线备份格式。" onClose={busy ? () => undefined : onClose}><div className="backup-modal"><div className="backup-option primary-option"><div className="backup-icon"><ArrowUpFromLine size={20} /></div><div><strong>导出完整备份</strong><span>原图和所有标签、备注、收藏夹都会写进一个 ZIP。</span></div><button className="primary-button" disabled={busy} onClick={create}><Download size={15} /> 导出</button></div><div className="backup-option"><div className="backup-icon"><ArrowDownToLine size={20} /></div><div><strong>从备份恢复</strong><span>先完整校验，再合并到当前库，不会覆盖较新的本地修改。</span></div><button className="glass-button" disabled={busy} onClick={() => input.current?.click()}><Upload size={15} /> 选择 ZIP</button><input ref={input} hidden type="file" accept=".zip,.puff.zip,application/zip" onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} /></div><div className="backup-settings"><SettingToggle title="同步删除记录" description="把备份中明确删除的表情也从本机移除。" value={deletions} onChange={setDeletions} /><SettingToggle title="恢复偏好设置" description="同时恢复紧凑网格、动效和在线补充开关。" value={restoreSettings} onChange={setRestoreSettings} /></div><p className="backup-footnote"><Info size={14} /> ZIP 经过路径、大小、图片格式和 SHA-256 校验；不接受未知文件或超大压缩包。</p></div></Modal>; }

export default App;
