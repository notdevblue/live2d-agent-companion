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
  it('raises a folded arm from neutral into the same palm at the entry/hold boundary', () => {
    expect([...sample(frame('enter', 0)).values()]).toEqual([0, 0, 0, 0]);
    const middle = sample(frame('enter', definition.enterMs / 2));
    const palm = sample(frame('hold', 0));
    expect(middle.get(1)!).toBeLessThan(palm.get(1)!);
    expect(middle.get(3)!).toBeGreaterThan(0);
    expect(middle.get(3)!).toBeLessThan(palm.get(3)!);
    expect(palm.get(1)!).toBeLessThan(-0.4);
    expect(palm.get(3)!).toBeGreaterThan(0.65);
    expect(sample(frame('enter', definition.enterMs))).toEqual(palm);
    expect([...palm.keys()]).toEqual([1, 2, 3, 4]);
  });
  it('uses two finite wrist-led sweeps, then keeps a quiet palm without repeating them', () => {
    const wrist = sample(frame('hold', 0)).get(4)!;
    let positive = 0,
      negative = 0,
      wasPositive = false,
      wasNegative = false;
    const spans = new Map<number, number[]>();
    for (let time = 0; time <= 1500; time += 10) {
      const values = sample(frame('hold', time));
      const delta = values.get(4)! - wrist;
      const up = delta > 0.001,
        down = delta < -0.001;
      if (up && !wasPositive) positive++;
      if (down && !wasNegative) negative++;
      wasPositive = up;
      wasNegative = down;
      for (const [index, value] of values) {
        const span = spans.get(index) ?? [];
        span.push(value);
        spans.set(index, span);
      }
    }
    const travel = (index: number) =>
      Math.max(...spans.get(index)!) - Math.min(...spans.get(index)!);
    expect(positive).toBe(2);
    expect(negative).toBe(2);
    expect(travel(4)).toBeGreaterThan(travel(1) * 3);
    expect(travel(4)).toBeGreaterThan(travel(3) * 5);
    for (const time of [1200, 2000, 8000, 12000])
      expect(sample(frame('hold', time)).get(4)).toBe(wrist);
    expect(sample(frame('hold', 150), 0).get(4)).toBe(wrist);
  });
  it('returns from the actual hold age, including a short hold interrupted mid-sweep', () => {
    const authored = new Map([
      [1, -0.001],
      [2, -0.001],
      [3, 0],
      [4, 0.001],
    ]);
    for (const heldMs of [400, 900, 1500, 3500, 5500, 10000]) {
      const values = (timeMs: number) =>
        greetingValues(
          { ...frame('exit', timeMs), heldMs },
          parameters,
          new Set(),
          (index) => authored.get(index)!,
          1,
        );
      for (const [index, value] of sample(frame('hold', heldMs - 0.001)))
        expect(values(0).get(index)).toBeCloseTo(value, 5);
      expect(values(400).get(1)!).toBeLessThan(-0.8);
      for (const [index, value] of authored)
        expect(values(definition.exitMs).get(index)).toBeCloseTo(value, 8);
      for (const value of values(750).values()) expect(Number.isFinite(value)).toBe(true);
    }
    expect(sample(frame('none'))).toEqual(new Map());
    expect(sample({ ...frame('exit', 100), reverseEntry: true })).toEqual(new Map());
  });
  it('lowers the shoulder early in a short return without delaying elbow recovery', () => {
    for (const heldMs of [400, 1500, 2050]) {
      const lowering = sample({ ...frame('exit', definition.exitMs * 0.4), heldMs });
      expect(lowering.get(1)).toBeCloseTo(-0.9, 8);
      const returned = sample({ ...frame('exit', definition.exitMs * 0.75), heldMs });
      expect(returned.get(3)).toBeCloseTo(0, 8);
      const early = sample({ ...frame('exit', 1), heldMs });
      for (const [index, value] of sample(frame('hold', heldMs)))
        expect(early.get(index)).toBeCloseTo(value, 4);
    }
  });

  it('unfolds to the verified exit endpoints instead of chasing a moving return clip', () => {
    const endpoints = new Map([
      ['Param62', -0.001],
      ['Param59', -0.001],
      ['Param60', 0],
      ['Param61', 0.001],
    ]);
    const returned = greetingValues(
      { ...frame('exit', definition.exitMs * 0.75), heldMs: 1500 },
      parameters,
      new Set(),
      () => 0.8,
      1,
      endpoints,
    );
    expect(returned.get(3)).toBeCloseTo(0, 8);
    expect(returned.get(1)!).toBeLessThan(0);
    expect(returned.get(1)!).toBeGreaterThan(-0.2);
    endpoints.delete('Param60');
    expect(
      greetingValues(
        { ...frame('exit', 100), heldMs: 1500 },
        parameters,
        new Set(),
        () => 0.8,
        1,
        endpoints,
      ),
    ).toEqual(new Map());
  });
  it('preserves custom and changed clips and rejects unavailable or physics-owned inputs as a group', () => {
    const pose = frame('hold', 100);
    for (const change of [
      { enter: 'custom-wave' },
      { parameter: 'Other' },
      { enterMs: 1200 },
      { exitMs: 1100 },
    ])
      expect(sample({ ...pose, definition: { ...definition, ...change } })).toEqual(new Map());
    for (const id of parameters.keys()) {
      expect(greetingValues(pose, parameters, new Set([id]), () => 0)).toEqual(new Map());
      const missing = new Map(parameters);
      missing.delete(id);
      expect(greetingValues(pose, missing, new Set(), () => 0)).toEqual(new Map());
    }
    const limited = new Map(parameters);
    limited.set('Param62', { index: 1, min: -0.5, max: 1, neutral: 0 });
    expect(greetingValues(pose, limited, new Set(), () => 0)).toEqual(new Map());
  });
  it('bounds the joints, scales wrist motion and rejects invalid time or authored samples', () => {
    const full = sample(frame('hold', 150), 1),
      quiet = sample(frame('hold', 150), 0.35),
      still = sample(frame('hold', 150), 0);
    expect(quiet.get(4)! - still.get(4)!).toBeCloseTo((full.get(4)! - still.get(4)!) * 0.35, 8);
    for (const phase of ['enter', 'hold', 'exit'] as const)
      for (let time = 0; time <= 12000; time += 50)
        for (const value of sample(frame(phase, time)).values())
          (expect(value).toBeGreaterThanOrEqual(-1), expect(value).toBeLessThanOrEqual(1));
    expect(sample(frame('hold', 150), NaN)).toEqual(still);
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
  it('avoids a second greeting writer while preserving the legacy custom-pair fallback', () => {
    const pose = held(5500);
    expect(handAttentionValues(pose, all, new Set(), () => 0.2, 0.65, true)).toEqual(new Map());
    expect(handAttentionValues(pose, all, new Set(), () => 0.2, 0.65, false).size).toBe(1);
    expect(handAttentionValues(held(5500, explain), all, new Set(), () => 0.2, 0.65, true)).toEqual(
      handAttentionValues(held(5500, explain), all, new Set(), () => 0.2, 0.65, false),
    );
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
