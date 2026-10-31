import { describe, expect, it } from 'vitest';
import {
  defaultOverlayPosition,
  intersectsDisplay,
  transferOverlay,
} from '../src/shared/overlay-placement.js';

describe('FR-UI-005 free placement and monitor selection', () => {
  const landscape = { x: 0, y: 240, width: 1920, height: 1080 };
  const portrait = { x: 1920, y: 0, width: 1080, height: 1920 };

  it('retains half-body cropping and windows spanning monitor boundaries', () => {
    expect(
      intersectsDisplay({ x: 1500, y: 1070, width: 300, height: 500 }, [landscape, portrait]),
    ).toBe(true);
    expect(
      intersectsDisplay({ x: 1800, y: 500, width: 440, height: 680 }, [landscape, portrait]),
    ).toBe(true);
    expect(intersectsDisplay({ x: -220, y: 300, width: 440, height: 680 }, [landscape])).toBe(true);
  });

  it('detects a completely lost window, including gaps in an irregular layout', () => {
    expect(
      intersectsDisplay({ x: 100, y: 0, width: 440, height: 200 }, [landscape, portrait]),
    ).toBe(false);
    expect(intersectsDisplay({ x: 1920, y: 1920, width: 440, height: 680 }, [portrait])).toBe(
      false,
    );
    expect(intersectsDisplay({ x: 2500, y: 1500, width: 440, height: 680 }, [landscape])).toBe(
      false,
    );
  });

  it('moves to a named monitor without changing scale and preserves bottom cropping', () => {
    const before = { x: 1500, y: 1070, width: 300, height: 500 };
    const after = transferOverlay(before, landscape, portrait);
    expect(after.width).toBe(300);
    expect(after.height).toBe(500);
    expect(after.y).toBe(1670);
    expect(after.y + after.height - (portrait.y + portrait.height)).toBe(250);
    expect(intersectsDisplay(after, [portrait])).toBe(true);
    expect(transferOverlay(after, portrait, landscape)).toEqual(before);
  });

  it('supports left/top cropping and monitors with negative origins', () => {
    const source = { x: -1920, y: -200, width: 1920, height: 1080 };
    const target = { x: 0, y: 0, width: 2560, height: 1440 };
    const before = { x: -2020, y: -300, width: 440, height: 680 };
    expect(transferOverlay(before, source, target)).toEqual({
      x: -100,
      y: -100,
      width: 440,
      height: 680,
    });
  });

  it('recovers on a much smaller destination and supplies an on-screen reset position', () => {
    const target = { x: 5000, y: 0, width: 100, height: 100 };
    const before = { x: 5000, y: 1200, width: 880, height: 1360 };
    expect(intersectsDisplay(transferOverlay(before, landscape, target), [target])).toBe(true);
    expect(defaultOverlayPosition({ width: 440, height: 680 }, landscape)).toEqual({
      x: 1456,
      y: 640,
      width: 440,
      height: 680,
    });
  });
});
