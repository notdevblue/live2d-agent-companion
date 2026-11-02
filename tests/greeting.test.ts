import { describe, expect, it } from 'vitest';
import { greetingValues, handAttentionValues } from '../src/renderer/greeting.js';
import { PoseSequence, type ParameterRange, type PoseFrame } from '../src/renderer/performance.js';

const definition = {
  enter: '默认手切举手',
  exit: '举手切默认手',
  parameter: 'Movement2',
  enterMs: 1133,
  exitMs: 1017,
};
const parameters = new Map<string, ParameterRange>(
  ['Movement2', 'Param62', 'Param59', 'Param60', 'Param61'].map((id, index) => [
    id,
    { index, min: -1, max: 1, neutral: 0 },
  ]),
);
const frame = (phase: PoseFrame['phase'], timeMs = 0): PoseFrame => ({ phase, timeMs, definition });
const sample = (pose: PoseFrame, intensity = 1) =>
  greetingValues(pose, parameters, new Set(), () => 0, intensity);

describe('verified authored-input greeting', () => {
  it('preserves the real entry until its open-palm sample and never writes the pose selector', () => {
    expect(sample(frame('enter', 499))).toEqual(new Map());
    expect(Object.fromEntries(sample(frame('enter', 500)))).toEqual({
      1: 0.02451229,
      2: 0.34098039,
      3: 0.52561809,
      4: 0.11307809,
    });
    expect(sample(frame('enter', 500)).has(0)).toBe(false);
  });
  it('keeps entry-to-hold continuous while doing three finite sweeps and resting on the palm', () => {
    expect(sample(frame('enter', 1133))).toEqual(sample(frame('hold', 0)));
    const palm = sample(frame('hold', 2500));
    expect(sample(frame('enter', 675))).not.toEqual(palm);
    expect(sample(frame('enter', 1025))).not.toEqual(palm);
    expect(sample(frame('hold', 1467))).toEqual(palm);
    expect(sample(frame('hold', 12000))).toEqual(palm);
    expect(sample(frame('hold', 1467), 0)).toEqual(palm);
  });
  it('joins the evaluated authored exit continuously and yields before its selector switches', () => {
    const palm = sample(frame('hold', 12000));
    expect(sample(frame('exit', 0))).toEqual(palm);
    for (const [index, value] of sample(frame('exit', 150)))
      expect(value).toBeCloseTo(palm.get(index)! * 0.5);
    for (const value of sample(frame('exit', 299)).values())
      expect(Math.abs(value)).toBeLessThan(0.00002);
    expect(sample(frame('exit', 300))).toEqual(new Map());
    expect(sample(frame('none'))).toEqual(new Map());
  });
  it('preserves custom mappings and rejects unsupported or physics-owned controls as a complete group', () => {
    const pose = frame('hold', 100);
    expect(sample({ ...pose, definition: { ...definition, enter: 'custom-wave' } })).toEqual(
      new Map(),
    );
    expect(sample({ ...pose, definition: { ...definition, parameter: 'Other' } })).toEqual(
      new Map(),
    );
    for (const id of parameters.keys()) {
      expect(greetingValues(pose, parameters, new Set([id]), () => 0)).toEqual(new Map());
      const missing = new Map(parameters);
      missing.delete(id);
      expect(greetingValues(pose, missing, new Set(), () => 0)).toEqual(new Map());
    }
  });
  it('clamps safe joint sweeps to rig bounds and normalizes invalid intensity and time', () => {
    const limited = new Map(parameters);
    limited.set('Param61', { index: 4, min: 0.1, max: 0.12, neutral: 0.11 });
    const pose = frame('enter', 675);
    expect(greetingValues(pose, limited, new Set(), () => 0).get(4)).toBe(0.12);
    expect(sample(pose, NaN)).toEqual(sample(pose, 0));
    expect(sample(pose, Infinity)).toEqual(sample(pose, 0));
    expect(sample(frame('hold', NaN))).toEqual(new Map());
    expect(sample(frame('hold', -1))).toEqual(new Map());
    expect(greetingValues(frame('exit', 150), parameters, new Set(), () => NaN)).toEqual(new Map());
  });
});

describe('finite authored hand attention', () => {
  const all = new Map(parameters);
  for (const [index, id] of ['Movement3', 'Param36', 'Param41', 'Param42'].entries())
    all.set(id, { index: index + 5, min: -1, max: 1, neutral: 0 });
  const explain = {
    enter: '竖手指切出来动画',
    exit: '竖手指切回默认',
    parameter: 'Movement3',
    enterMs: 1250,
    exitMs: 1250,
  };
  const held = (age: number, def = definition): PoseFrame => ({
    phase: 'hold',
    definition: def,
    timeMs: age - def.enterMs,
  });
  const sampleAttention = (age: number, def = definition, intensity = 0.65) =>
    handAttentionValues(held(age, def), all, new Set(), () => 0.2, intensity);

  it('settles to a lower hold and returns partway toward the raised hand twice', () => {
    expect(sampleAttention(2500)).toEqual(new Map());
    const entering = sampleAttention(3000),
      rest = sampleAttention(8000),
      first = sampleAttention(5500),
      second = sampleAttention(10000);
    expect(rest.size).toBe(1);
    for (const [index, value] of rest) {
      expect(entering.get(index)).toBeGreaterThan(value);
      expect(entering.get(index)).toBeLessThan(0.2);
      expect(first.get(index)).toBeGreaterThan(value);
      expect(first.get(index)).toBeLessThan(0.2);
      expect(second.get(index)).toBeGreaterThan(value);
      expect(second.get(index)).toBeLessThan(first.get(index)!);
    }
    expect(sampleAttention(3500)).toEqual(rest);
    expect(sampleAttention(11250)).toEqual(rest);
    expect(sampleAttention(15000)).toEqual(rest);
  });
  it('gives the explain hand one finite early point without touching selectors or fingers', () => {
    const index = all.get('Param41')!.index;
    expect(sampleAttention(2000, explain)).toEqual(new Map());
    const lift = sampleAttention(2500, explain);
    expect([...lift.keys()]).toEqual([index]);
    expect(lift.get(index)).toBeGreaterThan(0.2);
    for (const time of [2900, 2950, 3000, 3200]) {
      const lowered = sampleAttention(time, explain).get(index)!;
      expect(lowered).toBeLessThan(0.2);
      expect(lowered).toBeGreaterThan(0.1);
    }
    const reduced = sampleAttention(2500, explain, 0.65 * 0.18).get(index)!;
    expect(reduced - 0.2).toBeCloseTo((lift.get(index)! - 0.2) * 0.18, 7);
    expect(sampleAttention(2500, explain, 0)).toEqual(new Map());
  });

  it('joins early and mid-accent returns from the actual last held overlay without a pop', () => {
    for (const age of [1650, 2350, 2500, 2750, 2950, 3500, 5700, 10200]) {
      const sequence = new PoseSequence();
      sequence.start(explain, 0, age - explain.enterMs);
      const sample = (at: number) =>
        handAttentionValues(sequence.sample(at), all, new Set(), () => 0.2, 0.65).get(
          all.get('Param41')!.index,
        ) ?? 0.2;
      const before = sample(age - 0.001),
        first = sample(age);
      expect(Math.abs(first - before)).toBeLessThan(0.000001);
      const midway = sample(age + 150);
      expect(Math.abs(midway - 0.2)).toBeLessThanOrEqual(Math.abs(first - 0.2));
      expect(sample(age + 300)).toBe(0.2);
    }
  });

  it('joins the original exit smoothly within its first three hundred milliseconds', () => {
    for (const def of [definition, explain]) {
      const rest = sampleAttention(8000, def);
      const exit = (timeMs: number) =>
        handAttentionValues(
          { phase: 'exit', definition: def, timeMs },
          all,
          new Set(),
          () => 0.2,
          0.65,
        );
      expect(exit(0)).toEqual(rest);
      for (const [index, value] of rest) {
        expect(exit(150).get(index)).toBeGreaterThan(value);
        expect(exit(150).get(index)).toBeLessThan(0.2);
        expect(exit(1).get(index)).toBeCloseTo(value, 5);
      }
      expect(exit(300)).toEqual(new Map());
      expect(exit(500)).toEqual(new Map());
    }
  });
  it('moves only the verified authored arm/wrist inputs for each pair, never selectors or fingers', () => {
    expect([...sampleAttention(5500).keys()]).toEqual(['Param62'].map((id) => all.get(id)!.index));
    expect([...sampleAttention(5500, explain).keys()]).toEqual(
      ['Param41'].map((id) => all.get(id)!.index),
    );
    expect(sampleAttention(5500).has(all.get('Movement2')!.index)).toBe(false);
    expect(sampleAttention(5500, explain).has(all.get('Movement3')!.index)).toBe(false);
  });
  it('preserves custom mappings and skips a whole phrase if any required input is missing or a physics output', () => {
    expect(sampleAttention(5500, { ...explain, enter: 'custom' })).toEqual(new Map());
    for (const def of [definition, explain]) {
      const ids =
        def === definition
          ? ['Movement2', 'Param62', 'Param59', 'Param60', 'Param61']
          : ['Movement3', 'Param36', 'Param41', 'Param42'];
      for (const id of ids) {
        expect(handAttentionValues(held(5500, def), all, new Set([id]), () => 0.2)).toEqual(
          new Map(),
        );
        const missing = new Map(all);
        missing.delete(id);
        expect(handAttentionValues(held(5500, def), missing, new Set(), () => 0.2)).toEqual(
          new Map(),
        );
      }
    }
  });
  it('scales and bounds current-frame inputs without accumulation or invalid numbers', () => {
    expect(sampleAttention(5500, explain, 0)).toEqual(new Map());
    expect(sampleAttention(5500, explain, NaN)).toEqual(new Map());
    const limits = new Map(all);
    limits.set('Param41', { index: 7, min: 0, max: 0.21, neutral: 0.1 });
    expect(handAttentionValues(held(5500, explain), limits, new Set(), () => 0.01).get(7)).toBe(0);
    expect(handAttentionValues(held(5500, explain), all, new Set(), () => NaN)).toEqual(new Map());
    expect(sampleAttention(5500)).toEqual(sampleAttention(5500));
    expect(
      handAttentionValues({ ...held(5500), timeMs: Infinity }, all, new Set(), () => 0.2),
    ).toEqual(new Map());
  });
});
