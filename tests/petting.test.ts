import { describe, expect, it } from 'vitest';
import { PettingController, applyPetting, pettingBounds } from '../src/renderer/petting.js';
import { ActingController } from '../src/renderer/acting.js';

describe('explicit local petting — FR-L2D-008', () => {
  it('adds a readable local head tilt and downward gaze while preserving the cue and window-independent motion', () => {
    const frame = new ActingController().sample(0, 0);
    const pet = applyPetting(frame, 0.65);
    expect(pet.headZ - frame.headZ).toBeCloseTo(0.2275);
    expect(pet.gazeY - frame.gazeY).toBeCloseTo(-0.1625);
    expect(pet.smile).toBeCloseTo(0.5525);
    expect(pet.offsetY).toBe(frame.offsetY);
    expect(pet.breath).toBe(frame.breath);
    expect(pet.preset).toBe(frame.preset);
    expect(applyPetting(frame, 0)).toEqual(frame);
    const reduced = applyPetting(frame, 0.65 * 0.18);
    expect(reduced.headZ).toBeCloseTo(pet.headZ * 0.18);
    expect(reduced.gazeY).toBeCloseTo(pet.gazeY * 0.18);
    expect(applyPetting(frame, NaN)).toEqual(frame);
  });
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
  it('looks toward the current local contact and releases that contribution with the touch', () => {
    const frame = new ActingController().sample(0, 0);
    const left = applyPetting(frame, 0.65, { x: -1, y: 1 });
    const right = applyPetting(frame, 0.65, { x: 1, y: -1 });
    expect(left.gazeX).toBeLessThan(frame.gazeX);
    expect(right.gazeX).toBeGreaterThan(frame.gazeX);
    expect(left.headX).toBeLessThan(right.headX);
    expect(left.headY).toBeGreaterThan(right.headY);
    expect(left.gazeY).toBeGreaterThan(right.gazeY);
    expect(applyPetting(frame, 0, { x: 1, y: 1 })).toEqual(frame);
    expect(applyPetting(frame, 0.65, { x: NaN, y: Infinity })).toEqual(applyPetting(frame, 0.65));
    expect(applyPetting(frame, 0.65, { x: 99, y: -99 })).toEqual(right);
  });
  it('gives direct contact priority over opposing idle head, gaze and torso intent', () => {
    const neutral = new ActingController().sample(0, 0);
    for (const direction of [-1, 1]) {
      const frame = {
        ...neutral,
        headX: -direction,
        gazeX: -direction,
        bodyX: -direction * 0.4,
        headY: -direction * 0.3,
        gazeY: -direction * 0.2,
      };
      const pet = applyPetting(frame, 0.65, { x: direction, y: direction });
      for (const key of ['headX', 'gazeX', 'bodyX', 'headY', 'gazeY'] as const)
        expect(pet[key] * direction).toBeGreaterThan(0);
      expect(pet.headX).toBeCloseTo(direction * 0.235);
      expect(pet.gazeX).toBeCloseTo(direction * 0.2675);
      expect(pet.bodyX).toBeCloseTo(direction * 0.055);
      expect(pet.lean).toBe(frame.lean);
      expect(pet.offsetY).toBe(frame.offsetY);
      expect(pet.bodyY).toBe(frame.bodyY);
    }
  });
  it('preserves the exact nonneutral frame at zero or invalid weight, including negative mouth intent', () => {
    const frame = {
      ...new ActingController().sample(0, 0),
      smile: -0.6,
      headX: -0.8,
      bodyX: -0.3,
      gazeX: 0.7,
      eyeL: 0.4,
      eyeR: 1.2,
    };
    for (const weight of [0, -1, NaN, Infinity])
      expect(applyPetting(frame, weight, { x: 1, y: -1 })).toBe(frame);
  });
  it('fades direct intent back to an opposing negative-mouth baseline without a final-frame snap', () => {
    const frame = {
      ...new ActingController().sample(0, 0),
      smile: -0.6,
      headX: -0.8,
      gazeX: -0.7,
      bodyX: -0.3,
    };
    const pet = new PettingController();
    pet.begin(0);
    pet.stroke(10, 20);
    const at = (now: number) => applyPetting(frame, pet.sample(now) * 0.65, { x: 1, y: 1 });
    const contact = at(300);
    pet.end(300);
    expect(at(300)).toEqual(contact);
    expect(at(500)).toEqual(contact);
    const tail = at(1349);
    for (const key of ['headX', 'headY', 'gazeX', 'gazeY', 'bodyX', 'smile', 'eyeSmile'] as const)
      expect(Math.abs(tail[key] - frame[key])).toBeLessThan(0.00001);
    expect(at(1350)).toBe(frame);
  });
  it('returns smoothly after release or leaving the zone, and clears immediately on blocking', () => {
    const pet = new PettingController();
    pet.begin(0);
    pet.stroke(10, 20);
    expect(pet.sample(300)).toBeGreaterThan(0.9);
    const before = pet.sample(300);
    pet.end(300);
    expect(pet.sample(300)).toBe(before);
    expect(pet.sample(500)).toBe(before);
    expect(pet.sample(751)).toBeGreaterThan(0);
    const tail = pet.sample(1000);
    pet.stroke(40, 800);
    pet.end(1000);
    expect(pet.sample(1000)).toBe(tail);
    expect(pet.sample(1351)).toBe(0);
    pet.begin(1400);
    pet.stroke(10, 1420);
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
  it('caps the release afterglow at the original twelve-second budget and does not restart it', () => {
    const pet = new PettingController();
    pet.begin(0);
    for (let now = 20; now <= 11820; now += 200) pet.stroke(10, now);
    const before = pet.sample(11900);
    expect(before).toBeGreaterThan(0);
    pet.end(11900);
    expect(pet.sample(11900)).toBe(before);
    expect(pet.sample(12000)).toBe(0);
    pet.end(12100);
    expect(pet.sample(12200)).toBe(0);
  });
  it('keeps a gradual fade when release is shortened near the twelve-second cap', () => {
    const pet = new PettingController();
    pet.begin(0);
    for (let now = 20; now <= 11620; now += 200) pet.stroke(10, now);
    pet.end(11700);
    const start = pet.sample(11700);
    expect(start).toBeGreaterThan(0.4);
    expect(pet.sample(11800)).toBeLessThan(start);
    expect(pet.sample(11900)).toBeGreaterThan(0);
    expect(pet.sample(11900)).toBeLessThan(start * 0.8);
    expect(pet.sample(11999)).toBeLessThan(start * 0.01);
    pet.end(11999);
    expect(pet.sample(12000)).toBe(0);
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
