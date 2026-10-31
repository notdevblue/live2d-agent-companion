import { describe, expect, it } from 'vitest';
import {
  actingChannels,
  expressionValues,
  ExpressionMixer,
  parameterValue,
  surprisedExpression,
  motionEndpoints,
  PoseSequence,
} from '../src/renderer/performance.js';

describe('model performance composition', () => {
  it('builds a surprised face within asymmetric rig ranges, skipping absent and physics output controls', () => {
    const parameters = new Map([
      ['ParamBrowRY', { index: 1, min: -3, max: 7, neutral: 2 }],
      ['ParamEyeROpen', { index: 2, min: 0, max: 1.5, neutral: 1 }],
      ['ParamEyeLOpen', { index: 3, min: 0, max: 1, neutral: 1 }],
    ]);
    expect(surprisedExpression(parameters, new Set(['ParamEyeLOpen']))).toEqual([
      { index: 1, value: 4.75, blend: 'Overwrite' },
      { index: 2, value: 1.375, blend: 'Overwrite' },
    ]);
    expect(surprisedExpression(new Map(), new Set())).toEqual([]);
  });
  it('crossfades exclusive eye expressions without a neutral gap or accumulated Add', () => {
    const mixer = new ExpressionMixer();
    const happy = [{ index: 1, value: 1, blend: 'Add' as const }];
    const shy = [{ index: 2, value: 1, blend: 'Add' as const }];
    mixer.transition('happy', happy, 0);
    mixer.transition('shy', shy, 1000);
    expect(expressionValues(mixer.sample(1000), () => 0).get(1)).toBe(1);
    const values = expressionValues(mixer.sample(1120), () => 0);
    expect(values.get(1)).toBeCloseTo(0.5);
    expect(values.get(2)).toBeCloseTo(0.5);
    expect(expressionValues(mixer.sample(1240), () => 0).get(2)).toBe(1);
    expect(mixer.sample(5300)).toEqual([]);
  });
  it('keeps rapid retargeting continuous and stops all expressions on blocked reset', () => {
    const mixer = new ExpressionMixer();
    const param = [{ index: 1, value: 1, blend: 'Add' as const }];
    mixer.transition('a', param, 0);
    const before = mixer.sample(120);
    mixer.transition('b', param, 120);
    expect(expressionValues(mixer.sample(120), () => 0)).toEqual(expressionValues(before, () => 0));
    mixer.clear(150, true);
    expect(mixer.sample(150)).toEqual([]);
  });
  it('combines Multiply and Overwrite against a stable model baseline', () => {
    expect(
      expressionValues(
        [
          { name: 'a', parameters: [{ index: 1, value: 2, blend: 'Multiply' }], weight: 0.5 },
          { name: 'b', parameters: [{ index: 1, value: 0, blend: 'Overwrite' }], weight: 0.5 },
        ],
        () => 4,
      ).get(1),
    ).toBe(4);
  });
  it('selects upstream head controls and never writes authored physics outputs', () => {
    const parameters = new Map(
      ['AngleZ', 'ParamAngleZ', 'ParamBodyAngleY', 'ParamEyeBallX'].map((id, index) => [
        id,
        { index, min: -30, max: 30, neutral: 0 },
      ]),
    );
    const channels = actingChannels(parameters, new Set(['ParamAngleZ', 'ParamBodyAngleY']));
    expect(channels.headZ?.index).toBe(0);
    expect(channels.bodyY).toBeUndefined();
    expect(channels.gazeX?.index).toBe(3);
    expect(actingChannels(new Map(), new Set())).toEqual({});
  });
  it('uses runtime neutral and asymmetric bounds; nonfinite commands return neutral', () => {
    const range = { index: 0, min: -10, max: 30, neutral: 5 };
    expect(parameterValue(range, -0.5)).toBe(-2.5);
    expect(parameterValue(range, 0.5)).toBe(17.5);
    expect(parameterValue(range, 100)).toBe(30);
    expect(parameterValue(range, NaN)).toBe(5);
  });
  it('retains the full authored hand pose including wrist angles during hold', () => {
    const held = motionEndpoints([
      { Target: 'Parameter', Id: 'Movement3', Segments: [0, 0, 0, 1.25, 1] },
      { Target: 'Parameter', Id: 'Wrist', Segments: [0, 0, 0, 1.25, 0.7] },
      { Target: 'Parameter', Id: 'Palm', Segments: [0, 0, 0, 1.25, 0.32] },
      { Target: 'Model', Id: 'Opacity', Segments: [0, 1] },
      { Target: 'Parameter', Id: 'Invalid' },
    ]);
    expect(Object.fromEntries(held)).toEqual({ Movement3: 1, Wrist: 0.7, Palm: 0.32 });
  });
  it('holds a pose then uses the authored reciprocal clip before releasing', () => {
    const poses = new PoseSequence();
    const def = {
      enter: 'point',
      exit: 'return',
      parameter: 'Movement3',
      enterMs: 1250,
      exitMs: 1250,
    };
    expect(poses.start(def, 0)).toBe(true);
    expect(poses.sample(1200).phase).toBe('enter');
    expect(poses.sample(2000).phase).toBe('hold');
    expect(poses.start(def, 2000)).toBe(false);
    expect(poses.sample(2800)).toMatchObject({ phase: 'exit', definition: def, timeMs: 50 });
    expect(poses.sample(4000).phase).toBe('none');
    poses.start(def, 5000);
    poses.clear();
    expect(poses.sample(5100).phase).toBe('none');
  });
});
