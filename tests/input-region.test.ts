import { describe, expect, it } from 'vitest';
import { alphaInputRegion, MAX_INPUT_RECTS, parseInputRegion } from '../src/shared/input-region.js';

function image(width: number, height: number, alpha: (x: number, y: number) => number): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) pixels[(y * width + x) * 4 + 3] = alpha(x, y);
  return pixels;
}

describe('FR-UI-003 own-canvas native input region', () => {
  it('maps WebGL bottom-up alpha to CSS top-left coordinates, preserving thin alpha', () => {
    const rgba = image(16, 16, (x, y) => (x === 0 && y === 15 ? 1 : 0));
    expect(alphaInputRegion(rgba, 16, 16, 16, 16, 8, 0)).toEqual({
      width: 16,
      height: 16,
      rects: [{ x: 0, y: 0, width: 8, height: 8 }],
    });
  });

  it('merges adjacent rows without filling transparent gaps between legs', () => {
    const rgba = image(32, 24, (x) => (x < 8 || x >= 24 ? 255 : 0));
    expect(alphaInputRegion(rgba, 32, 24, 32, 24, 8, 0).rects).toEqual([
      { x: 0, y: 0, width: 8, height: 24 },
      { x: 24, y: 0, width: 8, height: 24 },
    ]);
  });

  it('maps DPR2 readback to DIP and bounds a six-pixel halo at the canvas edge', () => {
    const rgba = image(32, 32, (x, y) => (x === 31 && y === 31 ? 255 : 0));
    const region = alphaInputRegion(rgba, 32, 32, 16, 16);
    expect(region.rects).toEqual([{ x: 2, y: 0, width: 14, height: 14 }]);
    expect(parseInputRegion(region)).toEqual(region);
  });

  it('represents an empty frame and bounds pathological packet complexity', () => {
    expect(
      alphaInputRegion(
        image(16, 16, () => 0),
        16,
        16,
        16,
        16,
      ).rects,
    ).toEqual([]);
    const rgba = image(128, 128, (x, y) => ((x + y) % 2 ? 255 : 0));
    const region = alphaInputRegion(rgba, 128, 128, 128, 128, 1, 0);
    expect(region.rects).toEqual([{ x: 0, y: 0, width: 128, height: 128 }]);
    expect(region.rects.length).toBeLessThanOrEqual(MAX_INPUT_RECTS);
  });

  it('rejects oversized, malformed and out-of-window renderer packets', () => {
    const valid = { width: 440, height: 680, rects: [{ x: 0, y: 0, width: 8, height: 8 }] };
    expect(parseInputRegion(valid)).toEqual(valid);
    for (const value of [
      null,
      { ...valid, width: Infinity },
      { ...valid, height: 8193 },
      { ...valid, rects: Array(4097).fill(valid.rects[0]) },
      { ...valid, rects: [{ x: -1, y: 0, width: 8, height: 8 }] },
      { ...valid, rects: [{ x: 439, y: 0, width: 8, height: 8 }] },
      { ...valid, rects: [{ x: 0, y: 679, width: 1, height: 2 }] },
      { ...valid, rects: [{ x: 0.5, y: 0, width: 1, height: 1 }] },
      { ...valid, rects: [{ x: 0, y: 0, width: 0, height: 1 }] },
    ])
      expect(parseInputRegion(value)).toBeUndefined();
  });
});
