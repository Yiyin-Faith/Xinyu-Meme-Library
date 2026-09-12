import { describe, expect, it } from 'vitest';
import { canEditImage, clampCrop, editedDimensions, fullCrop, normalizeRotation } from '../src/lib/image-edit';

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
});
