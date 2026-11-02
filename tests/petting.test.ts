import { describe, expect, it } from 'vitest';
import { PettingController, pettingBounds } from '../src/renderer/petting.js';

describe('explicit local petting — FR-L2D-008', () => {
  it('requires a stroke rather than a stationary click and rejects pointer jumps', () => {
    const pet = new PettingController();
    pet.stroke(50, 0);
    expect(pet.sample(200)).toBe(0);
    pet.begin(0);
    pet.stroke(3, 10);
    pet.stroke(100, 20);
    expect(pet.sample(200)).toBe(0);
    pet.stroke(6, 30);
    expect(pet.sample(300)).toBeGreaterThan(0.9);
  });
  it('returns smoothly after release or leaving the zone, and clears immediately on blocking', () => {
    const pet = new PettingController();
    pet.begin(0);
    pet.stroke(10, 20);
    expect(pet.sample(300)).toBeGreaterThan(0.9);
    const before = pet.sample(300);
    pet.end(300);
    expect(pet.sample(300)).toBe(before);
    expect(pet.sample(500)).toBeGreaterThan(0);
    expect(pet.sample(751)).toBe(0);
    pet.stroke(40, 800);
    expect(pet.sample(1000)).toBe(0);
    pet.begin(1200);
    pet.stroke(10, 1220);
    pet.clear();
    expect(pet.sample(1500)).toBe(0);
  });
  it('times out a stationary or continuously held pointer within a finite twelve seconds', () => {
    const pet = new PettingController();
    pet.begin(0);
    pet.stroke(10, 20);
    expect(pet.sample(921)).toBe(0);
    for (let now = 1000; now <= 12000; now += 200) pet.stroke(10, now);
    expect(pet.sample(12000)).toBe(0);
    pet.stroke(10, 12500);
    expect(pet.sample(12600)).toBe(0);
  });
  it('has the same envelope at 30/60/120fps without accumulating per-frame input', () => {
    const values: number[][] = [];
    for (const fps of [30, 60, 120]) {
      const pet = new PettingController();
      pet.begin(0);
      pet.stroke(10, 10);
      for (let frame = 0; frame < fps; frame++) pet.sample((frame * 1000) / fps);
      values.push([pet.sample(300), pet.sample(800), pet.sample(1000)]);
    }
    expect(values[0]).toEqual(values[1]);
    expect(values[1]).toEqual(values[2]);
  });
  it('uses only the upper local silhouette including partial/cropped views', () => {
    expect(pettingBounds({ width: 440, height: 680, rects: [] })).toBeUndefined();
    expect(
      pettingBounds({
        width: 440,
        height: 680,
        rects: [
          { x: 100, y: 20, width: 200, height: 100 },
          { x: 50, y: 120, width: 300, height: 400 },
        ],
      }),
    ).toEqual({ x: 50, y: 20, width: 300, height: 200 });
  });
});
