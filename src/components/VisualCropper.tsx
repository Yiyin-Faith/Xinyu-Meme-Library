import { useRef } from 'react';
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
