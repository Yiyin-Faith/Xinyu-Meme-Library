from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'missing expected text in {path}: {old[:160]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

# Give the visual cropper more room and remove literal changelog \\n artifacts.
replace_once(
    'src/App.tsx',
    '<Modal title="编辑表情" subtitle="名称、归类和基础图片编辑都只在本机完成。" onClose={editing ? () => undefined : onClose}>\n    <div className="edit-layout">',
    '<Modal title="编辑表情" subtitle="名称、归类和基础图片编辑都只在本机完成。" wide={editable} onClose={editing ? () => undefined : onClose}>\n    <div className={`edit-layout ${editable ? \'visual-edit-layout\' : \'\'}`}>',
)
p = Path('src/App.tsx')
text = p.read_text(encoding='utf-8')
text = text.replace('</section>\\n          <section className="changelog-entry">', '</section>\n          <section className="changelog-entry">')
p.write_text(text, encoding='utf-8')

# Keep large touch hitboxes entirely inside the cropped/overflow-hidden preview.
styles = Path('src/styles.css')
text = styles.read_text(encoding='utf-8')
old = '''.crop-handle { position: absolute; width: 38px; height: 38px; margin: -19px; touch-action: none; z-index: 3; }
.crop-handle::after { content: ''; position: absolute; left: 50%; top: 50%; width: 11px; height: 11px; transform: translate(-50%, -50%); border-radius: 4px; background: #f8fff9; box-shadow: 0 1px 4px rgba(19,48,31,.34); }
.crop-handle-nw { left: 0; top: 0; cursor: nwse-resize; }
.crop-handle-n { left: 50%; top: 0; cursor: ns-resize; }
.crop-handle-ne { left: 100%; top: 0; cursor: nesw-resize; }
.crop-handle-e { left: 100%; top: 50%; cursor: ew-resize; }
.crop-handle-se { left: 100%; top: 100%; cursor: nwse-resize; }
.crop-handle-s { left: 50%; top: 100%; cursor: ns-resize; }
.crop-handle-sw { left: 0; top: 100%; cursor: nesw-resize; }
.crop-handle-w { left: 0; top: 50%; cursor: ew-resize; }'''
new = '''.crop-handle { position: absolute; width: 40px; height: 40px; touch-action: none; z-index: 3; }
.crop-handle::after { content: ''; position: absolute; width: 11px; height: 11px; border-radius: 4px; background: #f8fff9; box-shadow: 0 1px 4px rgba(19,48,31,.34); }
.crop-handle-nw { left: 0; top: 0; cursor: nwse-resize; }.crop-handle-nw::after { left: 2px; top: 2px; }
.crop-handle-n { left: 50%; top: 0; transform: translateX(-50%); cursor: ns-resize; }.crop-handle-n::after { left: 50%; top: 2px; transform: translateX(-50%); }
.crop-handle-ne { right: 0; top: 0; cursor: nesw-resize; }.crop-handle-ne::after { right: 2px; top: 2px; }
.crop-handle-e { right: 0; top: 50%; transform: translateY(-50%); cursor: ew-resize; }.crop-handle-e::after { right: 2px; top: 50%; transform: translateY(-50%); }
.crop-handle-se { right: 0; bottom: 0; cursor: nwse-resize; }.crop-handle-se::after { right: 2px; bottom: 2px; }
.crop-handle-s { left: 50%; bottom: 0; transform: translateX(-50%); cursor: ns-resize; }.crop-handle-s::after { left: 50%; bottom: 2px; transform: translateX(-50%); }
.crop-handle-sw { left: 0; bottom: 0; cursor: nesw-resize; }.crop-handle-sw::after { left: 2px; bottom: 2px; }
.crop-handle-w { left: 0; top: 50%; transform: translateY(-50%); cursor: ew-resize; }.crop-handle-w::after { left: 2px; top: 50%; transform: translateY(-50%); }'''
if old not in text:
    raise SystemExit('crop handle CSS marker missing')
text = text.replace(old, new, 1)
text = text.replace(
    '@media (max-width: 720px) {\n  .visual-cropper-shell { padding: 8px; }\n  .crop-handle { width: 42px; height: 42px; margin: -21px; }\n  .crop-handle::after { width: 12px; height: 12px; }\n}',
    '@media (max-width: 720px) {\n  .visual-cropper-shell { padding: 8px; }\n  .crop-handle { width: 44px; height: 44px; }\n  .crop-handle::after { width: 12px; height: 12px; }\n}',
)
text += '''\n/* Let the touch cropper use the wide editor instead of the legacy tiny square preview column. */\n.edit-layout.visual-edit-layout { grid-template-columns: minmax(290px, 1fr) minmax(0, 1fr); gap: 18px; }\n@media (max-width: 800px) { .edit-layout.visual-edit-layout { grid-template-columns: minmax(0, 1fr); } .edit-layout.visual-edit-layout .visual-cropper-shell { width: 100%; max-width: 520px; justify-self: center; } }\n'''
styles.write_text(text, encoding='utf-8')

# Recommendation hint must wake the 56dp active ball before computing its 56dp-based anchor.
service = Path('android/app/src/main/java/com/puff/meme/FloatingWindowService.java')
text = service.read_text(encoding='utf-8')
replace_old = '''    public static void noteRecommendationActivity() {
        FloatingWindowService service = activeService;
        if (service != null) service.mainHandler.post(service::activateBubble);
    }

    public static void noteRecommendationFinished() {
        FloatingWindowService service = activeService;
        if (service != null) service.mainHandler.post(service::scheduleBubbleIdle);
    }'''
replace_new = '''    public static void noteRecommendationActivity() {
        FloatingWindowService service = activeService;
        if (service == null) return;
        if (Looper.myLooper() == Looper.getMainLooper()) service.activateBubble();
        else service.mainHandler.post(service::activateBubble);
    }

    public static void noteRecommendationFinished() {
        FloatingWindowService service = activeService;
        if (service == null) return;
        if (Looper.myLooper() == Looper.getMainLooper()) service.scheduleBubbleIdle();
        else service.mainHandler.post(service::scheduleBubbleIdle);
    }'''
if replace_old not in text:
    raise SystemExit('recommendation activity marker missing')
service.write_text(text.replace(replace_old, replace_new, 1), encoding='utf-8')
