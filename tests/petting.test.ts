import { describe, expect, it } from 'vitest';
import { PettingController, applyPetting, pettingBounds } from '../src/renderer/petting.js';
import { ActingController } from '../src/renderer/acting.js';

describe('explicit local petting — FR-L2D-008', () => {
  it('exposes held contact before the stroke threshold without starting or extending a response', () => {
    const pet = new PettingController();
    expect(pet.contactHeld).toBe(false);
    pet.begin(0);
    expect(pet.contactHeld).toBe(true);
    pet.stroke(3, 20);
    expect(pet.sample(200)).toBe(0);
    expect(pet.timing()).toBeUndefined();
    pet.end(200);
    expect(pet.contactHeld).toBe(false);
    pet.begin(300);
    pet.stroke(8, 320);
    expect(pet.timing()?.cap).toBe(12300);
    expect(pet.contactHeld).toBe(true);
    expect(pet.timing()?.cap).toBe(12300);
    pet.clear();
    expect(pet.contactHeld).toBe(false);
  });
  it('adds a readable local head tilt and downward gaze while preserving the cue and window-independent motion', () => {
    const frame = new ActingController().sample(0, 0);
    const pet = applyPetting(frame, 0.65);
    expect(pet.headZ - frame.headZ).toBeCloseTo(0.2275);
    expect(pet.gazeY - frame.gazeY).toBeCloseTo(-0.1625);
    expect(pet.smile).toBeCloseTo(0.5525);
    expect(pet.offsetY).toBe(frame.offsetY);
    expect(pet.breath).toBe(frame.breath);
    expect(pet.lean).toBeCloseTo(0.117);
    expect(pet.preset).toBe(frame.preset);
    expect(applyPetting(frame, 0)).toEqual(frame);
    const reduced = applyPetting(frame, 0.65 * 0.18);
    expect(reduced.headZ).toBeCloseTo(pet.headZ * 0.18);
    expect(reduced.gazeY).toBeCloseTo(pet.gazeY * 0.18);
    expect(reduced.lean).toBeCloseTo(pet.lean * 0.18);
    expect(applyPetting(frame, NaN)).toEqual(frame);
  });
  it('gives contact priority over an opposing torso roll and releases it continuously', () => {
    const base = new ActingController().sample(0, 0);
    for (const weight of [0.35, 0.65, 1]) {
      const frame = { ...base, bodyZ: -0.3 * weight };
      const pet = applyPetting(frame, weight);
      expect(pet.bodyZ).toBeGreaterThan(0);
      expect(pet.bodyZ).toBeLessThanOrEqual(0.3);
      expect(applyPetting(frame, 0)).toBe(frame);
      expect(applyPetting(frame, weight / 2).bodyZ).toBeLessThan(pet.bodyZ);
    }
  });

  it('blends direct contact posture without coupling independent canvas approach', () => {
    const frame = { ...new ActingController().sample(0, 0), lean: 0.6, approach: 0.02 };
    const partial = applyPetting(frame, 0.5);
    expect(partial.lean).toBe(0.6);
    expect(partial.approach).toBeCloseTo(0.1);
    const approaching = { ...frame, lean: -0.4, approach: 0.5 };
    const touched = applyPetting(approaching, 1);
    expect(touched.lean).toBeCloseTo(0.18);
    expect(touched.approach).toBe(0.5);
    const legacy = { ...frame, approach: undefined };
    expect(applyPetting(legacy, 1).approach).toBe(frame.lean);
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
      expect(pet.lean).toBeGreaterThan(frame.lean);
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
    for (const key of [
      'headX',
      'headY',
      'gazeX',
      'gazeY',
      'bodyX',
      'lean',
      'smile',
      'eyeSmile',
    ] as const)
      expect(Math.abs(tail[key] - frame[key])).toBeLessThan(0.00001);
    expect(at(1350)).toBe(frame);
  });
  it('approaches gently without overriding a stronger existing lean and releases to the original posture', () => {
    const frame = { ...new ActingController().sample(0, 0), lean: -0.12 };
    const touching = applyPetting(frame, 0.65);
    expect(touching.lean).toBeGreaterThan(0);
    expect(touching.lean).toBeLessThan(0.18);
    const stronger = { ...frame, lean: 0.45 };
    expect(applyPetting(stronger, 0.65).lean).toBe(stronger.lean);
    expect(applyPetting(frame, 0)).toBe(frame);
    expect(touching.offsetY).toBe(frame.offsetY);
    expect(touching.breath).toBe(frame.breath);
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

describe('shared direct-contact deadlines', () => {
  it('exposes the original inactivity/release/cap budget and does not refresh it on zero travel', () => {
    const pet = new PettingController();
    pet.begin(100);
    pet.stroke(3, 110);
    expect(pet.timing()).toBeUndefined();
    pet.stroke(6, 120);
    expect(pet.timing()).toEqual({ held: true, cap: 12100, deadline: 1020, freshUntil: 270 });
    for (let now = 130; now <= 1100; now += 10) pet.stroke(0, now);
    expect(pet.timing()?.deadline).toBe(1020);
    expect(pet.sample(1020)).toBe(0);
    pet.stroke(5, 2000);
    expect(pet.timing()?.deadline).toBe(2900);
    pet.end(2100);
    expect(pet.timing()).toMatchObject({ held: false, deadline: 3150, cap: 12100 });
    pet.end(2300);
    expect(pet.timing()?.deadline).toBe(3150);
    pet.clear();
    expect(pet.timing()).toBeUndefined();
  });
});

describe('bounded release carry on physical recontact', () => {
  function released() {
    const pet = new PettingController();
    pet.begin(0);
    pet.stroke(10, 20);
    pet.end(300);
    return pet;
  }
  it('preserves one old release curve unchanged across repeated no-stroke begin/end cycles', () => {
    const reference = released(),
      pet = released();
    for (const now of [500, 510, 700, 900, 1200]) {
      const before = pet.sample(now);
      pet.begin(now);
      expect(pet.sample(now)).toBe(before);
      pet.end(now + 1);
      for (const future of [now + 1, 1300, 1349, 1350, 2000])
        expect(pet.sample(future)).toBe(reference.sample(future));
    }
    expect(pet.sample(1350)).toBe(0);
    pet.begin(2000);
    expect(pet.sample(2000)).toBe(0);
  });
  it('gives new valid travel its own budget while retaining the stronger immutable release only', () => {
    const pet = released();
    pet.begin(600);
    expect(pet.timing()).toBeUndefined();
    pet.stroke(3, 610);
    expect(pet.timing()).toBeUndefined();
    pet.stroke(5, 620);
    expect(pet.timing()?.cap).toBe(12600);
    expect(pet.sample(600)).toBeGreaterThan(0);
    pet.end(900);
    const own = new PettingController();
    own.begin(600);
    own.stroke(8, 620);
    own.end(900);
    pet.begin(901); // the new own release is stronger; keep its original900..1950 curve
    for (const at of [901, 1200, 1500, 1949, 1950]) expect(pet.sample(at)).toBe(own.sample(at));
    pet.end(902);
    pet.begin(903);
    expect(pet.sample(1950)).toBe(0);
  });
  it('keeps the older deadline on equal-strength releases instead of stacking or extending them', () => {
    const pet = new PettingController();
    pet.begin(0);
    pet.stroke(10, 20);
    pet.end(250);
    pet.begin(251);
    pet.stroke(8, 252);
    expect(pet.sample(450)).toBe(1);
    pet.end(450);
    pet.begin(451);
    expect(pet.sample(451)).toBe(1);
    expect(pet.sample(1300)).toBe(0); // older250..1300 wins the tie over450..1500
  });
  it('keeps the old twelve-second cap on no-stroke recontact and clears both contributions globally', () => {
    const pet = new PettingController();
    pet.begin(0);
    for (let now = 20; now <= 11820; now += 200) pet.stroke(10, now);
    pet.end(11900);
    const before = pet.sample(11901);
    pet.begin(11901);
    expect(pet.sample(11901)).toBe(before);
    pet.end(11902);
    pet.begin(11903);
    expect(pet.sample(12000)).toBe(0);
    pet.stroke(8, 12010);
    expect(pet.timing()?.cap).toBe(23903);
    expect(pet.sample(12300)).toBeGreaterThan(0);
    pet.clear();
    expect(pet.sample(12300)).toBe(0);
    expect(pet.timing()).toBeUndefined();
  });
});
