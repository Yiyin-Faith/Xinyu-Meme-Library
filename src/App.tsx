import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Archive, ArrowDownToLine, ArrowLeft, ArrowUpFromLine, Check, ChevronRight, Clipboard, Cloud, CloudOff, Copy,
  Download, FileImage, FolderPlus, Grid2X2, Heart, History, ImagePlus, Info, Keyboard, Layers3, Menu,
  MessageCircle, MoreHorizontal, Pencil, Plus, RefreshCw, Search, Send, Settings, Share2, Sparkles, Tag, Trash2, Upload, UserRound, X, Zap,
} from 'lucide-react';
import type { Collection, Meme, OnlineMeme, Settings as PreferenceSettings, View } from './types';
import MemeCard, { useBlobUrl } from './components/MemeCard';
import Modal from './components/Modal';
import { db, defaultSettings, deleteMemes, formatBytes, getOrCreateCollection, importImages, initializeLibrary, markUsed, matchesSearch, normalizeTags, updateMeme } from './lib/library';
import { exportLibrary, mergeBackup, readBackup, type ExportProgress } from './lib/backup';
import { AndroidBackupCopyError, exportAndroidBackup, type AndroidBackupProgress } from './lib/android-backup';
import { fetchOnlineImage, searchOnline } from './lib/online';
import { deliverAndroidFloatingMiniSnapshot, getAndroidAccessibilityRecommendationStatus, getAndroidFloatingWindowStatus, isAndroid, isDesktop, platformName, requestAndroidAccessibilityRecommendationPermission, requestAndroidFloatingWindowPermission, saveBlob, setAndroidAccessibilityRecommendationEnabled, setAndroidAccessibilityRecommendationMode, setAndroidAccessibilityRecommendationTags, setAndroidFloatingWindow, setAndroidFloatingWindowOpacity, setAlwaysOnTop, syncAndroidFloatingMiniCatalog, useImage } from './lib/platform';
import { communityData, type CommunityPost, type MockProfile, type UploadQuota } from './lib/community';
import { createFloatingMiniBridge, floatingMiniCatalog, type FloatingMiniBridge } from './lib/floating-mini';

const viewLabels: Record<string, string> = { all: '全部表情', favorites: '喜欢的', recent: '最近使用', online: '在线补充', tags: '标签管理', sync: '导入与同步', settings: '偏好设置' };
const CURRENT_VERSION = '0.5.5';
type PrimaryTab = 'community' | 'library' | 'profile';

declare global {
  interface Window { __xinyuFloatingMini?: FloatingMiniBridge }
}

function App() {
  const queriedMemes = useLiveQuery(() => db.memes.orderBy('createdAt').reverse().toArray(), []);
  const memes = queriedMemes ?? [];
  const memesLoaded = queriedMemes !== undefined;
  const collections = useLiveQuery(() => db.collections.orderBy('updatedAt').toArray(), []) ?? [];
  const settings = useLiveQuery(() => db.settings.get('preferences'), []) ?? defaultSettings;
  const [ready, setReady] = useState(false);
  const [primaryTab, setPrimaryTab] = useState<PrimaryTab>('library');
  const [view, setView] = useState<View>('all');
  const [search, setSearch] = useState('');
  const [online, setOnline] = useState<OnlineMeme[]>([]);
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [onlineError, setOnlineError] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const [previewId, setPreviewId] = useState<string>();
  const [manageId, setManageId] = useState<string>();
  const [editId, setEditId] = useState<string>();
  const [importOpen, setImportOpen] = useState(false);
  const [pendingImportFiles, setPendingImportFiles] = useState<File[]>([]);
  const [toast, setToast] = useState('');
  const [backupOpen, setBackupOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tagFilter, setTagFilter] = useState('');
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [collectionName, setCollectionName] = useState('');
  const [communityPosts, setCommunityPosts] = useState<CommunityPost[]>([]);
  const [mockProfile, setMockProfile] = useState<MockProfile>();
  const [uploadQuota, setUploadQuota] = useState<UploadQuota>();

  const notify = useCallback((message: string) => { setToast(message); window.setTimeout(() => setToast(''), 3000); }, []);
  useEffect(() => { initializeLibrary().then(() => setReady(true)).catch((error) => { notify(error instanceof Error ? error.message : '表情库初始化失败'); setReady(true); }); }, [notify]);
  useEffect(() => { const listener = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPrimaryTab('library'); document.querySelector<HTMLInputElement>('#global-search')?.focus(); } if (event.key === 'Escape') { setPreviewId(undefined); setManageId(undefined); setEditId(undefined); setImportOpen(false); setBackupOpen(false); setMobileNav(false); } }; window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener); }, []);
  useEffect(() => { if (window.puffDesktop) return window.puffDesktop.onQuickOpen(() => document.querySelector<HTMLInputElement>('#global-search')?.focus()); }, []);
  useEffect(() => { if (!isDesktop) return; void setAlwaysOnTop(settings.floatingWindow).catch(() => undefined); }, [settings.floatingWindow]);
  useEffect(() => {
    if (!ready || !isAndroid) return;
    let disposed = false;
    const disablePreference = (message: string) => {
      if (disposed) return;
      void db.settings.put({ ...settings, floatingWindow: false });
      notify(message);
    };
    const syncFloatingWindow = async () => {
      try {
        const current = await getAndroidFloatingWindowStatus();
        if (!settings.floatingWindow) {
          if (current.enabled) await setAndroidFloatingWindow(false);
          await setAndroidAccessibilityRecommendationEnabled(false).catch(() => undefined);
          return;
        }
        if (!current.granted) {
          await setAndroidAccessibilityRecommendationEnabled(false).catch(() => undefined);
          disablePreference('悬浮窗权限已关闭，已自动关闭开关');
          return;
        }
        if (current.enabled) return;
        const started = await setAndroidFloatingWindow(true);
        if (!started.enabled) disablePreference('悬浮窗未能显示，已自动关闭开关');
      } catch {
        disablePreference('悬浮窗未能恢复，已自动关闭开关');
      }
    };
    void syncFloatingWindow();
    const onVisibilityChange = () => { if (document.visibilityState === 'visible') void syncFloatingWindow(); };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => { disposed = true; document.removeEventListener('visibilitychange', onVisibilityChange); };
  }, [ready, settings.id, settings.floatingWindow, notify]);

  const tags = useMemo(() => { const counts = new Map<string, number>(); memes.forEach((m) => m.tags.forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1))); return [...counts].sort((a, b) => b[1] - a[1]); }, [memes]);
  useEffect(() => {
    if (!ready || !isAndroid) return;
    // Only current user-owned tag names cross the native bridge. The native
    // accessibility service retains them in process memory and never writes a
    // parallel tag or keyword database.
    void setAndroidAccessibilityRecommendationTags(tags.map(([tag]) => tag)).catch(() => undefined);
  }, [ready, tags]);
  useEffect(() => {
    // Do not overwrite Android's last usable catalog with the temporary []
    // produced while Dexie is still opening. The bridge and the persisted
    // metadata snapshot are published only after this live query has loaded.
    if (!ready || !isAndroid || !memesLoaded) return;
    const bridge = createFloatingMiniBridge(memes, deliverAndroidFloatingMiniSnapshot);
    window.__xinyuFloatingMini = bridge;
    void syncAndroidFloatingMiniCatalog(floatingMiniCatalog(memes)).catch(() => undefined);
    return () => { if (window.__xinyuFloatingMini === bridge) delete window.__xinyuFloatingMini; };
  }, [ready, memesLoaded, memes]);
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
  const previewMeme = memes.find((m) => m.id === previewId);
  const manageMeme = memes.find((m) => m.id === manageId);
  const editMeme = memes.find((m) => m.id === editId);
  const currentTitle = view.startsWith('collection:') ? collections.find((c) => c.id === view.slice(11))?.name || '收藏夹' : viewLabels[view] || '全部表情';

  const refreshCommunity = useCallback(async () => {
    const [posts, profile, quota] = await Promise.all([communityData.listPosts(), communityData.getProfile(), communityData.getQuota()]);
    setCommunityPosts(posts); setMockProfile(profile); setUploadQuota(quota);
  }, []);
  useEffect(() => { void refreshCommunity(); }, [refreshCommunity]);

  function openImport(files: File[] = []) { setPendingImportFiles(files); setImportOpen(true); }
  function closeImport() { setImportOpen(false); setPendingImportFiles([]); }
  const canReturnToLibrary = primaryTab === 'library' && (view !== 'all' || Boolean(tagFilter) || Boolean(search) || selecting);
  function returnToLibrary() { setView('all'); setTagFilter(''); setSearch(''); setSelecting(false); setSelected(new Set()); setMobileNav(false); }

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
  useEffect(() => { if (view !== 'online') return; const handle = window.setTimeout(loadOnline, search ? 380 : 0); return () => window.clearTimeout(handle); }, [view, search, settings.onlineSupplement]);
  async function useOnline(item: OnlineMeme) { try { const meme = await fetchOnlineImage(item); notify(await useImage(meme, !isDesktop)); } catch (error) { notify(error instanceof Error ? error.message : '在线表情使用失败'); } }
  async function saveOnline(item: OnlineMeme) { try { const meme = await fetchOnlineImage(item); const exists = await db.memes.get(meme.id); if (exists) { notify('这张表情已在本地库中'); return; } await db.memes.add({ ...meme, tags: item.tags.slice(0, 20), source: item.source }); notify('已保存到本地表情库'); } catch (error) { notify(error instanceof Error ? error.message : '保存失败'); } }
  async function toggleCommunityLike(postId: string) { try { await communityData.toggleLike(postId); await refreshCommunity(); } catch (error) { notify(error instanceof Error ? error.message : '操作失败'); } }
  async function publishToCommunity(meme: Meme) { try { await communityData.publishMeme(meme); await refreshCommunity(); setPreviewId(undefined); setPrimaryTab('community'); notify('已模拟发布到本地社区，不会上传真实图片'); } catch (error) { notify(error instanceof Error ? error.message : '模拟发布失败'); } }

  if (!ready) return <div className="loading-screen"><div className="brand-mark">心</div><strong>正在打开你的心语表情库</strong><span>离线数据只保存在这台设备上</span></div>;
  return <div className={`app-shell primary-${primaryTab} ${settings.reduceMotion ? 'reduce-motion' : ''}`}>
    <div className="ambient ambient-one" /><div className="ambient ambient-two" />
    <header className="topbar glass">
      {primaryTab === 'library' && (canReturnToLibrary ? <button className="topbar-back icon-button" aria-label="返回全部表情" onClick={returnToLibrary}><ArrowLeft size={20} /></button> : <button className="mobile-menu icon-button" aria-label="打开导航" onClick={() => setMobileNav(true)}><Menu size={20} /></button>)}
      <button className="brand" onClick={() => { setPrimaryTab('library'); setView('all'); setSearch(''); }}><span className="brand-icon">心</span><span><strong>心语表情库</strong><small>MEME LIBRARY</small></span></button>
      <div className="topbar-status"><span className="status-dot" />{platformName}<span className="status-separator" />{memes.length} 张私藏</div>
      <div className="topbar-actions"><button className="glass-button subtle" onClick={() => setBackupOpen(true)}><ArrowUpFromLine size={16} /> <span>导入 / 同步</span></button><button className="primary-button" onClick={() => openImport()}><Plus size={18} /><span>添加图片</span></button><button className="icon-button window-action" aria-label="更多" onClick={() => { setPrimaryTab('library'); setView('settings'); }}><MoreHorizontal size={19} /></button></div>
    </header>
    <div className={`layout ${primaryTab === 'library' ? '' : 'single-column'}`}>
      {primaryTab === 'library' && <aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
        <div className="sidebar-mobile-head"><strong>心语表情库</strong><button className="icon-button" aria-label="关闭导航" onClick={() => setMobileNav(false)}><X size={19} /></button></div>
        <div className="sidebar-scroll">
        <div className="nav-section"><span className="nav-label">我的表情</span>
          <NavButton icon={<Grid2X2 size={17} />} label="全部表情" count={memes.length} active={view === 'all'} onClick={() => { setView('all'); setMobileNav(false); }} />
          <NavButton icon={<Heart size={17} />} label="喜欢的" count={memes.filter((m) => m.favorite).length} active={view === 'favorites'} onClick={() => { setView('favorites'); setMobileNav(false); }} />
          <NavButton icon={<History size={17} />} label="最近使用" count={memes.filter((m) => m.lastUsedAt).length} active={view === 'recent'} onClick={() => { setView('recent'); setMobileNav(false); }} />
        </div>
        <div className="nav-section collections"><div className="nav-label-row"><span className="nav-label">收藏夹</span><button className="mini-add" aria-label="新建收藏夹" onClick={addCollection}><Plus size={14} /></button></div>{collections.map((collection) => <NavButton key={collection.id} icon={<span className="collection-dot" style={{ background: collection.color }} />} label={collection.name} count={memes.filter((m) => m.collectionId === collection.id).length} active={view === `collection:${collection.id}`} onClick={() => { setView(`collection:${collection.id}`); setMobileNav(false); }} />)}<button className="add-collection" onClick={addCollection}><FolderPlus size={15} /> 新建收藏夹</button></div>
        <div className="nav-section sidebar-tools"><span className="nav-label">探索与工具</span><NavButton icon={<Sparkles size={17} />} label="在线补充" active={view === 'online'} onClick={() => { setView('online'); setMobileNav(false); }} /><NavButton icon={<Tag size={17} />} label="标签管理" count={tags.length} active={view === 'tags'} onClick={() => { setView('tags'); setMobileNav(false); }} /><NavButton icon={<Archive size={17} />} label="导入与同步" active={view === 'sync'} onClick={() => { setView('sync'); setMobileNav(false); }} /></div>
        </div>
        <div className="sidebar-bottom"><button className="nav-button" onClick={() => { setView('settings'); setMobileNav(false); }}><Settings size={17} /><span>偏好设置</span></button><div className="privacy-note"><CloudOff size={14} /><span>本地优先 · 数据归你</span></div></div>
      </aside>}
      {primaryTab === 'library' && mobileNav && <button className="sidebar-scrim" aria-label="关闭导航" onClick={() => setMobileNav(false)} />}
      <main className="main-content">
        {primaryTab === 'community' ? <CommunityView posts={communityPosts} quota={uploadQuota} onLike={toggleCommunityLike} onOpenLibrary={() => setPrimaryTab('library')} /> : primaryTab === 'profile' ? <ProfileView profile={mockProfile} quota={uploadQuota} onOpenSync={() => { setPrimaryTab('library'); setView('sync'); }} onOpenSettings={() => { setPrimaryTab('library'); setView('settings'); }} /> : <>
        <section className="page-head"><div><div className="eyebrow">{view === 'online' ? 'LOCAL FIRST · ONLINE EXTRA' : 'YOUR PERSONAL COLLECTION'}</div><h1>{currentTitle}<span className="title-count">{view === 'online' ? online.length : visibleMemes.length}</span></h1><p>{view === 'online' ? '先从本地找，想换个口味时再向在线图库借一张。无需收藏也能直接分享。' : view === 'all' ? '把常用的表达放在手边，复制、发送只需要一瞬间。' : view === 'sync' ? '用一个完整备份，在 Windows 与 Android 之间带走图片和所有元数据。' : '整理好自己的语气，下一次找到它会更快。'}</p></div><div className="page-head-actions">{(view === 'all' || view.startsWith('collection:') || view === 'favorites' || view === 'recent') && <button className={`glass-button ${selecting ? 'selected-mode' : ''}`} onClick={() => { setSelecting((s) => !s); setSelected(new Set()); }}><Check size={16} /> {selecting ? '完成选择' : '批量管理'}</button>}</div></section>
        <div className="search-row"><label className="search-box glass"><Search size={19} /><input id="global-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={view === 'online' ? '搜一张想用的表情，例如：猫猫 开心' : '搜索标题、标签、备注…'} /><kbd>⌘ K</kbd>{search && <button className="clear-search" aria-label="清空搜索" onClick={() => setSearch('')}><X size={15} /></button>}</label><span className="search-tip"><Keyboard size={14} /> 支持多个关键词</span></div>
        {(view === 'all' || view === 'favorites' || view === 'recent' || view.startsWith('collection:')) && <TagShortcuts tags={tags} activeTag={tagFilter} onSelect={(tag) => setTagFilter((current) => current === tag ? '' : tag)} />}
        {tagFilter && <div className="filter-chip"><Tag size={14} /> #{tagFilter}<button aria-label="移除标签筛选" onClick={() => setTagFilter('')}><X size={13} /></button></div>}
        {view === 'online' ? <OnlineView items={online} loading={onlineLoading} error={onlineError} onRetry={loadOnline} onUse={useOnline} onSave={saveOnline} /> : view === 'sync' ? <SyncView onImport={() => openImport()} onImportFiles={openImport} onBackup={() => setBackupOpen(true)} /> : view === 'settings' ? <SettingsView settings={settings} onNotify={notify} /> : view === 'tags' ? <TagsView tags={tags} onSelect={(tag) => { setTagFilter(tag); setView('all'); }} /> : <>
          {visibleMemes.length ? <div className={`meme-grid ${settings.dense ? 'dense' : ''}`}>{visibleMemes.map((meme) => <MemeCard key={meme.id} meme={meme} active={meme.id === previewId} selecting={selecting} selected={selected.has(meme.id)} onPreview={() => setPreviewId(meme.id)} onManage={() => setManageId(meme.id)} onFavorite={() => updateMeme(meme.id, { favorite: !meme.favorite })} onUse={() => copyMeme(meme)} onTagSelect={(tag) => setTagFilter((current) => current === tag ? '' : tag)} onSelect={() => setSelected((old) => { const next = new Set(old); next.has(meme.id) ? next.delete(meme.id) : next.add(meme.id); return next; })} />)}</div> : <EmptyState search={search} view={view} onAdd={() => openImport()} onOnline={() => setView('online')} />}
          {selecting && selected.size > 0 && <div className="batch-bar glass"><span>已选择 <strong>{selected.size}</strong> 张</span><button className="danger-button" onClick={deleteSelected}><Trash2 size={16} /> 移除选中</button></div>}
        </>}
        </>}
      </main>
      {selectedMeme && !editMeme && <button className="detail-scrim" aria-label="关闭详情" onClick={() => setSelectedId(undefined)} />}
    </div>
    <BottomTabs active={primaryTab} onChange={(tab) => { setPrimaryTab(tab); setMobileNav(false); }} />
    {previewMeme && !manageMeme && !editMeme && <PreviewModal meme={previewMeme} quota={uploadQuota} onClose={() => setPreviewId(undefined)} onUse={() => copyMeme(previewMeme)} onManage={() => { setPreviewId(undefined); setManageId(previewMeme.id); }} onPublish={() => publishToCommunity(previewMeme)} />}
    {manageMeme && !editMeme && <ManageModal meme={manageMeme} onClose={() => setManageId(undefined)} onEdit={() => { setManageId(undefined); setEditId(manageMeme.id); }} onDelete={async () => { await deleteMemes([manageMeme.id]); setManageId(undefined); setSelected((current) => { const next = new Set(current); next.delete(manageMeme.id); return next; }); notify('表情已移除'); }} />}
    {editMeme && <EditModal meme={editMeme} collections={collections} onClose={() => setEditId(undefined)} onNotify={notify} onUse={() => copyMeme(editMeme)} />}
    {importOpen && <ImportModal collections={collections} initialFiles={pendingImportFiles} onClose={closeImport} onNotify={notify} />}
    {backupOpen && <BackupModal onClose={() => setBackupOpen(false)} onNotify={notify} />}
    {collectionOpen && <Modal title="新建收藏夹" onClose={() => setCollectionOpen(false)}><form className="edit-fields" onSubmit={(event) => { event.preventDefault(); void createCollection(); }}><label>收藏夹名称<input autoFocus value={collectionName} onChange={(event) => setCollectionName(event.target.value)} required maxLength={40} /></label><button type="submit" className="primary-button">创建收藏夹</button></form></Modal>}
    {toast && <div className="toast glass"><Check size={16} />{toast}</div>}
  </div>;
}

function BottomTabs({ active, onChange }: { active: PrimaryTab; onChange: (tab: PrimaryTab) => void }) {
  return <nav className="bottom-tabs glass" aria-label="主导航">
    <button className={active === 'library' ? 'active' : ''} onClick={() => onChange('library')}><Grid2X2 size={19} /><span>图片库</span></button>
    <button className={active === 'community' ? 'active' : ''} onClick={() => onChange('community')}><MessageCircle size={19} /><span>社区</span></button>
    <button className={active === 'profile' ? 'active' : ''} onClick={() => onChange('profile')}><UserRound size={19} /><span>我的</span></button>
  </nav>;
}

function CommunityView({ posts, quota, onLike, onOpenLibrary }: { posts: CommunityPost[]; quota?: UploadQuota; onLike: (postId: string) => void; onOpenLibrary: () => void }) {
  const remaining = quota?.remaining ?? 3;
  return <section className="community-view">
    <header className="community-head"><div><div className="eyebrow">LOCAL MOCK COMMUNITY</div><h1>社区 <span className="title-count">{posts.length}</span></h1><p>先用本地 Mock 走通浏览、点赞和发布入口；不会联网，也不会上传你的图片。</p></div><button className="primary-button" onClick={onOpenLibrary}><Plus size={17} /> 添加图片</button></header>
    <div className="community-note glass"><Sparkles size={18} /><span><strong>本地演示模式</strong> · 账号、帖子和每日发布额度都在当前设备模拟，后续可直接替换为真实 API。</span><em>今日还可发布 {remaining} / {quota?.limit ?? 3}</em></div>
    <div className="community-grid">{posts.map((post) => <CommunityCard key={post.id} post={post} onLike={() => onLike(post.id)} />)}</div>
  </section>;
}

function CommunityCard({ post, onLike }: { post: CommunityPost; onLike: () => void }) {
  return <article className="community-card glass"><header><span className="avatar">{post.author.avatar}</span><div><strong>{post.author.name}</strong><small>{post.author.handle} · {relativeTime(post.createdAt)}</small></div>{post.isLocalMock && <span className="mock-badge">本地 Mock</span>}</header><img src={post.imageUrl} alt={post.title} loading="lazy" /><div className="community-card-body"><strong>{post.title}</strong><p>{post.caption}</p>{post.tags.length > 0 && <div className="community-tags">{post.tags.slice(0, 4).map((tag) => <span key={tag}>#{tag}</span>)}</div>}<footer><button className={post.liked ? 'liked' : ''} onClick={onLike} aria-label={`${post.liked ? '取消喜欢' : '喜欢'} ${post.title}`}><Heart size={16} fill={post.liked ? 'currentColor' : 'none'} /> {post.likes}</button><span><MessageCircle size={15} /> 评论稍后接入</span></footer></div></article>;
}

function ProfileView({ profile, quota, onOpenSync, onOpenSettings }: { profile?: MockProfile; quota?: UploadQuota; onOpenSync: () => void; onOpenSettings: () => void }) {
  const user = profile ?? { name: '心语用户', handle: '@local_mock', avatar: '心', bio: '正在加载本地 Mock 账号…', following: 0, followers: 0, postCount: 0 };
  const remaining = quota?.remaining ?? 3;
  return <section className="profile-view"><div className="profile-card glass"><div className="profile-main"><span className="profile-avatar">{user.avatar}</span><div><div className="eyebrow">LOCAL MOCK ACCOUNT</div><h1>{user.name}</h1><span className="profile-handle">{user.handle}</span><p>{user.bio}</p></div></div><div className="profile-stats"><span><strong>{user.postCount}</strong> 发布</span><span><strong>{user.following}</strong> 关注</span><span><strong>{user.followers}</strong> 获赞</span></div></div><div className="quota-card glass"><div><span className="quota-icon"><Upload size={20} /></span><div><strong>本地模拟发布额度</strong><p>每日 {quota?.limit ?? 3} 张，发布只显示在当前设备的 Mock 社区。</p></div></div><b>{remaining} <small>/ {quota?.limit ?? 3}</small></b></div><div className="profile-actions"><button className="profile-action glass" onClick={onOpenSync}><Archive size={21} /><span><strong>备份与迁移</strong><small>用 .puff.zip 带走你的图片和信息</small></span><ChevronRight size={17} /></button><button className="profile-action glass" onClick={onOpenSettings}><Settings size={21} /><span><strong>偏好设置</strong><small>网格密度、动效和在线补充</small></span><ChevronRight size={17} /></button></div><p className="profile-footnote"><Info size={14} /> 这页暂不需要登录；切换为真实账号服务时，界面仍通过同一个数据层读取资料与额度。</p></section>;
}

function PreviewModal({ meme, quota, onClose, onUse, onManage, onPublish }: { meme: Meme; quota?: UploadQuota; onClose: () => void; onUse: () => void; onManage: () => void; onPublish: () => void }) {
  const url = useBlobUrl(meme.blob);
  const remaining = quota?.remaining ?? 3;
  return <Modal title={meme.title} subtitle="点击发送；长按图片或点“管理”才会修改它的信息。" onClose={onClose} wide><div className="preview-layout"><div className="preview-image"><img src={url} alt={meme.title} /></div><div className="preview-info"><div className="preview-meta"><span>{meme.mime.replace('image/', '').toUpperCase()}</span><span>{formatBytes(meme.size)}</span>{meme.tags.slice(0, 4).map((tag) => <span key={tag}>#{tag}</span>)}</div>{meme.note && <p>{meme.note}</p>}<div className="preview-actions"><button className="primary-button" onClick={onUse}><Send size={16} /> {isAndroid ? '分享图片' : '复制图片'}</button><button className="glass-button" onClick={onManage}><Pencil size={16} /> 管理</button><button className="glass-button" disabled={!remaining} onClick={onPublish}><Upload size={16} /> {remaining ? `发布到社区（${remaining} 次）` : '今日额度已用完'}</button></div><small>发布仅是本地 Mock：不会上传原图或创建真实账号。</small></div></div></Modal>;
}

function relativeTime(time: number) { const minutes = Math.max(1, Math.floor((Date.now() - time) / 60000)); return minutes < 60 ? `${minutes} 分钟前` : minutes < 1440 ? `${Math.floor(minutes / 60)} 小时前` : `${Math.floor(minutes / 1440)} 天前`; }

function NavButton({ icon, label, count, active, onClick }: { icon: React.ReactNode; label: string; count?: number; active: boolean; onClick: () => void }) { return <button className={`nav-button ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{label}</span>{count !== undefined && <em>{count}</em>}<ChevronRight className="nav-chevron" size={14} /></button>; }

function EmptyState({ search, view, onAdd, onOnline }: { search: string; view: View; onAdd: () => void; onOnline: () => void }) { return <div className="empty-state glass"><div className="empty-icon"><FileImage size={28} /></div><h2>{search ? `没有找到“${search}”` : view === 'favorites' ? '还没有喜欢的表情' : '这里还空着'}</h2><p>{search ? '换个关键词，或者给表情补充一些标签。' : '把你最常用的图片拖进来，建立自己的表达方式。'}</p><div><button className="primary-button" onClick={onAdd}><ImagePlus size={17} /> 导入表情</button><button className="glass-button" onClick={onOnline}><Sparkles size={16} /> 看在线补充</button></div></div>; }

function OnlineView({ items, loading, error, onRetry, onUse, onSave }: { items: OnlineMeme[]; loading: boolean; error: string; onRetry: () => void; onUse: (item: OnlineMeme) => void; onSave: (item: OnlineMeme) => void }) { return <div className="online-view"><div className="online-callout glass"><Sparkles size={18} /><span><strong>在线补充</strong> · 结果来自 Memegen，搜索只读取公开的模板清单；使用时才加载原图。</span><Cloud size={17} /></div>{loading ? <div className="inline-loading"><span className="spinner" />正在找适合你的表达…</div> : error ? <div className="error-state glass"><CloudOff size={22} /><strong>{error}</strong><button className="glass-button" onClick={onRetry}>重新连接</button></div> : items.length ? <div className="online-grid">{items.map((item) => <OnlineCard key={item.id} item={item} onUse={() => onUse(item)} onSave={() => onSave(item)} />)}</div> : <div className="empty-state glass"><div className="empty-icon"><Sparkles size={27} /></div><h2>换一个关键词试试</h2><p>例如：cat、happy、work，或直接输入中文。</p></div>}</div>; }
function OnlineCard({ item, onUse, onSave }: { item: OnlineMeme; onUse: () => void; onSave: () => void }) { return <article className="online-card glass"><div className="online-image"><img src={item.url} alt={item.title} loading="lazy" /></div><div className="online-card-footer"><span>{item.title}</span><div><button className="mini-action" title="直接分享" onClick={onUse}><Share2 size={15} /></button><button className="mini-action" title="保存到本地" onClick={onSave}><Download size={15} /></button></div></div></article>; }

function SyncView({ onImport, onImportFiles, onBackup }: { onImport: () => void; onImportFiles: (files: File[]) => void; onBackup: () => void }) { const [drag, setDrag] = useState(false); const onDrop = (event: React.DragEvent) => { event.preventDefault(); setDrag(false); const files = [...event.dataTransfer.files].filter((file) => file.type.startsWith('image/') || /\.(avif|svg)$/i.test(file.name)); if (files.length) onImportFiles(files); }; return <div className="sync-view"><div className={`drop-zone glass ${drag ? 'dragging' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}><div className="drop-icon"><Upload size={29} /></div><h2>把图片放到这里</h2><p>支持 PNG、JPG、GIF、WebP、AVIF 和 SVG，单张最大 32 MB</p><button className="primary-button" onClick={onImport}><ImagePlus size={17} /> 选择图片</button></div><div className="sync-cards"><button className="sync-card glass" onClick={onBackup}><div className="sync-card-icon"><Archive size={21} /></div><div><strong>完整备份</strong><span>原图、标签、备注、收藏夹一次带走</span></div><ChevronRight size={18} /></button><button className="sync-card glass" onClick={onBackup}><div className="sync-card-icon"><ArrowDownToLine size={21} /></div><div><strong>从备份恢复</strong><span>自动合并较新的修改，保留本机内容</span></div><ChevronRight size={18} /></button></div></div>; }

function TagsView({ tags, onSelect }: { tags: [string, number][]; onSelect: (tag: string) => void }) { return <div className="tags-view glass"><div className="tag-cloud">{tags.map(([tag, count]) => <button key={tag} className="tag-pill" onClick={() => onSelect(tag)}><Tag size={14} />#{tag}<em>{count}</em></button>)}</div>{!tags.length && <div className="empty-inline"><Tag size={22} />导入表情后，这里会出现你的标签。</div>}</div>; }

function TagShortcuts({ tags, activeTag, onSelect }: { tags: [string, number][]; activeTag: string; onSelect: (tag: string) => void }) {
  if (!tags.length) return null;
  return <div className="tag-shortcuts" aria-label="按标签筛选"><span><Tag size={14} />标签</span>{tags.slice(0, 12).map(([tag, count]) => <button key={tag} type="button" className={activeTag === tag ? 'active' : ''} onClick={() => onSelect(tag)}>#{tag}<em>{count}</em></button>)}</div>;
}

function AccessibilityRecommendationNotice({ onCancel, onContinue }: { onCancel: () => void; onContinue: () => void }) {
  const [unlocked, setUnlocked] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setUnlocked(true), 1000);
    return () => window.clearTimeout(timer);
  }, []);
  return <Modal title="开启输入关键词推荐" onClose={onCancel}>
    <div className="recommendation-notice">
      <div className="recommendation-notice-copy">
        <p>开启后，心语会通过 Android 无障碍服务<span className="privacy-emphasis">读取当前输入框文字</span>，并与你设置的表情 Tag / 关键词进行本地匹配。</p>
        <p>输入文字仅用于本地匹配，<span className="privacy-emphasis">不会保存</span>、<span className="privacy-emphasis">不会上传</span>、不会写入日志或<span className="privacy-emphasis">不会发送给 AI</span>。</p>
        <p>你可以随时在心语或 Android 系统设置中关闭此功能。</p>
      </div>
      <div className="recommendation-notice-actions">
        <button type="button" className="glass-button" onClick={onCancel}>算了</button>
        <button type="button" className="primary-button" disabled={!unlocked} onClick={onContinue}>{unlocked ? '我知道自己在做什么' : '我知道自己在做什么 (1)'}</button>
      </div>
    </div>
  </Modal>;
}

function SettingsView({ settings, onNotify }: { settings: PreferenceSettings; onNotify: (message: string) => void }) {
  const [floatingOpacity, setFloatingOpacity] = useState(0.82);
  const [recommendation, setRecommendation] = useState<{ granted: boolean; enabled: boolean; mode: 'exact' | 'contains' }>({ granted: false, enabled: false, mode: 'exact' });
  const [recommendationNoticeOpen, setRecommendationNoticeOpen] = useState(false);
  const [recommendationRequesting, setRecommendationRequesting] = useState(false);
  useEffect(() => {
    if (!isAndroid) return;
    let disposed = false;
    void getAndroidFloatingWindowStatus().then((status) => { if (!disposed) setFloatingOpacity(status.opacity); }).catch(() => undefined);
    return () => { disposed = true; };
  }, []);
  useEffect(() => {
    if (!isAndroid) return;
    let disposed = false;
    const refresh = () => { void getAndroidAccessibilityRecommendationStatus().then((status) => { if (!disposed) setRecommendation(status); }).catch(() => undefined); };
    refresh();
    const onVisibilityChange = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => { disposed = true; document.removeEventListener('visibilitychange', onVisibilityChange); };
  }, []);
  const set = async (key: Exclude<keyof PreferenceSettings, 'id'>, value: boolean) => {
    try {
      if (key === 'floatingWindow') {
        if (isDesktop) {
          const enabled = await setAlwaysOnTop(value);
          if (enabled !== value) throw new Error('窗口置顶状态没有生效');
        } else if (isAndroid) {
          if (value) {
            const permission = await requestAndroidFloatingWindowPermission(true);
            if (!permission.granted) { onNotify('未获得“显示在其他应用上层”权限，悬浮窗没有开启'); return; }
            if (permission.enabled) {
              await db.settings.put({ ...settings, [key]: value });
              onNotify('悬浮表情助手已开启：可拖动，点按展开迷你表情库');
              return;
            }
          }
          const status = await setAndroidFloatingWindow(value);
          if (status.enabled !== value) throw new Error(value ? '悬浮按钮没有显示，请检查系统悬浮窗权限' : '悬浮窗没有关闭');
          if (!value) setRecommendation(await setAndroidAccessibilityRecommendationEnabled(false));
        } else { onNotify('悬浮窗模式仅支持 Windows 和 Android 客户端'); return; }
      }
      await db.settings.put({ ...settings, [key]: value });
      onNotify(key === 'floatingWindow' ? value ? isAndroid ? '悬浮表情助手已开启：可拖动，点按展开迷你表情库' : '悬浮窗模式已开启，窗口会保持在最前' : '悬浮窗模式已关闭' : '偏好设置已更新');
    } catch (error) { onNotify(error instanceof Error ? error.message : '偏好设置更新失败'); }
  };
  const changeFloatingOpacity = (opacity: number) => {
    setFloatingOpacity(opacity);
    void setAndroidFloatingWindowOpacity(opacity).catch(() => onNotify('悬浮窗透明度保存失败'));
  };
  const beginRecommendationPermission = async () => {
    setRecommendationNoticeOpen(false);
    setRecommendationRequesting(true);
    try {
      const status = await requestAndroidAccessibilityRecommendationPermission(true);
      setRecommendation(status);
      if (status.enabled) onNotify('输入关键词自动推荐已开启；仅命中自己的标签时才会展开候选表情');
      else onNotify('已打开系统无障碍设置，请开启“心语输入表情推荐”；返回后会自动同步状态');
    } catch (error) { onNotify(error instanceof Error ? error.message : '无障碍权限设置失败'); }
    finally { setRecommendationRequesting(false); }
  };
  const cancelRecommendationPermission = () => {
    setRecommendationNoticeOpen(false);
    // The modal is shown only while the setting is off, but explicitly keep
    // native processing off if the user closes it during a state refresh.
    void setAndroidAccessibilityRecommendationEnabled(false).then(setRecommendation).catch(() => undefined);
  };
  const changeRecommendation = async (enabled: boolean) => {
    if (!isAndroid) return;
    try {
      if (!enabled) {
        setRecommendation(await setAndroidAccessibilityRecommendationEnabled(false));
        onNotify('输入关键词自动推荐已关闭');
        return;
      }
      if (!settings.floatingWindow) { onNotify('请先开启悬浮表情助手，推荐结果会显示在那里'); return; }
      setRecommendationNoticeOpen(true);
    } catch (error) { onNotify(error instanceof Error ? error.message : '无障碍权限设置失败'); }
  };
  const changeRecommendationMode = (mode: 'exact' | 'contains') => {
    void setAndroidAccessibilityRecommendationMode(mode).then(setRecommendation).catch(() => onNotify('匹配方式保存失败'));
  };
  return <div className="settings-view">
    <div className="settings-card glass">
      <div className="setting-title"><div className="setting-icon"><Zap size={18} /></div><div><h2>使用偏好</h2><p>让心语更贴近你的节奏。</p></div></div>
      <SettingToggle title="紧凑网格" description="每屏显示更多表情，适合大收藏库。" value={settings.dense} onChange={(value) => set('dense', value)} />
      <SettingToggle title="减少动态效果" description="关闭流光和弹性动画。" value={settings.reduceMotion} onChange={(value) => set('reduceMotion', value)} />
      <SettingToggle title="启用在线补充" description="在本地结果之后提供 Memegen 在线搜索入口。" value={settings.onlineSupplement} onChange={(value) => set('onlineSupplement', value)} />
      <SettingToggle title="悬浮表情助手" description={isDesktop ? '让心语窗口保持在其他窗口上方，聊天时取图更顺手。' : isAndroid ? '显示可拖动的悬浮球；点按后展开只用于快速找图和分享的迷你表情库。' : '仅 Windows 和 Android 客户端可用。'} value={settings.floatingWindow} disabled={!isDesktop && !isAndroid} onChange={(value) => set('floatingWindow', value)} />
      {isAndroid && <label className="floating-opacity"><span><strong>悬浮窗透明度</strong><small>拖动后立即应用；较低透明度可减少对其他应用的遮挡。</small></span><div><input type="range" min="0.3" max="1" step="0.05" value={floatingOpacity} aria-label="悬浮窗透明度" onChange={(event) => changeFloatingOpacity(Number(event.target.value))} /><output>{Math.round(floatingOpacity * 100)}%</output></div></label>}
      {isAndroid && <><SettingToggle title="输入关键词自动推荐表情" description={settings.floatingWindow ? '默认关闭。仅在命中你自己的标签时展开候选表情，不会自动发送。' : '需要先开启悬浮表情助手，推荐候选才有安全的显示位置。'} value={recommendation.enabled} disabled={!settings.floatingWindow || recommendationRequesting} onChange={changeRecommendation} /><label className="recommendation-mode"><span><strong>关键词匹配方式</strong><small>完全匹配只匹配整个输入；包含关键词可匹配“我真的无语了”这类输入。</small></span><select aria-label="关键词匹配方式" value={recommendation.mode} disabled={!settings.floatingWindow || recommendationRequesting} onChange={(event) => changeRecommendationMode(event.target.value as 'exact' | 'contains')}><option value="exact">完全匹配</option><option value="contains">包含关键词</option></select></label></>}
    </div>
    <div className="settings-card glass">
      <div className="setting-title"><div className="setting-icon"><RefreshCw size={18} /></div><div><h2>更新</h2><p>检查新版本，并查看功能变化。</p></div></div>
      <div className="update-row"><span><strong>当前版本</strong><small>v{CURRENT_VERSION}</small></span><button className="glass-button" onClick={() => onNotify(`已是最新版本 v${CURRENT_VERSION}`)}><RefreshCw size={15} /> 检查更新</button></div>
      <details className="changelog">
        <summary><span>更新日志</span><ChevronRight size={16} /></summary>
        <div className="changelog-list">
          <section className="changelog-entry"><strong>v0.5.5</strong><ul><li>修复 Android 输入关键词推荐打开无障碍设置时的回调报错：设置页不再依赖不稳定的 Activity 返回结果，回到心语后会读取实际授权状态并自动同步开关。</li><li>迷你表情库只保留搜索、常用和现有标签；自动推荐仍仅在命中你自己的标签时触发，不提供单独的推荐页。</li><li>超长图片文件名现在会自动换行；即使没有空格也不会横向溢出。</li></ul></section>
          <section className="changelog-entry"><strong>v0.5.4</strong><ul><li>修复 Android 迷你表情库与主图库不同步的问题：当前 IndexedDB 页面通过原生回调交付，服务重启后仍可用私有元数据与按页缩略图恢复。</li><li>迷你表情库精简为搜索、常用、标签和图片网格；展开面板保持清晰不透明，悬浮球透明度仍可单独调节。</li><li>输入关键词推荐改用心语风格的隐私说明；确认前有 1 秒防误触，并优先跳转到对应无障碍服务设置、返回后自动同步授权状态。</li></ul></section>
          <section className="changelog-entry"><strong>v0.5.3</strong><ul><li>Android 悬浮球升级为迷你表情库：可按最近、常用和现有标签筛选，按需加载缩略图并直接分享同一份本地原图。</li><li>新增可选的“输入关键词自动推荐表情”：无障碍输入仅在本机临时匹配自己的标签，支持完全匹配和包含关键词。</li><li>悬浮球支持边缘吸附、位置恢复和安全区域避让；悬浮权限或无障碍权限撤销后会安全停止。</li></ul></section>
          <section className="changelog-entry"><strong>v0.4.3</strong><ul><li>修复手机侧边导航中设置被底栏遮挡的问题，长列表可独立滚动。</li><li>Android 图片库与分享临时文件保持在应用私有范围，升级时会为旧应用专属目录补上媒体隔离标记。</li><li>补全 Android 悬浮窗的权限恢复、后台保持、位置记忆和透明度调节。</li><li>Windows 程序补齐图标、产品版本信息及文件签名。</li></ul></section>
          <section className="changelog-entry"><strong>v0.4.2</strong><ul><li>Android 备份改为先逐张写入外部持久目录，再由原生层流式生成 ZIP；压缩失败时原始备份仍会保留。</li><li>新增 Android 真正的系统悬浮窗：会先请求“显示在其他应用上层”权限，再显示可拖动入口。</li><li>修复手机侧栏过长时无法滑动的问题。</li><li>Android 发布包改为固定签名，后续版本可保持覆盖安装；构建缺少固定签名时不再生成临时 APK。</li></ul></section>
          <section className="changelog-entry"><strong>v0.4.1</strong><ul><li>完整备份导出会显示读取、打包和保存状态，并保留完成提示。</li><li>新增 Windows 悬浮窗模式，让窗口可保持在最前。</li><li>补全 v0.1.0 ～ v0.3.0 的历史更新记录。</li></ul></section>
          <section className="changelog-entry"><strong>v0.4.0</strong><ul><li>图片库顶栏固定，二级页面支持返回全部表情。</li><li>设置页加入本地更新检查和更新日志入口。</li><li>整理 Windows 与 Android 的 0.4.0 发布版本。</li></ul></section>
          <section className="changelog-entry"><strong>v0.3.0</strong><ul><li>添加图片支持自定义名称、分组和多个标签。</li><li>标签可从主页直接筛选，管理路径更短。</li></ul></section>
          <section className="changelog-entry"><strong>v0.2.0</strong><ul><li>图片库默认使用紧凑视图，并移除内置示例表情。</li><li>加入本地 Mock 社区、账号页和模拟发布额度。</li></ul></section>
          <section className="changelog-entry"><strong>v0.1.0</strong><ul><li>心语表情库首个离线版本：导入、预览、复制/分享和备份迁移可用。</li><li>提供 Windows 与 Android 双端基础体验。</li></ul></section>
        </div>
      </details>
    </div>
    <div className="settings-card glass"><div className="setting-title"><div className="setting-icon"><Info size={18} /></div><div><h2>关于心语表情库</h2><p>跨 Windows 与 Android 的私人表情库。</p></div></div><div className="about-row"><span>当前平台</span><strong>{platformName}</strong></div><div className="about-row"><span>数据位置</span><strong>本机 IndexedDB</strong></div><div className="about-row"><span>版本</span><strong>v{CURRENT_VERSION} · 离线优先</strong></div><p className="about-note">参考 OhMyMeme 的快捷调用与复制路径，参考 Rays 的标签、正则搜索和分享思路。原图和元数据不上传云端，在线图库仅在你主动打开时请求。</p></div>
    {recommendationNoticeOpen && <AccessibilityRecommendationNotice onCancel={cancelRecommendationPermission} onContinue={() => { void beginRecommendationPermission(); }} />}
  </div>;
}
function SettingToggle({ title, description, value, onChange, disabled = false }: { title: string; description: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) { return <label className={`setting-toggle ${disabled ? 'disabled' : ''}`}><span><strong>{title}</strong><small>{description}</small></span><input type="checkbox" checked={value} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /><i /></label>; }

function ManageModal({ meme, onClose, onEdit, onDelete }: { meme: Meme; onClose: () => void; onEdit: () => void; onDelete: () => void | Promise<void> }) {
  const url = useBlobUrl(meme.blob);
  return <Modal title="管理表情" subtitle="长按图片会打开这里；删除已放到一级操作。" onClose={onClose}><div className="manage-modal"><div className="manage-meme"><img src={url} alt={meme.title} /><div><strong>{meme.title}</strong><span>{meme.tags.length ? meme.tags.slice(0, 3).map((tag) => `#${tag}`).join(' · ') : '未添加标签'}</span></div></div><div className="manage-actions"><button className="manage-action" onClick={onEdit}><span className="manage-action-icon"><Pencil size={18} /></span><span><strong>编辑名称、分组和标签</strong><small>修改这张图片的归类和说明</small></span><ChevronRight size={17} /></button><button className="manage-action danger" onClick={() => { void onDelete(); }}><span className="manage-action-icon"><Trash2 size={18} /></span><span><strong>删除图片</strong><small>从当前设备的图片库移除</small></span></button></div></div></Modal>;
}

function EditModal({ meme, collections, onClose, onNotify, onUse }: { meme: Meme; collections: Collection[]; onClose: () => void; onNotify: (message: string) => void; onUse: () => void }) { const [title, setTitle] = useState(meme.title); const [note, setNote] = useState(meme.note); const [tags, setTags] = useState(meme.tags.join('，')); const [collectionId, setCollectionId] = useState(meme.collectionId); const url = useBlobUrl(meme.blob); const save = async () => { await updateMeme(meme.id, { title: title.trim() || '未命名表情', note, tags: normalizeTags(tags.split(/[，,\s]+/)), collectionId }); onNotify('表情信息已保存'); onClose(); }; return <Modal title="编辑表情" subtitle="给它一个更容易被找到的语气。" onClose={onClose}><div className="edit-layout"><div className="edit-preview"><img src={url} alt={meme.title} /></div><div className="edit-fields"><label>标题<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} /></label><label>标签<input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="例如：开心 反应 朋友" /></label><label>收藏夹<select value={collectionId} onChange={(e) => setCollectionId(e.target.value)}><option value="">未分类</option>{collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>备注<textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} maxLength={10000} placeholder="记录这张图最适合什么时候发…" /></label><div className="edit-actions"><span /><button className="glass-button" onClick={onUse}><Copy size={15} /> {isAndroid ? '分享' : '复制'}</button><button className="primary-button" onClick={save}><Check size={16} /> 保存</button></div></div></div></Modal>; }

function ImportModal({ collections, initialFiles, onClose, onNotify }: { collections: Collection[]; initialFiles: File[]; onClose: () => void; onNotify: (message: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>(initialFiles);
  const [title, setTitle] = useState('');
  const [groupName, setGroupName] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [busy, setBusy] = useState(false);
  const addTag = () => { const next = normalizeTags([...tags, tagInput]); setTags(next); setTagInput(''); };
  const choose = (nextFiles: FileList | File[]) => { const next = [...nextFiles]; if (next.length) setFiles(next); };
  const openPicker = () => { const picker = input.current as (HTMLInputElement & { showPicker?: () => void }) | null; if (!picker) return; picker.value = ''; try { if (picker.showPicker) { picker.showPicker(); return; } } catch { /* WebView and older browsers fall back to click. */ } picker.click(); };
  const submit = async (event: React.FormEvent) => { event.preventDefault(); if (!files.length) { openPicker(); return; } setBusy(true); try { const finalTags = normalizeTags([...tags, tagInput]); const collection = await getOrCreateCollection(groupName); const result = await importImages(files, { collectionId: collection?.id, title, tags: finalTags }); const detail = result.errors.length ? `；${result.errors.slice(0, 2).join('；')}` : ''; onNotify(`已入库 ${result.added} 张，跳过 ${result.skipped} 张${detail}`); onClose(); } catch (error) { onNotify(error instanceof Error ? error.message : '导入失败'); } finally { setBusy(false); } };
  return <Modal title="添加图片" subtitle="名称、分组和标签都可不填；点击添加后会立即入库。" onClose={busy ? () => undefined : onClose}><form className="import-modal" onSubmit={(event) => { void submit(event); }}><input ref={input} className="native-file-picker" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml" multiple tabIndex={-1} aria-hidden="true" onChange={(event) => choose(event.target.files ?? [])} /><button type="button" className="import-picker" onClick={openPicker} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); choose(event.dataTransfer.files); }}><ImagePlus size={30} /><strong>{files.length ? `已选择 ${files.length} 张图片` : '点击选择，或把图片拖进来'}</strong><span>{files.length > 1 && title.trim() ? '批量导入时会在自定义名称后追加序号' : '支持批量导入，内容相同的图片会自动去重'}</span></button><label>自定义名称（可选）<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder={files.length > 1 ? '例如：猫猫反应（会自动加序号）' : '不填则使用图片文件名'} /></label><label>分组（可选，可直接新建）<input list="collection-options" value={groupName} onChange={(event) => setGroupName(event.target.value)} maxLength={40} placeholder="例如：日常、游戏、工作" /><datalist id="collection-options">{collections.map((collection) => <option key={collection.id} value={collection.name} />)}</datalist></label><label>标签（可选）<div className="tag-editor">{tags.map((tag) => <span key={tag}>#{tag}<button type="button" aria-label={`移除标签 ${tag}`} onClick={() => setTags((current) => current.filter((item) => item !== tag))}><X size={12} /></button></span>)}<input value={tagInput} onChange={(event) => setTagInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTag(); } }} placeholder={tags.length ? '继续输入标签' : '输入后按回车添加一个标签'} /></div><small>按回车添加一个标签；不填也可以直接入库。</small></label><div className="import-actions"><button type="button" className="glass-button" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={busy}>{busy ? '正在入库…' : files.length ? `添加 ${files.length} 张` : '选择图片'}</button></div></form></Modal>;
}

type BackupStatus = ExportProgress | AndroidBackupProgress
  | { phase: 'saving' | 'complete'; fileName: string; location?: string }
  | { phase: 'raw-only'; location: string; error: string }
  | { phase: 'copy-failed'; location: string; error: string };

function BackupProgressPanel({ status }: { status: BackupStatus }) {
  const copying = status.phase === 'collecting' || status.phase === 'copying';
  const compressing = status.phase === 'packing' || status.phase === 'compressing';
  const indeterminate = compressing || status.phase === 'saving' || status.phase === 'selecting' || status.phase === 'raw-complete';
  const percentage = copying && status.total ? Math.round((status.bytesCompleted / Math.max(status.totalBytes, 1)) * 100) : status.phase === 'complete' || status.phase === 'raw-only' ? 100 : 0;
  let label = '导出完成';
  let detail = '';
  let state = '已完成';
  if (status.phase === 'selecting') { label = '请选择外部备份文件夹'; detail = 'Android 会先写入原始备份；压缩失败也不会丢失已完成的原始备份。'; state = '等待选择'; }
  else if (status.phase === 'collecting') { label = `正在读取图片 ${status.completed} / ${status.total}`; detail = `${formatBytes(status.bytesCompleted)} / ${formatBytes(status.totalBytes)}`; state = `${percentage}%`; }
  else if (status.phase === 'copying') { label = `正在复制原始备份 ${status.completed} / ${status.total}`; detail = `${formatBytes(status.bytesCompleted)} / ${formatBytes(status.totalBytes)} · 位置：${status.location}`; state = `${percentage}%`; }
  else if (status.phase === 'raw-complete') { label = '原始备份已完成'; detail = `位置：${status.location}。现在开始在 Android 原生层生成 ZIP。`; state = '安全完成'; }
  else if (status.phase === 'packing') { label = '正在生成 ZIP 备份'; detail = '正在把原图和信息写入备份包'; state = '正在打包'; }
  else if (status.phase === 'compressing') { label = `正在生成 ZIP ${status.completed} / ${status.total}`; detail = `${formatBytes(status.bytesCompleted)} / ${formatBytes(status.totalBytes)} · 原始备份：${status.location}`; state = status.total ? `${Math.round((status.bytesCompleted / Math.max(status.totalBytes, 1)) * 100)}%` : '正在压缩'; }
  else if (status.phase === 'saving') { label = '正在保存备份文件'; detail = '正在写入你选择的位置'; state = '正在保存'; }
  else if (status.phase === 'raw-only') { label = '原始备份成功，仅压缩失败'; detail = `备份位置：${status.location}。其中包含 manifest.json 和 images，可在文件管理器压缩为 ZIP 后恢复。${status.error}`; state = '请保留原始备份'; }
  else if (status.phase === 'copy-failed') { label = '原始备份未完成'; detail = `已保留已写入的文件：${status.location}。${status.error}`; state = '导出失败'; }
  else { detail = `${status.fileName} 已完成${status.location ? ` · 位置：${status.location}` : ''}`; }
  return <div className={`backup-progress ${status.phase}`} role="status" aria-live="polite"><div><span>{label}</span><strong>{state}</strong></div><div className="backup-progress-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} aria-valuetext={detail}><i className={`backup-progress-fill ${indeterminate ? 'indeterminate' : ''}`} style={indeterminate ? undefined : { width: `${percentage}%` }} /></div><small>{detail}</small></div>;
}

function BackupModal({ onClose, onNotify }: { onClose: () => void; onNotify: (message: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [deletions, setDeletions] = useState(true);
  const [restoreSettings, setRestoreSettings] = useState(false);
  const [exportStatus, setExportStatus] = useState<BackupStatus>();
  const create = async () => {
    const fileName = `xinyu-backup-${new Date().toISOString().slice(0, 10)}.puff.zip`;
    setBusy(true);
    try {
      if (isAndroid) {
        const result = await exportAndroidBackup(setExportStatus);
        if (result.kind === 'cancelled') { setExportStatus(undefined); onNotify('已取消选择，备份未开始'); return; }
        if (result.kind === 'raw-only') {
          setExportStatus({ phase: 'raw-only', location: result.rawLocation, error: result.compressionError });
          onNotify('原始备份成功，仅压缩失败；请保留原始备份文件夹');
          return;
        }
        setExportStatus({ phase: 'complete', fileName: result.zipName, location: result.zipLocation });
        onNotify('完整备份已导出，原始备份和 ZIP 都已保留');
        return;
      }
      setExportStatus({ phase: 'collecting', completed: 0, total: 0, bytesCompleted: 0, totalBytes: 0 });
      const blob = await exportLibrary(undefined, setExportStatus);
      setExportStatus({ phase: 'saving', fileName });
      const saved = await saveBlob(blob, fileName);
      if (!saved) { setExportStatus(undefined); onNotify('已取消导出，备份未保存'); return; }
      setExportStatus({ phase: 'complete', fileName });
      onNotify('完整备份已导出');
    } catch (error) {
      if (error instanceof AndroidBackupCopyError) {
        setExportStatus({ phase: 'copy-failed', location: error.location, error: error.message });
        onNotify('原始备份未完成，已保留已写入文件');
      } else {
        setExportStatus(undefined);
        onNotify(error instanceof Error ? error.message : '备份失败');
      }
    }
    finally { setBusy(false); }
  };
  const restore = async (file: File) => {
    setBusy(true);
    setExportStatus(undefined);
    try {
      const backup = await readBackup(file);
      const result = await mergeBackup(backup, deletions, restoreSettings);
      onNotify(`恢复完成：新增 ${result.added}，更新 ${result.updated}，跳过 ${result.skipped}`);
      onClose();
    } catch (error) { onNotify(error instanceof Error ? error.message : '恢复失败，未修改本地库'); }
    finally { setBusy(false); }
  };
  const exportButtonText = busy ? exportStatus?.phase === 'selecting' ? '选择位置…' : exportStatus?.phase === 'collecting' || exportStatus?.phase === 'copying' ? '正在复制…' : exportStatus?.phase === 'packing' || exportStatus?.phase === 'compressing' ? '正在压缩…' : '正在保存…' : exportStatus?.phase === 'complete' || exportStatus?.phase === 'raw-only' ? '再次导出' : '导出';
  return <Modal title="导入与同步" subtitle={isAndroid ? 'Android 会先把原图和清单逐张写入你选择的外部文件夹，再生成 ZIP；ZIP 失败也会保留原始备份。' : '心语表情库备份（.puff.zip）是跨 Windows 和 Android 的完整离线备份格式。'} onClose={busy ? () => undefined : onClose}><div className="backup-modal"><div className="backup-option primary-option"><div className="backup-icon"><ArrowUpFromLine size={20} /></div><div><strong>导出完整备份</strong><span>{isAndroid ? '先生成可保留的原始备份，再由原生层流式压缩为 ZIP。' : '原图和所有标签、备注、收藏夹都会写进一个 ZIP。'}</span></div><button className="primary-button" disabled={busy} onClick={create}><Download size={15} /> {exportButtonText}</button></div>{exportStatus && <BackupProgressPanel status={exportStatus} />}<div className="backup-option"><div className="backup-icon"><ArrowDownToLine size={20} /></div><div><strong>从备份恢复</strong><span>先完整校验，再合并到当前库，不会覆盖较新的本地修改。</span></div><button className="glass-button" disabled={busy} onClick={() => input.current?.click()}><Upload size={15} /> 选择 ZIP</button><input ref={input} hidden type="file" accept=".zip,.puff.zip,application/zip" onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} /></div><div className="backup-settings"><SettingToggle title="同步删除记录" description="把备份中明确删除的表情也从本机移除。" value={deletions} onChange={setDeletions} /><SettingToggle title="恢复偏好设置" description="同时恢复紧凑网格、动效、在线补充和悬浮窗开关。" value={restoreSettings} onChange={setRestoreSettings} /></div><p className="backup-footnote"><Info size={14} /> ZIP 经过路径、大小、图片格式和 SHA-256 校验；不接受未知文件或超大压缩包。</p></div></Modal>;
}

export default App;
