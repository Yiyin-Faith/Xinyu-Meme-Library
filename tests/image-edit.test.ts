import { describe, expect, it } from 'vitest';
import { adjustVisualCrop, canEditImage, clampCrop, editedDimensions, fullCrop, normalizeRotation, sourceCropToVisual, visualCropToSource, visualDimensions } from '../src/lib/image-edit';

describe('image editing helpers', () => {
  it('limits crop coordinates and dimensions to the source image', () => {
    expect(fullCrop(120, 80)).toEqual({ x: 0, y: 0, width: 120, height: 80 });
    expect(clampCrop({ x: -3, y: 79, width: 999, height: 4 }, 120, 80)).toEqual({ x: 0, y: 76, width: 120, height: 4 });
  });

  it('keeps rotation to right angles and swaps output dimensions when needed', () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(460)).toBe(90);
    expect(editedDimensions({ x: 0, y: 0, width: 120, height: 80 }, 90)).toEqual({ width: 80, height: 120 });
    expect(editedDimensions({ x: 0, y: 0, width: 120, height: 80 }, 180)).toEqual({ width: 120, height: 80 });
  });

  it('only enables static formats that can be safely flattened to PNG', () => {
    expect(canEditImage('image/png')).toBe(true);
    expect(canEditImage('image/jpeg')).toBe(true);
    expect(canEditImage('image/webp')).toBe(true);
    expect(canEditImage('image/gif')).toBe(false);
    expect(canEditImage('image/svg+xml')).toBe(false);
  });

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

  it('supports independent minimum width and height for touch-friendly crop handles', () => {
    expect(adjustVisualCrop({ x: 30, y: 20, width: 100, height: 80 }, 'nw', 90, 70, 300, 200, { width: 48, height: 36 })).toEqual({ x: 82, y: 64, width: 48, height: 36 });
  });

  it('moves and resizes visual crops without leaving the preview bounds', () => {
    expect(adjustVisualCrop({ x: 10, y: 10, width: 40, height: 30 }, 'move', 90, -30, 120, 80, 8)).toEqual({ x: 80, y: 0, width: 40, height: 30 });
    expect(adjustVisualCrop({ x: 10, y: 10, width: 40, height: 30 }, 'nw', 100, 100, 120, 80, 8)).toEqual({ x: 42, y: 32, width: 8, height: 8 });
    expect(adjustVisualCrop({ x: 70, y: 50, width: 30, height: 20 }, 'se', 80, 80, 120, 80, 8)).toEqual({ x: 70, y: 50, width: 50, height: 30 });
  });

});
