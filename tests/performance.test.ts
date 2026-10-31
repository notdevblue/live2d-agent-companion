import { describe, expect, it } from 'vitest';
import {
  actingChannels,
  expressionValues,
  ExpressionMixer,
  parameterValue,
  facialValues,
  type FaceFrame,
  surprisedExpression,
  motionEndpoints,
  PoseSequence,
} from '../src/renderer/performance.js';

describe('model performance composition', () => {
  const face: FaceFrame = {
    eyeL: 1,
    eyeR: 1,
    eyeSmile: 0,
    browY: 0,
    browInner: 0,
    pout: 0,
    cheek: 0,
  };
  it('keeps left and right eyelids independent and facial inputs within asymmetric rig ranges', () => {
    const parameters = new Map([
      ['ParamEyeLOpen', { index: 1, min: 0, max: 1.5, neutral: 1 }],
      ['ParamEyeROpen', { index: 2, min: 0, max: 1.2, neutral: 0.8 }],
      ['EyeSmile', { index: 3, min: -1, max: 1, neutral: 0 }],
      ['ParamBrowLY', { index: 4, min: -2, max: 4, neutral: 1 }],
      ['ParamBrowRY', { index: 5, min: -1, max: 3, neutral: 0 }],
      ['BrowInnerUp', { index: 6, min: 0, max: 2, neutral: 0 }],
      ['Mouthpucker', { index: 7, min: -2, max: 6, neutral: 2 }],
      ['CheeckPuff', { index: 8, min: 0, max: 1, neutral: 0 }],
    ]);
    const values = facialValues(
      {
        ...face,
        eyeL: 0,
        eyeR: 1.5,
        eyeSmile: 0.4,
        browY: -0.5,
        browInner: 0.3,
        pout: 2,
        cheek: -1,
      },
      parameters,
      new Set(),
    );
    expect(Object.fromEntries(values)).toEqual({
      1: 0,
      2: 1.2,
      3: 0.4,
      4: -0.5,
      5: -0.5,
      6: 0.6,
      7: 6,
      8: 0,
    });
  });
  it('does not overwrite authored facial animation or physics outputs and tolerates missing controls', () => {
    const parameters = new Map([
      ['ParamEyeLOpen', { index: 1, min: 0, max: 1.5, neutral: 1 }],
      ['ParamEyeROpen', { index: 2, min: 0, max: 1.5, neutral: 1 }],
      ['ParamBrowRY', { index: 3, min: -1, max: 1, neutral: 0 }],
      ['CheeckPuff', { index: 4, min: 0, max: 1, neutral: 0 }],
    ]);
    const values = facialValues(
      { ...face, eyeL: 0, eyeR: 0.5, browY: 1, cheek: 0.8 },
      parameters,
      new Set(['ParamBrowRY']),
      new Set(['ParamEyeLOpen', 'CheeckPuff']),
    );
    expect(Object.fromEntries(values)).toEqual({ 2: 0.5 });
    expect(facialValues(face, new Map(), new Set())).toEqual(new Map());
  });
  it('prefers the shared eye smile input and falls back to independent supported eye smile controls', () => {
    const parameters = new Map([
      ['EyeSmile', { index: 1, min: -1, max: 1, neutral: 0 }],
      ['ParamEyeLSmile', { index: 2, min: 0, max: 2, neutral: 0 }],
      ['ParamEyeRSmile', { index: 3, min: 0, max: 1, neutral: 0 }],
    ]);
    expect(
      Object.fromEntries(facialValues({ ...face, eyeSmile: 0.5 }, parameters, new Set())),
    ).toEqual({ 1: 0.5 });
    expect(
      Object.fromEntries(
        facialValues(
          { ...face, eyeSmile: 0.5 },
          parameters,
          new Set(['EyeSmile']),
          new Set(['ParamEyeLSmile']),
        ),
      ),
    ).toEqual({ 3: 0.5 });
  });
  it('uses neutral for nonfinite commands and clamps eyelid ratios and one-sided inputs', () => {
    const parameters = new Map([
      ['ParamEyeLOpen', { index: 1, min: 0.2, max: 2, neutral: 1 }],
      ['ParamEyeROpen', { index: 2, min: 0, max: 1.5, neutral: 0.8 }],
      ['ParamBrowLY', { index: 3, min: -2, max: 4, neutral: 1 }],
      ['EyeSmile', { index: 4, min: -1, max: 1, neutral: 0 }],
    ]);
    expect(
      Object.fromEntries(
        facialValues(
          { ...face, eyeL: 10, eyeR: -2, browY: NaN, eyeSmile: -1 },
          parameters,
          new Set(),
        ),
      ),
    ).toEqual({ 1: 1.5, 2: 0, 3: 1, 4: 0 });
    expect(
      Object.fromEntries(
        facialValues(
          { ...face, eyeL: NaN, eyeR: Infinity, browY: Infinity, eyeSmile: NaN },
          parameters,
          new Set(),
        ),
      ),
    ).toEqual({ 1: 1, 2: 0.8, 3: 1, 4: 0 });
  });
  it('builds a surprised face within asymmetric rig ranges, skipping absent and physics output controls', () => {
    const parameters = new Map([
      ['ParamBrowRY', { index: 1, min: -3, max: 7, neutral: 2 }],
      ['ParamEyeROpen', { index: 2, min: 0, max: 1.5, neutral: 1 }],
      ['ParamEyeLOpen', { index: 3, min: 0, max: 1, neutral: 1 }],
    ]);
    expect(surprisedExpression(parameters, new Set(['ParamEyeLOpen']))).toEqual([
      { index: 1, value: 4.75, blend: 'Overwrite' },
      { index: 2, value: 1.375, blend: 'Multiply' },
    ]);
    expect(surprisedExpression(new Map(), new Set())).toEqual([]);
  });
  it('widens surprised eyes without reopening a blink and skips a zero neutral eyelid', () => {
    const parameters = new Map([
      ['ParamEyeROpen', { index: 1, min: 0, max: 1.5, neutral: 1 }],
      ['ParamEyeLOpen', { index: 2, min: 0, max: 1, neutral: 0 }],
    ]);
    const expression = surprisedExpression(parameters, new Set());
    expect(expression).toHaveLength(1);
    const layers = [{ name: 'surprised', parameters: expression, weight: 1 }];
    expect(expressionValues(layers, () => 0).get(1)).toBe(0);
    expect(expressionValues(layers, () => 0.4).get(1)).toBeCloseTo(0.55);
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
