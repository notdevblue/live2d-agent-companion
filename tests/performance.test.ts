import { describe, expect, it } from 'vitest';
import {
  actingChannels,
  expressionValues,
  selectEyeArtwork,
  ExpressionMixer,
  parameterValue,
  facialValues,
  type FaceFrame,
  surprisedExpression,
  motionEndpoints,
  chestArmReturn,
  PoseSequence,
} from '../src/renderer/performance.js';

describe('model performance composition', () => {
  it('keeps one eye drawing through rapid three-way crossfades without reviving weak expired art', () => {
    const mixer = new ExpressionMixer();
    const targets = (name: string, index: number) => [
      { name: `${name}:eyes`, parameters: [{ index, value: 1, blend: 'Add' as const }] },
    ];
    mixer.transitionMany(targets('a', 3), 0);
    mixer.transitionMany(targets('b', 4), 1000);
    mixer.transitionMany(targets('c', 5), 1080);
    const raw = mixer.sample(1180);
    expect(raw.every((layer) => layer.weight < 0.5)).toBe(true);
    const selected = selectEyeArtwork(raw, new Set([3, 4, 5]));
    expect(selected).toHaveLength(1);
    expect(selected[0]!.weight).toBe(1);
    expect(
      selectEyeArtwork(
        raw.map((layer) => ({ ...layer, weight: 0.1 })),
        new Set([3, 4, 5]),
      ),
    ).toEqual([]);
  });
  it('switches special eye drawings without gray ghost eyes or overlapping shapes', () => {
    const eye = (name: string, index: number, weight: number) => ({
      name: `${name}:eyes`,
      parameters: [{ index, value: 1, blend: 'Add' as const }],
      weight,
    });
    const marking = { ...eye('blush', 7, 0.35), name: 'blush:markings' };
    const ids = new Set([3, 4]);
    expect(selectEyeArtwork([eye('old', 3, 0.6), eye('new', 4, 0.4), marking], ids)).toEqual([
      eye('old', 3, 1),
      marking,
    ]);
    expect(selectEyeArtwork([eye('old', 3, 0.5), eye('new', 4, 0.5), marking], ids)).toEqual([
      eye('new', 4, 1),
      marking,
    ]);
    expect(selectEyeArtwork([eye('new', 4, 0.49), marking], ids)).toEqual([marking]);
    const custom = eye('custom', 4, 1);
    custom.parameters[0]!.value = 0.7;
    expect(selectEyeArtwork([custom], ids)).toEqual([custom]);
  });
  it('expires short eye accents independently while blush and the semantic afterglow remain', () => {
    const mixer = new ExpressionMixer();
    mixer.transitionMany(
      [
        {
          name: 'eyes',
          parameters: [{ index: 5, value: 1, blend: 'Add' }],
          durationMs: 1200,
          fadeOutMs: 400,
          afterglowWeight: 0,
        },
        { name: 'blush', parameters: [{ index: 7, value: 1, blend: 'Add' }] },
      ],
      0,
      3600,
      { afterglowMs: 12000, afterglowWeight: 0.4 },
    );
    expect(mixer.sample(700).map((l) => l.name)).toEqual(['eyes', 'blush']);
    expect(mixer.sample(1000).find((l) => l.name === 'eyes')?.weight).toBeCloseTo(0.5);
    expect(mixer.sample(1400).map((l) => l.name)).toEqual(['blush']);
    expect(mixer.sample(8000, 0.65)).toMatchObject([{ name: 'blush', weight: 0.26 }]);
    expect(mixer.sample(15600)).toEqual([]);
    mixer.clear(8000, true);
    expect(mixer.sample(8000)).toEqual([]);
  });
  it('keeps short-layer expiry independent of sample cadence and clamps invalid local timing', () => {
    const outputs = [];
    for (const fps of [30, 60, 120]) {
      const mixer = new ExpressionMixer();
      mixer.transitionMany(
        [
          {
            name: 'eye',
            parameters: [{ index: 3, value: 1, blend: 'Add' }],
            durationMs: 1400,
            fadeOutMs: 400,
          },
        ],
        0,
        4200,
      );
      for (let n = 0; n < fps; n++) mixer.sample((n * 1000) / fps);
      outputs.push(mixer.sample(1200));
      expect(mixer.sample(1400)).toEqual([]);
    }
    expect(outputs[0]).toEqual(outputs[1]);
    expect(outputs[1]).toEqual(outputs[2]);
    const mixer = new ExpressionMixer();
    mixer.transitionMany(
      [
        {
          name: 'eye',
          parameters: [{ index: 3, value: 1, blend: 'Add' }],
          durationMs: Infinity,
          fadeOutMs: NaN,
        },
      ],
      0,
      4200,
    );
    expect(mixer.sample(1000)).toMatchObject([{ name: 'eye', weight: 1 }]);
    expect(mixer.sample(4200)).toEqual([]);
  });
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
  it('composes independent eye and multiple marking layers and crossfades every layer', () => {
    const mixer = new ExpressionMixer();
    const target = (name: string, index: number) => ({
      name,
      parameters: [{ index, value: 1, blend: 'Add' as const }],
    });
    // Avatar selects one key3/4/5/6 eye target independently from key2/7/13 marks.
    mixer.transitionMany(
      [target('eyes', 3), target('tears', 2), target('blush', 7), target('sweat', 13)],
      0,
    );
    const first = expressionValues(mixer.sample(1000), () => 0);
    expect(Object.fromEntries(first)).toEqual({ 2: 1, 3: 1, 7: 1, 13: 1 });
    mixer.transitionMany([target('new-eyes', 6), target('blush', 7)], 1000);
    expect(expressionValues(mixer.sample(1000), () => 0)).toEqual(first);
    expect(Object.fromEntries(expressionValues(mixer.sample(1120), () => 0))).toEqual({
      2: 0.5,
      3: 0.5,
      6: 0.5,
      7: 1,
      13: 0.5,
    });
    expect(Object.fromEntries(expressionValues(mixer.sample(1240), () => 0))).toEqual({
      6: 1,
      7: 1,
    });
    expect(mixer.sample(5200)).toEqual([]);
  });
  it('keeps optional marking afterglow bounded while eye art can expire at the emphasis end', () => {
    const mixer = new ExpressionMixer();
    mixer.transitionMany(
      [
        {
          name: 'eye',
          parameters: [{ index: 3, value: 1, blend: 'Add' }],
          afterglowWeight: 0,
        },
        { name: 'blush', parameters: [{ index: 7, value: 1, blend: 'Add' }], weight: 0.8 },
      ],
      0,
      4200,
      { afterglowMs: 50000, afterglowWeight: 0.4 },
    );
    expect(expressionValues(mixer.sample(1000), () => 0).get(7)).toBe(0.8);
    const sustained = expressionValues(mixer.sample(4200), () => 0);
    expect(sustained.has(3)).toBe(false);
    expect(sustained.get(7)).toBeCloseTo(0.32);
    expect(expressionValues(mixer.sample(15200), () => 0).get(7)).toBeCloseTo(0.32);
    expect(expressionValues(mixer.sample(15700), () => 0).get(7)).toBeCloseTo(0.16);
    expect(mixer.sample(16200)).toEqual([]);
  });
  it('applies changed intensity to ongoing afterglow and preserves its scale during retargeting', () => {
    const mixer = new ExpressionMixer();
    const parameters = [{ index: 7, value: 1, blend: 'Add' as const }];
    mixer.transitionMany([{ name: 'blush', parameters }], 0, 4200, { afterglowMs: 12000 });
    expect(mixer.sample(1000, 0.35)[0]?.weight).toBe(1);
    expect(mixer.sample(5000, 0.65)[0]?.weight).toBeCloseTo(0.26);
    expect(mixer.sample(5100, 0.35 * 0.18)[0]?.weight).toBeCloseTo(0.4 * 0.35 * 0.18);
    expect(mixer.sample(5200, 0)[0]).toBeUndefined();
    const before = mixer.sample(5300, 0.65);
    mixer.transitionMany([{ name: 'blush', parameters }], 5300, 4200, { afterglowMs: 12000 });
    expect(mixer.sample(5300)).toEqual(before);
    expect(mixer.sample(5540)[0]?.weight).toBe(1);
  });
  it('crossfades changed parameter subsets even when they share an asset layer name', () => {
    const mixer = new ExpressionMixer();
    mixer.transitionMany(
      [{ name: 'marks', parameters: [{ index: 7, value: 1, blend: 'Add' }] }],
      0,
    );
    const before = expressionValues(mixer.sample(1000), () => 0);
    mixer.transitionMany(
      [{ name: 'marks', parameters: [{ index: 13, value: 1, blend: 'Add' }] }],
      1000,
    );
    expect(expressionValues(mixer.sample(1000), () => 0)).toEqual(before);
    expect(Object.fromEntries(expressionValues(mixer.sample(1120), () => 0))).toEqual({
      7: 0.5,
      13: 0.5,
    });
    expect(Object.fromEntries(expressionValues(mixer.sample(1240), () => 0))).toEqual({ 13: 1 });
  });
  it('preserves explicitly mapped custom parameters and immediately clears sustained layers', () => {
    const mixer = new ExpressionMixer();
    const custom = [
      { index: 3, value: 1, blend: 'Add' as const },
      { index: 12, value: 1, blend: 'Overwrite' as const },
    ];
    mixer.transitionMany([{ name: 'custom', parameters: custom }], 0, 1000, {
      afterglowMs: 12000,
    });
    expect(mixer.sample(500)[0]?.parameters).toBe(custom);
    const before = expressionValues(mixer.sample(2000), () => 0);
    mixer.transitionMany([], 2000);
    expect(expressionValues(mixer.sample(2000), () => 0)).toEqual(before);
    expect(mixer.sample(2240)).toEqual([]);
    mixer.transitionMany([{ name: 'custom', parameters: custom }], 3000, 1000, {
      afterglowMs: 12000,
    });
    mixer.clear(5000, true);
    expect(mixer.sample(5000)).toEqual([]);
    expect(mixer.sample(8000)).toEqual([]);
  });
  it('samples layered afterglow by elapsed time independently of frame cadence', () => {
    const values = (fps: number) => {
      const mixer = new ExpressionMixer();
      mixer.transitionMany(
        [{ name: 'blush', parameters: [{ index: 7, value: 1, blend: 'Add' }] }],
        0,
        4200,
        { afterglowMs: 12000 },
      );
      for (let now = 0; now < 8000; now += 1000 / fps) mixer.sample(now);
      return mixer.sample(8000);
    };
    expect(values(30)).toEqual(values(60));
    expect(values(120)).toEqual(values(60));
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
  it('resolves optional torso roll upstream and omits a physics-owned or missing input', () => {
    const parameters = new Map([
      ['PositionZ', { index: 1, min: -30, max: 30, neutral: 0 }],
      ['ParamBodyAngleZ', { index: 2, min: -30, max: 30, neutral: 0 }],
    ]);
    expect(actingChannels(parameters, new Set(['ParamBodyAngleZ'])).bodyZ?.index).toBe(1);
    parameters.delete('PositionZ');
    expect(actingChannels(parameters, new Set(['ParamBodyAngleZ'])).bodyZ).toBeUndefined();
    expect(actingChannels(new Map(), new Set()).bodyZ).toBeUndefined();
  });

  it('uses runtime neutral and asymmetric bounds; nonfinite commands return neutral', () => {
    const range = { index: 0, min: -10, max: 30, neutral: 5 };
    expect(parameterValue(range, -0.5)).toBe(-2.5);
    expect(parameterValue(range, 0.5)).toBe(17.5);
    expect(parameterValue(range, 100)).toBe(30);
    expect(parameterValue(range, NaN)).toBe(5);
  });
  it('normalizes the afterglow mouth opening and protects authored or physics mouth controls', () => {
    const parameters = new Map([
      ['ParamMouthOpenY', { index: 9, min: -0.2, max: 2, neutral: 0.1 }],
      ['JawOpen', { index: 10, min: 0, max: 1, neutral: 0 }],
      ['ParamA', { index: 11, min: 0, max: 1, neutral: 0 }],
    ]);
    expect(facialValues({ ...face, mouthOpen: 0.12 }, parameters, new Set()).get(9)).toBeCloseTo(
      0.328,
    );
    expect(
      Object.fromEntries(facialValues({ ...face, mouthOpen: 4 }, parameters, new Set())),
    ).toEqual({ 9: 2 });
    expect(facialValues({ ...face, mouthOpen: NaN }, parameters, new Set()).get(9)).toBe(0.1);
    expect(facialValues(face, parameters, new Set(['ParamMouthOpenY']))).toEqual(new Map());
    expect(facialValues(face, parameters, new Set(), new Set(['ParamMouthOpenY']))).toEqual(
      new Map(),
    );
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
  it('allows bounded semantic holds without jumping to the authored entry endpoint', () => {
    const poses = new PoseSequence();
    const def = {
      enter: 'explain',
      exit: 'return',
      parameter: 'Movement3',
      enterMs: 1250,
      exitMs: 1250,
    };
    poses.start(def, 0, 12000);
    expect(poses.sample(1249)).toMatchObject({ phase: 'enter', timeMs: 1249 });
    expect(poses.sample(1250)).toMatchObject({ phase: 'hold', timeMs: 0 });
    expect(poses.sample(13249)).toMatchObject({ phase: 'hold', timeMs: 11999 });
    expect(poses.start(def, 13249, 12000)).toBe(false);
    expect(poses.sample(13250)).toMatchObject({ phase: 'exit', timeMs: 0 });
    expect(poses.sample(14499)).toMatchObject({ phase: 'exit', timeMs: 1249 });
    expect(poses.sample(14500)).toEqual({ phase: 'none' });
    poses.start(def, 15000, 100000);
    expect(poses.sample(32249)).toMatchObject({ phase: 'hold', timeMs: 15999 });
    expect(poses.sample(33500)).toEqual({ phase: 'none' });
    poses.start(def, 40000, 4200 + 12000 - def.enterMs - def.exitMs);
    expect(poses.sample(54950)).toMatchObject({ phase: 'exit', timeMs: 0 });
    expect(poses.sample(56200)).toEqual({ phase: 'none' });
  });
  it('interrupts partial entry immediately and starts a replacement at its authored beginning', () => {
    const poses = new PoseSequence();
    const def = {
      enter: 'explain',
      exit: 'return',
      parameter: 'Movement3',
      enterMs: 1250,
      exitMs: 1250,
    };
    poses.start(def, 0, 12000);
    expect(poses.sample(400).phase).toBe('enter');
    poses.clear();
    expect(poses.sample(400)).toEqual({ phase: 'none' });
    const replacement = { ...def, enter: 'greet' };
    poses.start(replacement, 400, 12000);
    expect(poses.sample(400)).toMatchObject({ phase: 'enter', timeMs: 0, definition: replacement });
    expect(poses.sample(500)).toMatchObject({ phase: 'enter', timeMs: 100 });
    poses.clear();
    expect(poses.sample(20000)).toEqual({ phase: 'none' });
  });
});

describe('direct-input authored return budget', () => {
  const definition = {
    enter: 'chest',
    exit: 'rest',
    parameter: 'Movement2',
    enterMs: 1133,
    exitMs: 1017,
  };
  it('reverses the last visible entry even when event time logically reached the hold', () => {
    for (const fps of [30, 60, 120]) {
      const poses = new PoseSequence();
      poses.start(definition, 0, 9000);
      const visible = poses.sample(700);
      expect(poses.sample(1500).phase).toBe('hold');
      poses.release(1500, 750, visible);
      expect(poses.sample(1500)).toMatchObject({ phase: 'exit', reverseEntry: true, timeMs: 700 });
      for (let time = 1500; time < 2199; time += 1000 / fps) {
        const frame = poses.sample(time);
        expect(frame.reverseEntry).toBe(true);
        expect(frame.timeMs).toBeCloseTo(700 - (time - 1500));
      }
      expect(poses.sample(2200)).toEqual({ phase: 'none' });
    }
  });
  it('time-scales the original trajectory into inactivity and release deadlines without extending duplicates', () => {
    for (const [budget, rendered, end] of [
      [750, { phase: 'enter', timeMs: 1100 }, 750],
      [750, { phase: 'hold', timeMs: 2000 }, 750],
      [1050, { phase: 'hold', timeMs: 2000 }, 1017],
      [300, { phase: 'exit', timeMs: 700 }, 300],
    ] as const) {
      const poses = new PoseSequence();
      poses.start(definition, 0, 9000);
      expect(poses.release(2000, budget, rendered)).toBe(true);
      const first = poses.sample(2000);
      expect(first.timeMs).toBe(rendered.phase === 'hold' ? 0 : rendered.timeMs);
      expect(poses.release(2100, 1050, rendered)).toBe(false);
      const tail = poses.sample(2000 + end - 0.001);
      expect(tail.phase).toBe('exit');
      expect(tail.timeMs).toBeCloseTo(rendered.phase === 'enter' ? 0 : 1017, 2);
      expect(poses.sample(2000 + end)).toEqual({ phase: 'none' });
    }
  });
  it('clears unrendered/expired inputs and drops reverse state on replacement', () => {
    const poses = new PoseSequence();
    poses.start(definition, 0);
    poses.release(20, 750, { phase: 'none' });
    expect(poses.sample(20).phase).toBe('none');
    poses.start(definition, 100);
    poses.release(500, 0, { phase: 'enter', timeMs: 300 });
    expect(poses.sample(500).phase).toBe('none');
    poses.start(definition, 1000);
    poses.release(1400, 750, { phase: 'enter', timeMs: 300 });
    poses.clear();
    poses.start({ ...definition, enter: 'other' }, 1500);
    expect(poses.sample(1500)).toMatchObject({ phase: 'enter', timeMs: 0 });
    expect(poses.sample(1500).reverseEntry).toBeUndefined();
  });
  it('lowers the shoulder while the elbow straightens, then hits the authored endpoints', () => {
    const from = new Map([
      [62, 0.034],
      [59, 0.476],
      [60, 0.86],
      [61, 0.002],
      [2, 1],
    ]);
    const to = new Map([
      [62, -0.001],
      [59, -0.001],
      [60, 0],
      [61, 0.001],
      [56, 1],
    ]);
    const at = (progress: number) => chestArmReturn(progress, from, to, 62);
    const start = at(0);
    const early = at(0.02);
    const quarter = at(0.25);
    const mid = at(0.5);
    const end = at(1);
    expect(start.get(62)).toBeCloseTo(0.034, 6);
    expect(start.get(60)).toBeCloseTo(0.86, 6);
    expect(start.get(61)).toBeCloseTo(0.002, 6);
    expect(end.get(62)).toBeCloseTo(-0.001, 6);
    expect(end.get(60)).toBeCloseTo(0, 6);
    expect(end.get(59)).toBeCloseTo(-0.001, 6);
    expect(Math.abs((early.get(60) ?? 0) - 0.86)).toBeLessThan(0.86 * 0.02 * 0.25);
    expect(quarter.get(60)!).toBeGreaterThan(0.6);
    expect(quarter.get(60)!).toBeLessThan(0.86);
    expect(quarter.get(62)!).toBeLessThan(-0.15);
    expect(mid.get(60)!).toBeGreaterThan(0);
    expect(mid.get(60)!).toBeLessThan(0.3);
    expect(mid.get(62)).toBeCloseTo(-0.9, 6);
    expect(mid.get(62)!).toBeLessThan(Math.min(0.034, -0.001) - 0.5);
    expect(mid.get(59)!).toBeGreaterThan(-0.001);
    expect(mid.get(59)!).toBeLessThan(0.476);
    // The elbow has finished before the shoulder rises from its lowered path.
    expect(at(0.75).get(60)).toBeCloseTo(0, 8);
    expect(at(0.75).get(62)!).toBeLessThan(-0.2);
    expect(Math.abs((mid.get(61) ?? 0) - 0.002)).toBeLessThan(0.02);
    expect(at(-1).get(60)).toBeCloseTo(0.86, 6);
    expect(at(2).get(62)).toBeCloseTo(-0.001, 6);
    expect(start.has(2)).toBe(false);
    expect(end.has(56)).toBe(false);
    expect(at(0.5).has(61)).toBe(true);
    expect(chestArmReturn(0.5, new Map([[60, Number.NaN]]), to, 62).size).toBe(0);
    expect(chestArmReturn(Number.NaN, from, to, 62).size).toBe(0);
  });
});
