import { describe, expect, it } from 'vitest';
import { OverlayInputState } from '../src/shared/overlay-input.js';

describe('FR-UI-003 forwarded overlay input', () => {
  it('keeps captured drags interactive and clears hit state on cancellation', () => {
    const input = new OverlayInputState();
    input.acceptHit(false);
    expect(input.shouldIgnore(true)).toBe(true);
    input.setDragging(true);
    input.acceptHit(false);
    expect(input.shouldIgnore(true)).toBe(false);
    input.setDragging(false);
    expect(input.shouldIgnore(true)).toBe(true);
    input.acceptHit(true);
    expect(input.shouldIgnore(true)).toBe(false);
  });

  it('honors a disabled click-through preference', () => {
    const input = new OverlayInputState();
    input.acceptHit(false);
    expect(input.shouldIgnore(false)).toBe(false);
  });
});

describe('FR-UI-001 drag and wheel scale', () => {
  const initial = { x: 100, y: 400, width: 440, height: 680 };
  const area = { x: 0, y: 0, width: 3840, height: 2160 };
  const cursor = { x: 320, y: 740 };

  it('rejects resizing before drag and after capture cancellation', () => {
    const input = new OverlayInputState();
    expect(input.resize(1, -120, cursor, initial, area)).toBeUndefined();
    input.setDragging(true);
    expect(input.resize(1, -120, cursor, initial, area)?.scale).toBeGreaterThan(1);
    input.setDragging(false);
    expect(input.resize(1, -120, cursor, initial, area)).toBeUndefined();
  });

  it('keeps the same character point under the pointer while growing and shrinking', () => {
    const input = new OverlayInputState();
    input.setDragging(true);
    const grown = input.resize(1, -Math.log(1.25) / 0.001, cursor, initial, area)!;
    expect(grown.scale).toBeCloseTo(1.25);
    expect(grown.bounds).toEqual({ x: 45, y: 315, width: 550, height: 850 });
    expect(grown.bounds.x + grown.bounds.width / 2).toBe(cursor.x);
    expect(grown.bounds.y + grown.bounds.height / 2).toBe(cursor.y);
    const restored = input.resize(grown.scale, Math.log(1.25) / 0.001, cursor, grown.bounds, area)!;
    expect(restored.scale).toBeCloseTo(1);
    expect(restored.bounds).toEqual(initial);
  });

  it('uses the existing settings scale limits for repeated wheel input', () => {
    const input = new OverlayInputState();
    input.setDragging(true);
    let scale = 1;
    for (let i = 0; i < 30; i++) scale = input.resize(scale, -240, cursor, initial, area)!.scale;
    expect(scale).toBe(2);
    for (let i = 0; i < 30; i++) scale = input.resize(scale, 240, cursor, initial, area)!.scale;
    expect(scale).toBe(0.4);
  });

  it('keeps resized bounds visible on negative-origin and small displays', () => {
    const input = new OverlayInputState();
    input.setDragging(true);
    const smallArea = { x: -800, y: -600, width: 640, height: 480 };
    const start = { x: -800, y: -600, width: 440, height: 480 };
    const resized = input.resize(1.9, -240, { x: -800, y: -600 }, start, smallArea)!;
    expect(resized.bounds).toEqual({ x: -800, y: -600, width: 640, height: 480 });
    expect(resized.scale).toBe(2);
  });
});
