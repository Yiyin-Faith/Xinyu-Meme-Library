export type CropRect = { x: number; y: number; width: number; height: number };

export const editableImageMimes = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function canEditImage(mime: string) {
  return editableImageMimes.has(mime);
}

export function normalizeRotation(rotation: number) {
  return ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;
}

export function fullCrop(width: number, height: number): CropRect {
  return { x: 0, y: 0, width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

/** Keep a numeric crop safely within the unrotated source image. */
export function clampCrop(crop: CropRect, sourceWidth: number, sourceHeight: number): CropRect {
  const width = Math.max(1, Math.min(Math.round(crop.width) || 1, sourceWidth));
  const height = Math.max(1, Math.min(Math.round(crop.height) || 1, sourceHeight));
  const x = Math.max(0, Math.min(Math.round(crop.x) || 0, sourceWidth - width));
  const y = Math.max(0, Math.min(Math.round(crop.y) || 0, sourceHeight - height));
  return { x, y, width, height };
}

export function editedDimensions(crop: CropRect, rotation: number) {
  const normalized = normalizeRotation(rotation);
  return normalized === 90 || normalized === 270
    ? { width: crop.height, height: crop.width }
    : { width: crop.width, height: crop.height };
}

async function decodeEditableImage(blob: Blob) {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('图片尺寸无效');
    return image;
  } finally {
    // `decode()` has completed before the image is returned, so its pixels are
    // usable by canvas after the temporary object URL is released.
    URL.revokeObjectURL(url);
  }
}

/** True when the edit produces exactly the original pixels, so nothing must be re-encoded. */
export function isNoopEdit(crop: CropRect, rotation: number, flipHorizontal: boolean, sourceWidth: number, sourceHeight: number) {
  return !flipHorizontal && normalizeRotation(rotation) === 0
    && crop.x === 0 && crop.y === 0 && crop.width === sourceWidth && crop.height === sourceHeight;
}

/** Renders one selected static image only; it never reads the full gallery. */
async function render(blob: Blob, crop: CropRect, rotation: number, flipHorizontal = false, maxPreviewSide?: number): Promise<Blob> {
  if (!canEditImage(blob.type)) throw new Error('仅 PNG、JPG 和 WebP 支持裁切与旋转，避免破坏 GIF 动图、SVG 和 AVIF');
  const image = await decodeEditableImage(blob);
  const safeCrop = clampCrop(crop, image.naturalWidth, image.naturalHeight);
  const safeRotation = normalizeRotation(rotation);
  const dimensions = editedDimensions(safeCrop, safeRotation);
  const scale = maxPreviewSide ? Math.min(1, maxPreviewSide / Math.max(dimensions.width, dimensions.height)) : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(dimensions.width * scale));
  canvas.height = Math.max(1, Math.round(dimensions.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前设备不支持图片编辑');
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((safeRotation * Math.PI) / 180);
  // Mirroring happens after rotation so "flip" always means the visual
  // left/right of what the user currently sees in the preview.
  if (flipHorizontal) context.scale(-1, 1);
  context.drawImage(image, safeCrop.x, safeCrop.y, safeCrop.width, safeCrop.height, -safeCrop.width * scale / 2, -safeCrop.height * scale / 2, safeCrop.width * scale, safeCrop.height * scale);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('生成编辑后的图片失败')), 'image/png'));
}

/** Produces the original-resolution PNG used by overwrite/save-as. */
export async function renderEditedImage(blob: Blob, crop: CropRect, rotation: number, flipHorizontal = false): Promise<Blob> {
  return render(blob, crop, rotation, flipHorizontal);
}

/** Keeps interactive preview work bounded even for the largest supported image. */
export async function renderEditedPreview(blob: Blob, crop: CropRect, rotation: number, flipHorizontal = false): Promise<Blob> {
  return render(blob, crop, rotation, flipHorizontal, 960);
}
