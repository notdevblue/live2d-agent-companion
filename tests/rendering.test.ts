import { describe, expect, it } from 'vitest';
import { canGenerateMipmaps, maskBufferCountForGroups } from '../src/renderer/rendering.js';

describe('Cubism rendering limits', () => {
  it('allocates capacity for models exceeding the single-buffer mask limit', () => {
    for (const groups of [0, 1, 36]) expect(maskBufferCountForGroups(groups)).toBe(1);
    for (const groups of [37, 49, 64]) expect(maskBufferCountForGroups(groups)).toBe(2);
    expect(maskBufferCountForGroups(65)).toBe(3);
    for (let groups = 37; groups <= 1000; groups++)
      expect(maskBufferCountForGroups(groups) * 32).toBeGreaterThanOrEqual(groups);
  });

  it('keeps non-power-of-two textures complete under WebGL 1', () => {
    expect(canGenerateMipmaps(4096, 8192)).toBe(true);
    expect(canGenerateMipmaps(1, 1)).toBe(true);
    for (const [width, height] of [
      [4096, 8191],
      [4095, 8192],
      [0, 512],
      [512, 0],
    ])
      expect(canGenerateMipmaps(width!, height!)).toBe(false);
  });
});
