from pathlib import Path


def replace(path: str, old: str, new: str, count: int = 1):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'missing expected text in {path}: {old[:100]!r}')
    text = text.replace(old, new, count)
    p.write_text(text, encoding='utf-8')


def write(path: str, content: str):
    Path(path).write_text(content, encoding='utf-8')

# ---------------------------------------------------------------------------
# Version: 0.7.0 -> 0.7.1, Android 18 -> 19
# ---------------------------------------------------------------------------
replace('package.json', '"version": "0.7.0"', '"version": "0.7.1"')
replace('package-lock.json', '"version": "0.7.0"', '"version": "0.7.1"', 2)
replace('android/app/build.gradle', 'versionCode 18\n        versionName "0.7.0"', 'versionCode 19\n        versionName "0.7.1"')

# ---------------------------------------------------------------------------
# Visual cropper: larger touch zones + zero-reencode enlarged crop preview.
# ---------------------------------------------------------------------------
write('src/components/VisualCropper.tsx', r'''import { useRef } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import {
  adjustVisualCrop,
  sourceCropToVisual,
  visualCropToSource,
  visualDimensions,
  type CropRect,
  type VisualCropAction,
} from '../lib/image-edit';

type Interaction = {
  pointerId: number;
  action: VisualCropAction;
  startX: number;
  startY: number;
  crop: CropRect;
};

const handles: VisualCropAction[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export default function VisualCropper({ imageUrl, alt, crop, sourceWidth, sourceHeight, rotation, flipHorizontal, onChange }: {
  imageUrl: string;
  alt: string;
  crop: CropRect;
  sourceWidth: number;
  sourceHeight: number;
  rotation: number;
  flipHorizontal: boolean;
  onChange: (crop: CropRect) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const interaction = useRef<Interaction | null>(null);
  const dimensions = visualDimensions(sourceWidth, sourceHeight, rotation);
  const visualCrop = sourceCropToVisual(crop, sourceWidth, sourceHeight, rotation, flipHorizontal);
  const minimumSize = Math.max(12, Math.min(dimensions.width, dimensions.height) * 0.025);
  const portraitMaxWidth = dimensions.height > dimensions.width
    ? Math.max(170, Math.round(420 * dimensions.width / dimensions.height))
    : undefined;

  const point = (event: ReactPointerEvent) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return { x: 0, y: 0 };
    return {
      x: ((event.clientX - rect.left) / rect.width) * dimensions.width,
      y: ((event.clientY - rect.top) / rect.height) * dimensions.height,
    };
  };

  const begin = (action: VisualCropAction, event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const current = point(event);
    interaction.current = { pointerId: event.pointerId, action, startX: current.x, startY: current.y, crop: visualCrop };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = interaction.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    const current = point(event);
    const nextVisual = adjustVisualCrop(active.crop, active.action, current.x - active.startX, current.y - active.startY, dimensions.width, dimensions.height, minimumSize);
    onChange(visualCropToSource(nextVisual, sourceWidth, sourceHeight, rotation, flipHorizontal));
  };

  const end = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (interaction.current?.pointerId === event.pointerId) interaction.current = null;
  };

  const style = {
    '--crop-left': `${(visualCrop.x / dimensions.width) * 100}%`,
    '--crop-top': `${(visualCrop.y / dimensions.height) * 100}%`,
    '--crop-width': `${(visualCrop.width / dimensions.width) * 100}%`,
    '--crop-height': `${(visualCrop.height / dimensions.height) * 100}%`,
    aspectRatio: `${dimensions.width} / ${dimensions.height}`,
    maxWidth: portraitMaxWidth ? `${portraitMaxWidth}px` : '100%',
  } as CSSProperties;

  const cropped = visualCrop.x > 0.5 || visualCrop.y > 0.5
    || visualCrop.x + visualCrop.width < dimensions.width - 0.5
    || visualCrop.y + visualCrop.height < dimensions.height - 0.5;
  const focusPortraitMaxWidth = visualCrop.height > visualCrop.width
    ? Math.max(150, Math.round(300 * visualCrop.width / visualCrop.height))
    : undefined;
  const focusStyle = {
    '--focus-image-width': `${(dimensions.width / visualCrop.width) * 100}%`,
    '--focus-image-height': `${(dimensions.height / visualCrop.height) * 100}%`,
    '--focus-image-left': `${-(visualCrop.x / visualCrop.width) * 100}%`,
    '--focus-image-top': `${-(visualCrop.y / visualCrop.height) * 100}%`,
    aspectRatio: `${visualCrop.width} / ${visualCrop.height}`,
    maxWidth: focusPortraitMaxWidth ? `${focusPortraitMaxWidth}px` : '100%',
  } as CSSProperties;

  return <div className="visual-cropper-shell">
    <div ref={stageRef} className="visual-cropper-stage" style={style} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      <img src={imageUrl} alt={alt} draggable={false} />
      <div className="visual-crop-selection" onPointerDown={(event) => begin('move', event)}>
        <i className="crop-grid-line crop-grid-v one" /><i className="crop-grid-line crop-grid-v two" />
        <i className="crop-grid-line crop-grid-h one" /><i className="crop-grid-line crop-grid-h two" />
        {handles.map((handle) => <span key={handle} className={`crop-handle crop-handle-${handle}`} data-handle={handle} onPointerDown={(event) => begin(handle, event)} />)}
      </div>
    </div>
    <small className="visual-crop-hint">拖动框内移动 · 拖四边或四角裁切</small>
    {cropped && <div className="visual-crop-focus-block">
      <div className="visual-crop-focus-head"><strong>裁切预览</strong><span>自动放大选定范围，保存结果以这里为准</span></div>
      <div className="visual-crop-focus" style={focusStyle}>
        <img src={imageUrl} alt={`${alt} 裁切预览`} draggable={false} />
      </div>
    </div>}
  </div>;
}
''')

# ---------------------------------------------------------------------------
# Cropper CSS: larger corner targets and a cheap enlarged selected-area preview.
# ---------------------------------------------------------------------------
style_path = Path('src/styles.css')
style = style_path.read_text(encoding='utf-8')
style = style.replace(
    '.crop-handle { position: absolute; width: 40px; height: 40px; touch-action: none; z-index: 3; }\n.crop-handle::after { content: \'\'; position: absolute; width: 11px; height: 11px; border-radius: 4px; background: #f8fff9; box-shadow: 0 1px 4px rgba(19,48,31,.34); }',
    '.crop-handle { position: absolute; width: 48px; height: 48px; touch-action: none; z-index: 4; }\n.crop-handle::after { content: \'\'; position: absolute; width: 15px; height: 15px; border: 2px solid rgba(57,103,72,.45); border-radius: 5px; background: #f8fff9; box-shadow: 0 2px 6px rgba(19,48,31,.36); }\n.crop-handle-nw, .crop-handle-ne, .crop-handle-se, .crop-handle-sw { z-index: 6; }',
    1,
)
style = style.replace(
    '  .crop-handle { width: 44px; height: 44px; }\n  .crop-handle::after { width: 12px; height: 12px; }',
    '  .crop-handle { width: 56px; height: 56px; }\n  .crop-handle::after { width: 17px; height: 17px; }',
    1,
)
needle = '.crop-instruction { color: #728a7c; font-size: 11px; line-height: 1.55; }\n'
if needle not in style:
    raise SystemExit('missing crop instruction CSS anchor')
style = style.replace(needle, needle + r'''.visual-crop-focus-block { display: grid; gap: 7px; margin-top: 4px; padding-top: 9px; border-top: 1px solid rgba(82,126,96,.14); }
.visual-crop-focus-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; color: #668071; }
.visual-crop-focus-head strong { font-size: 11px; }
.visual-crop-focus-head span { color: #91a399; font-size: 9px; text-align: right; }
.visual-crop-focus { position: relative; width: 100%; max-height: 260px; margin: 0 auto; overflow: hidden; border: 1px solid rgba(99,145,111,.2); border-radius: 11px; background: #1f2823; }
.visual-crop-focus > img { position: absolute; left: var(--focus-image-left); top: var(--focus-image-top); width: var(--focus-image-width); height: var(--focus-image-height); max-width: none; max-height: none; object-fit: fill; pointer-events: none; user-select: none; -webkit-user-drag: none; }
''', 1)
style = style.replace(
    '.image-save-actions { justify-content: flex-end; padding-top: 1px; }',
    '.image-save-actions { align-items: center; justify-content: flex-end; padding-top: 1px; }\n.image-save-progress { display: inline-flex; align-items: center; gap: 7px; margin-right: auto; color: #6f8879; font-size: 10px; }\n.image-save-progress .spinner { width: 14px; height: 14px; flex: none; }',
    1,
)
style_path.write_text(style, encoding='utf-8')

# ---------------------------------------------------------------------------
# Image save path: the edited output dimensions are already known. Avoid a
# second full-image decode before hashing/writing the PNG.
# ---------------------------------------------------------------------------
replace('src/lib/library.ts',
'''export async function prepareImage(file: Blob, title: string, collectionId = '', source = '本地导入'): Promise<Meme> {
  if (file.size > MAX_IMAGE_SIZE || !file.size) throw new Error('单张图片必须在 0～32 MB 之间');
  const mime = detectMime(new Uint8Array(await file.slice(0, 256).arrayBuffer()));
  const blob = new Blob([file], { type: mime });
  const [id, dimensions] = await Promise.all([sha256(blob), imageDimensions(blob)]);''',
'''export type KnownImageDimensions = { width: number; height: number };
function validatedKnownDimensions(dimensions: KnownImageDimensions) {
  const width = Math.max(1, Math.round(dimensions.width));
  const height = Math.max(1, Math.round(dimensions.height));
  if (width * height > 40_000_000) throw new Error('图片尺寸过大，最多支持 4000 万像素');
  return { width, height };
}
export async function prepareImage(file: Blob, title: string, collectionId = '', source = '本地导入', knownDimensions?: KnownImageDimensions): Promise<Meme> {
  if (file.size > MAX_IMAGE_SIZE || !file.size) throw new Error('单张图片必须在 0～32 MB 之间');
  const mime = detectMime(new Uint8Array(await file.slice(0, 256).arrayBuffer()));
  const blob = new Blob([file], { type: mime });
  const dimensionsPromise = knownDimensions ? Promise.resolve(validatedKnownDimensions(knownDimensions)) : imageDimensions(blob);
  const [id, dimensions] = await Promise.all([sha256(blob), dimensionsPromise]);''')
replace('src/lib/library.ts',
'''export async function saveEditedMeme(id: string, editedImage: Blob, mode: ImageEditSaveMode): Promise<ImageEditSaveResult> {
  const original = await db.memes.get(id);''',
'''export async function saveEditedMeme(id: string, editedImage: Blob, mode: ImageEditSaveMode, knownDimensions?: KnownImageDimensions): Promise<ImageEditSaveResult> {
  const original = await db.memes.get(id);''')
replace('src/lib/library.ts',
'''    original.collectionId,
    original.source,
  );''',
'''    original.collectionId,
    original.source,
    knownDimensions,
  );''')

# ---------------------------------------------------------------------------
# Android floating-share path: use a fresh native ACTION_SEND intent every time
# instead of keeping the Capacitor Share plugin presentation state in the loop.
# ---------------------------------------------------------------------------
replace('src/lib/platform.ts',
'''  deliverMiniSnapshot(options: { requestId: string; snapshot: FloatingMiniSnapshot | { ready: false } }): Promise<void>;
}''',
'''  deliverMiniSnapshot(options: { requestId: string; snapshot: FloatingMiniSnapshot | { ready: false } }): Promise<void>;
  sharePreparedFile(options: { path: string; mime: string; title: string; dialogTitle: string }): Promise<void>;
}''')
platform_path = Path('src/lib/platform.ts')
platform = platform_path.read_text(encoding='utf-8')
anchor = '''export async function deliverAndroidFloatingMiniSnapshot(requestId: string, snapshot: FloatingMiniSnapshot | { ready: false }): Promise<void> {
  if (!isAndroid) return;
  await FloatingWindow.deliverMiniSnapshot({ requestId, snapshot });
}
'''
if anchor not in platform:
    raise SystemExit('missing platform snapshot anchor')
platform = platform.replace(anchor, anchor + r'''
/** Stateless native share used by the system overlay; safe to call repeatedly. */
export async function shareAndroidFloatingMeme(meme: Pick<Meme, 'blob' | 'mime' | 'title'>): Promise<boolean> {
  if (!isAndroid) return false;
  const shareBlob = meme.mime === 'image/svg+xml' ? await pngBlob(meme.blob) : meme.blob;
  const suffix = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const path = `xinyu-share/floating-${suffix}.${extension(shareBlob.type || meme.mime)}`;
  await Filesystem.writeFile({ path, data: await base64(shareBlob), directory: Directory.Data, recursive: true });
  await FloatingWindow.sharePreparedFile({ path, mime: shareBlob.type || meme.mime, title: meme.title, dialogTitle: '发送这个表情' });
  return true;
}
''', 1)
platform_path.write_text(platform, encoding='utf-8')
replace('src/lib/floating-mini.ts',
'''      const { useImage } = await import('./platform');
      await useImage(meme, true);
      await markUsed(id);''',
'''      const { shareAndroidFloatingMeme } = await import('./platform');
      if (!await shareAndroidFloatingMeme(meme)) return false;
      await markUsed(id);''')

plugin_path = Path('android/app/src/main/java/com/puff/meme/FloatingWindowPlugin.java')
plugin = plugin_path.read_text(encoding='utf-8')
plugin = plugin.replace('import android.content.Intent;\n', 'import android.app.Activity;\nimport android.content.ClipData;\nimport android.content.Intent;\n', 1)
plugin = plugin.replace('import androidx.activity.result.ActivityResult;\n', 'import androidx.activity.result.ActivityResult;\nimport androidx.core.content.FileProvider;\n', 1)
plugin = plugin.replace('import java.util.List;\n', 'import java.io.File;\nimport java.util.List;\n', 1)
method_anchor = '''    @PluginMethod
    public void setOpacity(PluginCall call) {
        double requested = call.getDouble("opacity", 0.82d);
        FloatingWindowService.setOpacity(getContext(), (float) requested);
        call.resolve(status());
    }
'''
if method_anchor not in plugin:
    raise SystemExit('missing FloatingWindowPlugin method anchor')
plugin = plugin.replace(method_anchor, method_anchor + r'''

    /**
     * Shares one app-private prepared image through a fresh Android chooser.
     * This path is intentionally stateless so closing one chooser cannot leave
     * the floating mini library unable to share the next image.
     */
    @PluginMethod
    public void sharePreparedFile(PluginCall call) {
        String relativePath = call.getString("path", "").trim();
        String mime = call.getString("mime", "image/*").trim();
        String title = call.getString("title", "").trim();
        String dialogTitle = call.getString("dialogTitle", "发送这个表情");
        try {
            File filesRoot = getContext().getFilesDir().getCanonicalFile();
            File shareRoot = new File(filesRoot, "xinyu-share").getCanonicalFile();
            File target = new File(filesRoot, relativePath).getCanonicalFile();
            String sharePrefix = shareRoot.getPath() + File.separator;
            if (!target.getPath().startsWith(sharePrefix) || !target.isFile()) {
                call.reject("分享文件不存在或路径无效");
                return;
            }
            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                target
            );
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime.isEmpty() ? "image/*" : mime);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            if (!title.isEmpty()) send.putExtra(Intent.EXTRA_TITLE, title);
            send.setClipData(ClipData.newRawUri("xinyu-meme", uri));
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, dialogTitle);
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Activity activity = getActivity();
            if (activity != null && !activity.isFinishing()) activity.startActivity(chooser);
            else {
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(chooser);
            }
            call.resolve();
        } catch (Exception error) {
            call.reject("无法打开系统分享：" + (error.getMessage() == null ? "未知错误" : error.getMessage()), error);
        }
    }
''', 1)
plugin_path.write_text(plugin, encoding='utf-8')

# ---------------------------------------------------------------------------
# App polish: visible save state, known dimensions, version/changelog.
# ---------------------------------------------------------------------------
replace('src/App.tsx', "const CURRENT_VERSION = '0.7.0';", "const CURRENT_VERSION = '0.7.1';")
app_path = Path('src/App.tsx')
app = app_path.read_text(encoding='utf-8')
changelog_anchor = '          <section className="changelog-entry"><strong>v0.7.0</strong>'
if changelog_anchor not in app:
    raise SystemExit('missing changelog anchor')
app = app.replace(changelog_anchor,
'''          <section className="changelog-entry"><strong>v0.7.1</strong><ul><li>修复 Android 迷你表情库分享一次后再次点击无响应的问题，悬浮发送改用独立的原生系统分享 Intent。</li><li>图片裁切增大四角触控热区，并在缩小裁切范围后实时显示放大的裁切预览；覆盖保存减少一次重复整图解码并立即显示保存状态。</li></ul></section>\n''' + changelog_anchor,
1)
app = app.replace(
'''    setEditing(true);
    try {''',
'''    setEditing(true);
    setReplaceConfirmOpen(false);
    // Give the WebView one frame to paint the busy state before PNG encoding.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    try {''',
1)
app = app.replace(
'const result = await saveEditedMeme(meme.id, image, mode);',
'const result = await saveEditedMeme(meme.id, image, mode, output);',
1)
app = app.replace(
'''        {editable && <div className="image-save-actions"><button className="glass-button" disabled={editing} onClick={() => { void saveEdited('copy'); }}>另存为</button><button className="primary-button" disabled={editing} onClick={requestReplace}>{editing ? '正在保存…' : '覆盖原图'}</button></div>}''',
'''        {editable && <div className="image-save-actions">{editing && <span className="image-save-progress"><i className="spinner" />正在生成并保存…</span>}<button className="glass-button" disabled={editing} onClick={() => { void saveEdited('copy'); }}>另存为</button><button className="primary-button" disabled={editing} onClick={requestReplace}>{editing ? '正在保存…' : '覆盖原图'}</button></div>}''',
1)
app_path.write_text(app, encoding='utf-8')

# ---------------------------------------------------------------------------
# Tests: separate minimum dimensions remain supported by the pure crop helper,
# and the previous coordinate transforms continue to round-trip.
# ---------------------------------------------------------------------------
image_edit_path = Path('src/lib/image-edit.ts')
image_edit = image_edit_path.read_text(encoding='utf-8')
image_edit = image_edit.replace(
'''  minimumSize = 1,
): CropRect {
  const safe = clampCrop(crop, boundsWidth, boundsHeight);
  const minWidth = Math.max(1, Math.min(boundsWidth, minimumSize));
  const minHeight = Math.max(1, Math.min(boundsHeight, minimumSize));''',
'''  minimumSize: number | { width: number; height: number } = 1,
): CropRect {
  const safe = clampCrop(crop, boundsWidth, boundsHeight);
  const requestedMinWidth = typeof minimumSize === 'number' ? minimumSize : minimumSize.width;
  const requestedMinHeight = typeof minimumSize === 'number' ? minimumSize : minimumSize.height;
  const minWidth = Math.max(1, Math.min(boundsWidth, requestedMinWidth));
  const minHeight = Math.max(1, Math.min(boundsHeight, requestedMinHeight));''',
1)
image_edit_path.write_text(image_edit, encoding='utf-8')

test_path = Path('tests/image-edit.test.ts')
test = test_path.read_text(encoding='utf-8')
anchor = '''  it('moves and resizes the visual crop without leaving the image bounds', () => {'''
if anchor not in test:
    raise SystemExit('missing image edit test anchor')
extra = r'''  it('supports independent minimum width and height for touch-friendly crop handles', () => {
    expect(adjustVisualCrop({ x: 30, y: 20, width: 100, height: 80 }, 'nw', 90, 70, 300, 200, { width: 48, height: 36 })).toEqual({ x: 82, y: 64, width: 48, height: 36 });
  });

'''
test = test.replace(anchor, extra + anchor, 1)
test_path.write_text(test, encoding='utf-8')

print('0.7.1 patch applied')
