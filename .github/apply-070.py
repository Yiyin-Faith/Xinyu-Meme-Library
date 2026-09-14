from pathlib import Path
import re


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'missing expected text in {path}: {old[:180]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


def regex_once(path, pattern, repl):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    new, count = re.subn(pattern, repl, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'expected one regex match in {path}, got {count}: {pattern[:160]!r}')
    p.write_text(new, encoding='utf-8')


# Visual crop coordinate model.
image_edit = Path('src/lib/image-edit.ts')
text = image_edit.read_text(encoding='utf-8')
marker = 'export function editedDimensions(crop: CropRect, rotation: number) {'
helpers = r'''export type VisualCropAction = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

export function visualDimensions(sourceWidth: number, sourceHeight: number, rotation: number) {
  const normalized = normalizeRotation(rotation);
  return normalized === 90 || normalized === 270
    ? { width: sourceHeight, height: sourceWidth }
    : { width: sourceWidth, height: sourceHeight };
}

/** Map a source-space crop to the full transformed preview shown to the user. */
export function sourceCropToVisual(
  crop: CropRect,
  sourceWidth: number,
  sourceHeight: number,
  rotation: number,
  flipHorizontal = false,
): CropRect {
  const safe = clampCrop(crop, sourceWidth, sourceHeight);
  const normalized = normalizeRotation(rotation);
  let visual: CropRect;
  if (normalized === 90) {
    visual = { x: sourceHeight - (safe.y + safe.height), y: safe.x, width: safe.height, height: safe.width };
  } else if (normalized === 180) {
    visual = { x: sourceWidth - (safe.x + safe.width), y: sourceHeight - (safe.y + safe.height), width: safe.width, height: safe.height };
  } else if (normalized === 270) {
    visual = { x: safe.y, y: sourceWidth - (safe.x + safe.width), width: safe.height, height: safe.width };
  } else {
    visual = { ...safe };
  }
  if (flipHorizontal) {
    const dimensions = visualDimensions(sourceWidth, sourceHeight, normalized);
    visual = { ...visual, x: dimensions.width - (visual.x + visual.width) };
  }
  return visual;
}

/** Inverse of sourceCropToVisual; persisted CropRect values remain source-space. */
export function visualCropToSource(
  crop: CropRect,
  sourceWidth: number,
  sourceHeight: number,
  rotation: number,
  flipHorizontal = false,
): CropRect {
  const normalized = normalizeRotation(rotation);
  const dimensions = visualDimensions(sourceWidth, sourceHeight, normalized);
  let visual = clampCrop(crop, dimensions.width, dimensions.height);
  if (flipHorizontal) visual = { ...visual, x: dimensions.width - (visual.x + visual.width) };
  let source: CropRect;
  if (normalized === 90) {
    source = { x: visual.y, y: sourceHeight - (visual.x + visual.width), width: visual.height, height: visual.width };
  } else if (normalized === 180) {
    source = { x: sourceWidth - (visual.x + visual.width), y: sourceHeight - (visual.y + visual.height), width: visual.width, height: visual.height };
  } else if (normalized === 270) {
    source = { x: sourceWidth - (visual.y + visual.height), y: visual.x, width: visual.height, height: visual.width };
  } else {
    source = { ...visual };
  }
  return clampCrop(source, sourceWidth, sourceHeight);
}

/** Pure visual-space drag/resize helper used by the touch cropper. */
export function adjustVisualCrop(
  crop: CropRect,
  action: VisualCropAction,
  dx: number,
  dy: number,
  boundsWidth: number,
  boundsHeight: number,
  minimumSize = 1,
): CropRect {
  const safe = clampCrop(crop, boundsWidth, boundsHeight);
  const minWidth = Math.max(1, Math.min(boundsWidth, minimumSize));
  const minHeight = Math.max(1, Math.min(boundsHeight, minimumSize));
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
  if (action === 'move') {
    return {
      x: clamp(safe.x + dx, 0, boundsWidth - safe.width),
      y: clamp(safe.y + dy, 0, boundsHeight - safe.height),
      width: safe.width,
      height: safe.height,
    };
  }

  let left = safe.x;
  let top = safe.y;
  let right = safe.x + safe.width;
  let bottom = safe.y + safe.height;
  if (action.includes('w')) left = clamp(left + dx, 0, right - minWidth);
  if (action.includes('e')) right = clamp(right + dx, left + minWidth, boundsWidth);
  if (action.includes('n')) top = clamp(top + dy, 0, bottom - minHeight);
  if (action.includes('s')) bottom = clamp(bottom + dy, top + minHeight, boundsHeight);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

'''
if marker not in text:
    raise SystemExit('image-edit insertion marker missing')
image_edit.write_text(text.replace(marker, helpers + marker, 1), encoding='utf-8')

# Touch-friendly visual cropper.
Path('src/components/VisualCropper.tsx').write_text(r'''import { useRef } from 'react';
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
  const interaction = useRef<Interaction>();
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
    if (interaction.current?.pointerId === event.pointerId) interaction.current = undefined;
  };

  const style = {
    '--crop-left': `${(visualCrop.x / dimensions.width) * 100}%`,
    '--crop-top': `${(visualCrop.y / dimensions.height) * 100}%`,
    '--crop-width': `${(visualCrop.width / dimensions.width) * 100}%`,
    '--crop-height': `${(visualCrop.height / dimensions.height) * 100}%`,
    aspectRatio: `${dimensions.width} / ${dimensions.height}`,
    maxWidth: portraitMaxWidth ? `${portraitMaxWidth}px` : '100%',
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
  </div>;
}
''', encoding='utf-8')

# App integration.
replace_once('src/App.tsx', "import Modal from './components/Modal';", "import Modal from './components/Modal';\nimport VisualCropper from './components/VisualCropper';")
replace_once('src/App.tsx', "const CURRENT_VERSION = '0.6.11';", "const CURRENT_VERSION = '0.7.0';")
regex_once(
    'src/App.tsx',
    r"  useEffect\(\(\) => \{\n    if \(!editable\) return;\n    let active = true;\n    let previewUrl = '';\n    void renderEditedPreview\(meme\.blob, crop, rotation, flip\)\.then\(\(image\) => \{\n      previewUrl = URL\.createObjectURL\(image\);\n      if \(active\) setEditPreview\(previewUrl\);\n      else URL\.revokeObjectURL\(previewUrl\);\n    \}\)\.catch\(\(\) => undefined\);\n    return \(\) => \{ active = false; if \(previewUrl\) URL\.revokeObjectURL\(previewUrl\); \};\n  \}, \[editable, meme\.blob, crop\.x, crop\.y, crop\.width, crop\.height, rotation, flip\]\);\n\n  const changeCrop = \(field: keyof CropRect, value: string\) => \{\n    const number = Number\(value\);\n    setCrop\(\(current\) => clampCrop\(\{ \.\.\.current, \[field\]: Number\.isFinite\(number\) \? number : current\[field\] \}, meme\.width, meme\.height\)\);\n  \};\n  const resetEdits = \(\) => \{ setCrop\(fullCrop\(meme\.width, meme\.height\)\); setRotation\(0\); setFlip\(false\); \};",
    "  useEffect(() => {\n    if (!editable) return;\n    let active = true;\n    let previewUrl = '';\n    // The crop box is a cheap DOM overlay. Re-render only the full transformed\n    // preview when rotation/flip changes, never on pointermove.\n    void renderEditedPreview(meme.blob, fullCrop(meme.width, meme.height), rotation, flip).then((image) => {\n      previewUrl = URL.createObjectURL(image);\n      if (active) setEditPreview(previewUrl);\n      else URL.revokeObjectURL(previewUrl);\n    }).catch(() => undefined);\n    return () => { active = false; if (previewUrl) URL.revokeObjectURL(previewUrl); };\n  }, [editable, meme.blob, meme.width, meme.height, rotation, flip]);\n\n  const resetCrop = () => { setCrop(fullCrop(meme.width, meme.height)); };"
)
replace_once('src/App.tsx', '<div className="edit-preview edit-preview-result"><img src={editPreview || url} alt={meme.title} /></div>', '{editable ? <VisualCropper imageUrl={editPreview || url} alt={meme.title} crop={crop} sourceWidth={meme.width} sourceHeight={meme.height} rotation={rotation} flipHorizontal={flip} onChange={setCrop} /> : <div className="edit-preview edit-preview-result"><img src={url} alt={meme.title} /></div>}')
regex_once(
    'src/App.tsx',
    r'        \{editable \? <details className="image-editor" open>.*?</details> : <p className="image-edit-unsupported">',
    '        {editable ? <details className="image-editor" open><summary><Crop size={15} /> 裁切与旋转 <small>输出 PNG · {output.width} × {output.height}</small></summary><div className="image-editor-controls"><p className="crop-instruction">直接拖动上方图片中的裁切框，不需要填写 X / Y 坐标。</p><div className="rotate-controls"><button type="button" className="glass-button" onClick={() => setRotation((value) => (value + 270) % 360)}><RotateCcw size={14} /> 向左 90°</button><button type="button" className="glass-button" onClick={() => setRotation((value) => (value + 90) % 360)}><RotateCw size={14} /> 向右 90°</button><button type="button" className={`glass-button ${flip ? \'selected-mode\' : \'\'}`} aria-pressed={flip} onClick={() => setFlip((value) => !value)}><FlipHorizontal size={14} /> 水平翻转</button></div><button type="button" className="text-button" onClick={resetCrop}>恢复整图</button></div></details> : <p className="image-edit-unsupported">'
)
replace_once('src/App.tsx', '<section className="changelog-entry"><strong>v0.6.11</strong>', '<section className="changelog-entry"><strong>v0.7.0</strong><ul><li>图片编辑新增可视化拖拽裁切：直接拖动图片上的边框、四边和四角即可裁图，不再要求输入 X / Y / 宽 / 高。</li><li>Android 悬浮球闲置约 6 秒后自动收缩成贴边竖向胶囊，触摸、拖动、打开迷你库或关键词推荐时会立即恢复圆球。</li></ul></section>\\n          <section className="changelog-entry"><strong>v0.6.11</strong>')
replace_once('src/App.tsx', 'canEditImage, clampCrop, editedDimensions', 'canEditImage, editedDimensions')

# Cropper styles.
styles = Path('src/styles.css')
styles.write_text(styles.read_text(encoding='utf-8') + r'''

/* v0.7.0: touch-first visual cropper. */
.visual-cropper-shell { display: grid; gap: 7px; padding: 10px; border-radius: 14px; background: rgba(229, 241, 232, .54); border: 1px solid rgba(82, 126, 96, .16); }
.visual-cropper-stage { position: relative; width: 100%; margin: 0 auto; overflow: hidden; border-radius: 12px; background: #1f2823; touch-action: none; user-select: none; -webkit-user-select: none; }
.visual-cropper-stage > img { display: block; width: 100%; height: 100%; object-fit: fill; pointer-events: none; user-select: none; -webkit-user-drag: none; }
.visual-crop-selection { position: absolute; left: var(--crop-left); top: var(--crop-top); width: var(--crop-width); height: var(--crop-height); border: 2px solid rgba(244, 255, 246, .96); box-shadow: 0 0 0 9999px rgba(12, 20, 15, .52), 0 0 0 1px rgba(52, 106, 70, .55); cursor: move; touch-action: none; }
.crop-grid-line { position: absolute; pointer-events: none; background: rgba(255,255,255,.38); }
.crop-grid-v { top: 0; bottom: 0; width: 1px; }
.crop-grid-h { left: 0; right: 0; height: 1px; }
.crop-grid-v.one { left: 33.333%; } .crop-grid-v.two { left: 66.666%; }
.crop-grid-h.one { top: 33.333%; } .crop-grid-h.two { top: 66.666%; }
.crop-handle { position: absolute; width: 38px; height: 38px; margin: -19px; touch-action: none; z-index: 3; }
.crop-handle::after { content: ''; position: absolute; left: 50%; top: 50%; width: 11px; height: 11px; transform: translate(-50%, -50%); border-radius: 4px; background: #f8fff9; box-shadow: 0 1px 4px rgba(19,48,31,.34); }
.crop-handle-nw { left: 0; top: 0; cursor: nwse-resize; }
.crop-handle-n { left: 50%; top: 0; cursor: ns-resize; }
.crop-handle-ne { left: 100%; top: 0; cursor: nesw-resize; }
.crop-handle-e { left: 100%; top: 50%; cursor: ew-resize; }
.crop-handle-se { left: 100%; top: 100%; cursor: nwse-resize; }
.crop-handle-s { left: 50%; top: 100%; cursor: ns-resize; }
.crop-handle-sw { left: 0; top: 100%; cursor: nesw-resize; }
.crop-handle-w { left: 0; top: 50%; cursor: ew-resize; }
.visual-crop-hint { color: #7d9185; text-align: center; font-size: 10px; }
.crop-instruction { color: #728a7c; font-size: 11px; line-height: 1.55; }
@media (max-width: 720px) {
  .visual-cropper-shell { padding: 8px; }
  .crop-handle { width: 42px; height: 42px; margin: -21px; }
  .crop-handle::after { width: 12px; height: 12px; }
}
''', encoding='utf-8')

# Unit tests for mapping and drag math.
test = Path('tests/image-edit.test.ts')
t = test.read_text(encoding='utf-8')
t = t.replace("import { canEditImage, clampCrop, editedDimensions, fullCrop, normalizeRotation } from '../src/lib/image-edit';", "import { adjustVisualCrop, canEditImage, clampCrop, editedDimensions, fullCrop, normalizeRotation, sourceCropToVisual, visualCropToSource, visualDimensions } from '../src/lib/image-edit';")
insert = r'''

  it('round-trips source crops through every rotated and flipped visual space', () => {
    const source = { x: 17, y: 9, width: 43, height: 31 };
    for (const rotation of [0, 90, 180, 270]) {
      for (const flip of [false, true]) {
        const visual = sourceCropToVisual(source, 120, 80, rotation, flip);
        expect(visualCropToSource(visual, 120, 80, rotation, flip)).toEqual(source);
      }
    }
    expect(visualDimensions(120, 80, 90)).toEqual({ width: 80, height: 120 });
  });

  it('moves and resizes visual crops without leaving the preview bounds', () => {
    expect(adjustVisualCrop({ x: 10, y: 10, width: 40, height: 30 }, 'move', 90, -30, 120, 80, 8)).toEqual({ x: 80, y: 0, width: 40, height: 30 });
    expect(adjustVisualCrop({ x: 10, y: 10, width: 40, height: 30 }, 'nw', 100, 100, 120, 80, 8)).toEqual({ x: 42, y: 32, width: 8, height: 8 });
    expect(adjustVisualCrop({ x: 70, y: 50, width: 30, height: 20 }, 'se', 80, 80, 120, 80, 8)).toEqual({ x: 70, y: 50, width: 50, height: 30 });
  });
'''
t = t.replace('\n});\n', insert + '\n});\n', 1)
test.write_text(t, encoding='utf-8')

# Android floating ball idle capsule.
service = Path('android/app/src/main/java/com/puff/meme/FloatingWindowService.java')
s = service.read_text(encoding='utf-8')
s = s.replace('    private static final float MIN_OPACITY = 0.30f;\n    private static final int PAGE_SIZE = 24;', '    private static final float MIN_OPACITY = 0.30f;\n    private static final long IDLE_DELAY_MS = 6_000L;\n    private static final int ACTIVE_BUBBLE_SIZE_DP = 56;\n    private static final int IDLE_BUBBLE_WIDTH_DP = 20;\n    private static final int IDLE_BUBBLE_HEIGHT_DP = 52;\n    private static final int PAGE_SIZE = 24;')
s = s.replace('    private View bubble;\n    private WindowManager.LayoutParams bubbleLayoutParams;', '    private View bubble;\n    private WindowManager.LayoutParams bubbleLayoutParams;\n    private boolean bubbleIdle;\n    private final Runnable idleBubble = this::enterIdleBubble;')
s = s.replace('    public static boolean isOverlayShowing() {\n        return overlayShowing;\n    }', '    public static boolean isOverlayShowing() {\n        return overlayShowing;\n    }\n\n    public static void noteRecommendationActivity() {\n        FloatingWindowService service = activeService;\n        if (service != null) service.mainHandler.post(service::activateBubble);\n    }\n\n    public static void noteRecommendationFinished() {\n        FloatingWindowService service = activeService;\n        if (service != null) service.mainHandler.post(service::scheduleBubbleIdle);\n    }')
s = s.replace('        view.setText("心");\n        view.setTextColor(Color.WHITE);\n        view.setTextSize(23);\n        view.setGravity(Gravity.CENTER);\n        view.setContentDescription("展开迷你表情库");\n        view.setBackground(roundRect(Color.rgb(78, 125, 96), dp(28), Color.argb(80, 255, 255, 255), dp(2)));\n        view.setElevation(dp(8));\n        view.setAlpha(getOpacity(this));\n        bubbleLayoutParams = new WindowManager.LayoutParams(\n            dp(56),\n            dp(56),', '        view.setTextColor(Color.WHITE);\n        view.setGravity(Gravity.CENTER);\n        view.setContentDescription("展开迷你表情库");\n        view.setElevation(dp(8));\n        view.setAlpha(getOpacity(this));\n        bubbleIdle = false;\n        applyBubbleAppearance(view);\n        bubbleLayoutParams = new WindowManager.LayoutParams(\n            dp(ACTIVE_BUBBLE_SIZE_DP),\n            dp(ACTIVE_BUBBLE_SIZE_DP),')
s = s.replace('        windowManager.addView(view, bubbleLayoutParams);\n        bubble = view;\n        overlayShowing = true;', '        windowManager.addView(view, bubbleLayoutParams);\n        bubble = view;\n        overlayShowing = true;\n        scheduleBubbleIdle();')
s = s.replace('    private void toggleMiniLibrary() {\n        if (panel != null) hideMiniLibrary(panelOpenedByRecommendation);\n        else showMiniLibrary(Collections.emptyList(), false);\n    }', '    private void toggleMiniLibrary() {\n        activateBubble();\n        if (panel != null) hideMiniLibrary(panelOpenedByRecommendation);\n        else showMiniLibrary(Collections.emptyList(), false);\n    }')
s = s.replace('    private void showMiniLibrary(List<String> matchingTags, boolean fromRecommendation) {\n        if (bubble == null || windowManager == null || !Settings.canDrawOverlays(this)) return;', '    private void showMiniLibrary(List<String> matchingTags, boolean fromRecommendation) {\n        activateBubble();\n        if (bubble == null || windowManager == null || !Settings.canDrawOverlays(this)) return;')
s = s.replace('        panelSearchText = "";\n        if (bubble == null) windowManager = null;\n    }', '        panelSearchText = "";\n        if (bubble == null) windowManager = null;\n        else scheduleBubbleIdle();\n    }')
s = s.replace('                    case MotionEvent.ACTION_DOWN:\n                        downX = event.getRawX();\n                        downY = event.getRawY();\n                        startX = bubbleLayoutParams.x;\n                        startY = bubbleLayoutParams.y;', '                    case MotionEvent.ACTION_DOWN:\n                        activateBubble();\n                        downX = event.getRawX();\n                        downY = event.getRawY();\n                        startX = bubbleLayoutParams.x;\n                        startY = bubbleLayoutParams.y;')
s = s.replace('                    case MotionEvent.ACTION_UP:\n                        snapBubbleToEdge();\n                        saveBubblePosition();\n                        if (!moved) toggleMiniLibrary();\n                        return true;\n                    case MotionEvent.ACTION_CANCEL:\n                        snapBubbleToEdge();\n                        saveBubblePosition();\n                        return true;', '                    case MotionEvent.ACTION_UP:\n                        snapBubbleToEdge();\n                        saveBubblePosition();\n                        if (!moved) toggleMiniLibrary();\n                        else scheduleBubbleIdle();\n                        return true;\n                    case MotionEvent.ACTION_CANCEL:\n                        snapBubbleToEdge();\n                        saveBubblePosition();\n                        scheduleBubbleIdle();\n                        return true;')
s = s.replace('        int left = dp(8);\n        int right = Math.max(left, screenWidth() - bubbleLayoutParams.width - dp(8));', '        int left = bubbleEdgeInset();\n        int right = Math.max(left, screenWidth() - bubbleLayoutParams.width - bubbleEdgeInset());')
s = s.replace('        int width = bubbleLayoutParams == null ? dp(56) : bubbleLayoutParams.width;\n        int min = dp(8);\n        int max = Math.max(min, screenWidth() - width - dp(8));', '        int width = bubbleLayoutParams == null ? dp(ACTIVE_BUBBLE_SIZE_DP) : bubbleLayoutParams.width;\n        int min = bubbleEdgeInset();\n        int max = Math.max(min, screenWidth() - width - bubbleEdgeInset());')
s = s.replace('        int height = bubbleLayoutParams == null ? dp(56) : bubbleLayoutParams.height;', '        int height = bubbleLayoutParams == null ? dp(ACTIVE_BUBBLE_SIZE_DP) : bubbleLayoutParams.height;')
s = s.replace('        int width = bubbleLayoutParams == null ? dp(56) : bubbleLayoutParams.width;', '        int width = bubbleLayoutParams == null ? dp(ACTIVE_BUBBLE_SIZE_DP) : bubbleLayoutParams.width;')
s = s.replace('        int min = dp(8);\n        int maxX = Math.max(min, screenWidth() - bubbleLayoutParams.width - dp(8));', '        int min = bubbleEdgeInset();\n        int maxX = Math.max(min, screenWidth() - bubbleLayoutParams.width - bubbleEdgeInset());')
insert_before = '    private void snapBubbleToEdge() {'
idle_methods = '''    private int bubbleEdgeInset() {\n        return bubbleIdle ? 0 : dp(8);\n    }\n\n    private void applyBubbleAppearance(TextView view) {\n        if (bubbleIdle) {\n            view.setText("");\n            view.setTextSize(1);\n            view.setBackground(roundRect(Color.rgb(78, 125, 96), dp(26), Color.argb(70, 255, 255, 255), dp(1)));\n            view.setContentDescription("展开心语悬浮助手");\n        } else {\n            view.setText("心");\n            view.setTextSize(23);\n            view.setBackground(roundRect(Color.rgb(78, 125, 96), dp(28), Color.argb(80, 255, 255, 255), dp(2)));\n            view.setContentDescription("展开迷你表情库");\n        }\n    }\n\n    private void setBubbleIdle(boolean idle) {\n        if (bubbleIdle == idle || bubble == null || bubbleLayoutParams == null || windowManager == null) return;\n        boolean onRight = bubbleIsOnRight(bubbleLayoutParams.x);\n        double ratio = bubbleRatio(bubbleLayoutParams.y);\n        bubbleIdle = idle;\n        bubbleLayoutParams.width = dp(idle ? IDLE_BUBBLE_WIDTH_DP : ACTIVE_BUBBLE_SIZE_DP);\n        bubbleLayoutParams.height = dp(idle ? IDLE_BUBBLE_HEIGHT_DP : ACTIVE_BUBBLE_SIZE_DP);\n        applyBubblePosition(onRight, ratio);\n        if (bubble instanceof TextView) applyBubbleAppearance((TextView) bubble);\n        try { windowManager.updateViewLayout(bubble, bubbleLayoutParams); } catch (Exception ignored) { }\n    }\n\n    private void activateBubble() {\n        mainHandler.removeCallbacks(idleBubble);\n        setBubbleIdle(false);\n    }\n\n    private void scheduleBubbleIdle() {\n        mainHandler.removeCallbacks(idleBubble);\n        if (bubble != null && panel == null) mainHandler.postDelayed(idleBubble, IDLE_DELAY_MS);\n    }\n\n    private void enterIdleBubble() {\n        if (bubble == null || panel != null) return;\n        setBubbleIdle(true);\n    }\n\n'''
if insert_before not in s:
    raise SystemExit('idle method insertion marker missing')
s = s.replace(insert_before, idle_methods + insert_before, 1)
service.write_text(s, encoding='utf-8')

# Recommendation hint wakes the ball while it is visible.
hint = Path('android/app/src/main/java/com/puff/meme/RecommendationHintOverlay.java')
h = hint.read_text(encoding='utf-8')
h = h.replace('    private static boolean showNow(Context context, List<String> tags) {\n        dismissNow();', '    private static boolean showNow(Context context, List<String> tags) {\n        dismissNow();\n        FloatingWindowService.noteRecommendationActivity();')
h = h.replace('        hintView = null;\n        windowManager = null;\n    }', '        hintView = null;\n        windowManager = null;\n        FloatingWindowService.noteRecommendationFinished();\n    }')
hint.write_text(h, encoding='utf-8')

# Version 0.7.0 / Android 18.
replace_once('package.json', '"version": "0.6.11"', '"version": "0.7.0"')
lock = Path('package-lock.json')
lock_text = lock.read_text(encoding='utf-8')
if lock_text.count('"version": "0.6.11"') < 2:
    raise SystemExit('package-lock version markers missing')
lock.write_text(lock_text.replace('"version": "0.6.11"', '"version": "0.7.0"', 2), encoding='utf-8')
replace_once('android/app/build.gradle', 'versionCode 17', 'versionCode 18')
replace_once('android/app/build.gradle', 'versionName "0.6.11"', 'versionName "0.7.0"')
