import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelInventory } from '../src/shared/contracts.js';
import type { ActingFrame } from '../src/renderer/acting.js';
import {
  PoseSequence,
  type ParameterRange,
  type PoseFrame,
  type ExpressionLayer,
  type ExpressionParameter,
} from '../src/renderer/performance.js';

vi.mock('@cubism/live2dcubismframework', () => ({ CubismFramework: {} }));
vi.mock('@cubism/model/cubismusermodel', () => ({ CubismUserModel: class {} }));
vi.mock('@cubism/motion/cubismmotionmanager', () => ({
  CubismMotionManager: class {
    stopAllMotions = vi.fn();
    startMotionPriority = vi.fn();
    isFinished = () => false;
  },
}));
vi.mock('@cubism/motion/cubismmotionqueueentry', () => ({
  CubismMotionQueueEntry: class {
    setStartTime = vi.fn();
    setFadeInStartTime = vi.fn();
  },
}));
vi.mock('@cubism/math/cubismmatrix44', () => ({ CubismMatrix44: class {} }));
vi.mock('@cubism/rendering/cubismrenderer_webgl', () => ({
  CubismClippingManager_WebGL: class {},
}));
import { Avatar } from '../src/renderer/avatar.js';

const inventory = {
  expressionMap: { happy: 'smile', surprised: 'surprise' },
  gestureMap: { thinking: 'waiting', explain: 'explain', wave: 'greeting' },
} as unknown as ModelInventory;
const cue = {
  requestId: 'r',
  messageId: 'm',
  segmentId: 1,
  emotion: 'happy',
  gesture: 'explain',
  confidence: 1,
  source: 'fallback',
} as const;
function setup() {
  const avatar = new Avatar({} as HTMLCanvasElement, inventory);
  // Exercise Avatar's actual state/cue composition without model assets/WebGL.
  const runtime = avatar as unknown as {
    actor: { sample: (now: number, dt: number) => ActingFrame };
    mixer: { sample: (now: number, scale?: number) => ExpressionLayer[] };
    poses: { sample: (now: number) => { phase: string; definition?: { parameter: string } } };
    motions: Map<string, unknown>;
    poseDefinitions: Map<string, unknown>;
    expressions: Map<string, ExpressionParameter[]>;
    indexes: Map<string, number>;
    petting: { sample: (now: number) => number };
    pettingRegion?: { x: number; y: number; width: number; height: number };
    pettingFocus: { x: number; y: number };
    pettingMarks: (weight: number, animated?: ReadonlySet<string>) => ExpressionLayer[];
    physicsOutputs: Set<string>;
  };
  for (const [name, parameter] of [
    ['waiting', 'wait'],
    ['explain', 'hand'],
    ['greeting', 'greeting-hand'],
  ]) {
    runtime.motions.set(name!, {});
    runtime.poseDefinitions.set(name!, {
      enter: name,
      exit: 'return',
      parameter,
      enterMs: 1250,
      exitMs: 1250,
    });
  }
  return { avatar, runtime };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', {});
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Avatar message and background priority — FR-L2D-004/006', () => {
  it('promotes delivery to a semantic hand pose and clears it without changing background state', () => {
    const { avatar, runtime } = setup();
    avatar.setState('working');
    avatar.cue({ ...cue, emotion: 'neutral', gesture: 'none', stage: 'delivery' });
    vi.setSystemTime(500);
    const semantic = { ...cue, segmentId: 2, stage: 'semantic' } as const;
    avatar.cue(semantic);
    expect(runtime.poses.sample(500).definition?.parameter).toBe('hand');
    avatar.clearCue({ ...semantic, segmentId: 1 });
    expect(runtime.poses.sample(500).definition?.parameter).toBe('hand');
    avatar.clearCue(semantic);
    expect(runtime.poses.sample(500).phase).toBe('none');
    expect(runtime.actor.sample(500, 0)).toMatchObject({ preset: 'working', active: false });
    avatar.cue({ ...semantic, messageId: 'new', segmentId: 3, gesture: 'wave' });
    avatar.clearCue(semantic);
    expect(runtime.poses.sample(500).definition?.parameter).toBe('greeting-hand');
  });
  it('replaces the previous message hand pose immediately, including none, inside the old cooldown', () => {
    for (const nextGesture of ['none', 'thinking', 'wave'] as const) {
      const { avatar, runtime } = setup();
      avatar.cue(cue);
      expect(runtime.poses.sample(0).definition?.parameter).toBe('hand');
      vi.setSystemTime(500);
      avatar.cue({
        ...cue,
        messageId: 'new',
        segmentId: 2,
        gesture: nextGesture,
        attitude: 'laugh',
      });
      expect(runtime.actor.sample(500, 0).preset).toBe('laugh');
      const pose = runtime.poses.sample(500);
      if (nextGesture === 'none') expect(pose.phase).toBe('none');
      else
        expect(pose.definition?.parameter).toBe(nextGesture === 'wave' ? 'greeting-hand' : 'wait');
      vi.setSystemTime(0);
    }
  });
  it('preserves same-hand repeat suppression across the Director first-byte clear', () => {
    const { avatar, runtime } = setup();
    avatar.cue(cue);
    vi.setSystemTime(500);
    avatar.clearCue(cue);
    expect(runtime.poses.sample(500).phase).toBe('none');
    avatar.cue({ ...cue, messageId: 'second', segmentId: 2 });
    expect(runtime.poses.sample(500).phase).toBe('none');
    vi.setSystemTime(6200);
    avatar.cue({ ...cue, messageId: 'third', segmentId: 3 });
    expect(runtime.poses.sample(6200).phase).toBe('enter');
  });
  it('replaces a waiting pose with automatic laughter without requesting a hand gesture', () => {
    const { avatar, runtime } = setup();
    avatar.setState('thinking');
    vi.setSystemTime(300);
    avatar.cue({ ...cue, emotion: 'neutral', gesture: 'none', attitude: 'laugh', source: 'jev' });
    expect(runtime.actor.sample(300, 0)).toMatchObject({ preset: 'laugh', active: true });
    expect(runtime.poses.sample(300).phase).toBe('none');
    avatar.setState('working');
    expect(runtime.actor.sample(300, 0)).toMatchObject({ preset: 'laugh', active: true });
    avatar.setState('blocked');
    expect(runtime.actor.sample(300, 0)).toMatchObject({ preset: 'neutral', active: false });
  });
  it('plays the greeting hand pose for a confident wave even with neutral emotion and attitude', () => {
    const { avatar, runtime } = setup();
    avatar.setState('thinking');
    vi.setSystemTime(300);
    avatar.cue({
      ...cue,
      emotion: 'neutral',
      gesture: 'wave',
      attitude: 'neutral',
      confidence: 0.92,
      source: 'jev',
    });
    expect(runtime.actor.sample(300, 0)).toMatchObject({ preset: 'happy', active: true });
    expect(runtime.poses.sample(300)).toMatchObject({
      phase: 'enter',
      definition: { parameter: 'greeting-hand' },
    });
  });
  it('animates a neutral progress cue locally without starting a hand pose', () => {
    const { avatar, runtime } = setup();
    avatar.cue({ ...cue, emotion: 'neutral', gesture: 'none', attitude: 'neutral' });
    expect(runtime.actor.sample(0, 0)).toMatchObject({ preset: 'acknowledge', active: true });
    expect(runtime.poses.sample(0).phase).toBe('none');
  });
  it('keeps an explanatory tone without inventing a hand pose when the gesture is none', () => {
    const { avatar, runtime } = setup();
    avatar.cue({ ...cue, gesture: 'none', attitude: 'explain' });
    expect(runtime.actor.sample(0, 0).preset).toBe('explain');
    expect(runtime.poses.sample(0).phase).toBe('none');
    vi.setSystemTime(2000);
    avatar.cue({ ...cue, segmentId: 2, messageId: 'next', attitude: 'explain' });
    expect(runtime.poses.sample(2000).definition?.parameter).toBe('hand');
  });
  it('replaces a waiting asset with the message pose without its cooldown suppressing the cue', () => {
    const { avatar, runtime } = setup();
    avatar.setState('thinking');
    expect(runtime.poses.sample(0).definition?.parameter).toBe('wait');
    vi.setSystemTime(300);
    avatar.cue(cue);
    expect(runtime.poses.sample(300).definition?.parameter).toBe('hand');
    expect(runtime.actor.sample(300, 0).preset).toBe('happy');
  });
  it('preserves a short reaction and its longer paired return across background changes, then blocks immediately', () => {
    const { avatar, runtime } = setup();
    avatar.cue({ ...cue, emotion: 'surprised' });
    for (const [now, state] of [
      [1000, 'working'],
      [1500, 'thinking'],
      [2400, 'working'],
    ] as const) {
      vi.setSystemTime(now);
      avatar.setState(state);
      expect(runtime.poses.sample(now).phase).not.toBe('none');
    }
    expect(runtime.actor.sample(2400, 0)).toMatchObject({ active: true, phase: 'afterglow' });
    expect(runtime.poses.sample(3000).phase).toBe('hold');
    vi.setSystemTime(3000);
    avatar.setState('thinking');
    expect(runtime.poses.sample(3000).phase).toBe('hold');
    avatar.setState('blocked');
    expect(runtime.poses.sample(3000).phase).toBe('none');
    expect(runtime.mixer.sample(3000)).toEqual([]);
    expect(runtime.actor.sample(3000, 0)).toMatchObject({ preset: 'neutral', active: false });
    avatar.setState('idle');
    expect(runtime.poses.sample(3100).phase).toBe('none');
    expect(runtime.actor.sample(3100, 0).active).toBe(false);
  });
});

describe('semantic expression afterglow — FR-L2D-004/006/007', () => {
  function faceSetup() {
    const result = setup();
    for (const [index, id] of [
      'key3',
      'key4',
      'key5',
      'key6',
      'key7',
      'key13',
      'clothes',
    ].entries())
      result.runtime.indexes.set(id, index);
    for (const [name, keys] of [
      ['＞＜', ['key5']],
      ['屑屑眼', ['key6']],
      ['blush', ['key7']],
      ['sweat', ['key13']],
      ['custom-blush', ['key7', 'clothes']],
    ] as const)
      result.runtime.expressions.set(
        name,
        keys.map((id) => ({
          index: result.runtime.indexes.get(id)!,
          value: 1,
          blend: 'Add',
        })),
      );
    return result;
  }
  function avatarWithMaps(expressionMap: ModelInventory['expressionMap']) {
    const { avatar, runtime } = faceSetup();
    // The actual settings/model boundary provides this inventory per renderer.
    (avatar as unknown as { inventory: ModelInventory }).inventory = {
      ...inventory,
      expressionMap,
    };
    return { avatar, runtime };
  }
  it('keeps procedural happiness/laughter without a default special eye and supports saved eye artwork', () => {
    for (const happy of [undefined, '＞＜']) {
      const { avatar, runtime } = avatarWithMaps({ happy });
      avatar.cue({ ...cue, gesture: 'none', attitude: 'laugh', stage: 'semantic' });
      const layers = runtime.mixer.sample(700);
      expect(
        layers.some((l) => l.parameters.some((p) => p.index === runtime.indexes.get('key5'))),
      ).toBe(happy !== undefined);
      expect(runtime.actor.sample(700, 0).preset).toBe('laugh');
    }
  });
  it('composes embarrassed laughter and concerned teasing without discarding the emotion marking', () => {
    const { avatar, runtime } = avatarWithMaps({ embarrassed: 'blush', concerned: 'sweat' });
    avatar.cue({ ...cue, emotion: 'embarrassed', gesture: 'none', attitude: 'laugh' });
    expect(runtime.mixer.sample(700).map((l) => l.name)).toEqual(['blush:markings']);
    expect(runtime.actor.sample(700, 0).preset).toBe('laugh');
    vi.setSystemTime(1000);
    avatar.cue({
      ...cue,
      messageId: 'next',
      segmentId: 2,
      emotion: 'concerned',
      gesture: 'none',
      attitude: 'tease',
    });
    expect(
      runtime.mixer
        .sample(1700)
        .map((l) => l.name)
        .sort(),
    ).toEqual(['sweat:markings']);
    expect(runtime.mixer.sample(2200).map((l) => l.name)).toEqual(['sweat:markings']);
    const residue = runtime.mixer.sample(9000, 0.65);
    expect(residue.map((l) => l.name)).toEqual(['sweat:markings']);
    expect(residue[0]!.weight).toBeCloseTo(0.6175);
  });
  it('allows multiple markings, filters automatic props, and preserves explicitly selected assets', () => {
    const { avatar, runtime } = avatarWithMaps({ concerned: 'sweat', embarrassed: 'custom-blush' });
    avatar.cue({ ...cue, emotion: 'concerned', gesture: 'none', attitude: 'shy' });
    const layers = runtime.mixer.sample(700);
    expect(layers.flatMap((l) => l.parameters.map((p) => p.index)).sort()).toEqual(
      [runtime.indexes.get('key7'), runtime.indexes.get('key13')].sort(),
    );
    vi.setSystemTime(1000);
    avatar.cue({
      ...cue,
      messageId: 'next',
      segmentId: 2,
      emotion: 'embarrassed',
      gesture: 'none',
    });
    expect(
      runtime.mixer
        .sample(1700)
        .flatMap((l) => l.parameters)
        .some((p) => p.index === runtime.indexes.get('clothes')),
    ).toBe(true);
  });
  it('preserves saved primary eye art while procedural teasing owns its own eyelids', () => {
    const { avatar, runtime } = avatarWithMaps({ happy: '＞＜' });
    avatar.cue({ ...cue, gesture: 'none', attitude: 'tease' });
    expect(runtime.mixer.sample(700).map((l) => l.name)).toEqual(['＞＜:eyes']);
  });
  it('softens the generated angry accent into a bounded facial residue', () => {
    const { avatar, runtime } = avatarWithMaps({ angry: '@companion/angry' });
    runtime.expressions.set('@companion/angry', [{ index: 50, value: -1, blend: 'Overwrite' }]);
    avatar.cue({ ...cue, emotion: 'angry', gesture: 'none', stage: 'semantic' });
    expect(runtime.mixer.sample(1000, 0.65)[0]?.weight).toBeCloseTo(1);
    expect(runtime.mixer.sample(2200, 0.65)[0]?.weight).toBeCloseTo(0.65);
    expect(runtime.mixer.sample(8000, 0.65)[0]?.weight).toBeCloseTo(0.65);
    expect(runtime.mixer.sample(16200, 0.65)).toEqual([]);
  });
  it('keeps saved laugh eye art as a short accent without overwriting its configured mapping', () => {
    const { avatar, runtime } = avatarWithMaps({ happy: '＞＜', embarrassed: 'blush' });
    avatar.cue({ ...cue, gesture: 'none', attitude: 'laugh' });
    expect(runtime.mixer.sample(700).map((l) => l.name)).toEqual(['＞＜:eyes']);
    expect(runtime.mixer.sample(1400)).toEqual([]);
    expect((avatar as unknown as { inventory: ModelInventory }).inventory.expressionMap.happy).toBe(
      '＞＜',
    );
    vi.setSystemTime(2000);
    avatar.cue({ ...cue, messageId: 'second', segmentId: 2, emotion: 'confused', gesture: 'none' });
  });
  it('allows only the saved blush marker in direct petting and preserves custom props and authored ownership', () => {
    const { avatar, runtime } = avatarWithMaps({ embarrassed: 'custom-blush' });
    expect(runtime.pettingMarks(0.65)).toEqual([]);
    avatar.configure({
      intensity: 'normal',
      framing: 'bust',
      positionLocked: false,
      reducedMotion: false,
      pettingEnabled: true,
    });
    const marks = runtime.pettingMarks(0.65);
    expect(marks[0]?.weight).toBeCloseTo(0.585);
    expect(marks[0]?.parameters.map((p) => p.index)).toEqual([runtime.indexes.get('key7')]);
    expect(runtime.pettingMarks(0.65, new Set(['key7']))).toEqual([]);
    runtime.physicsOutputs.add('key7');
    expect(runtime.pettingMarks(0.65)).toEqual([]);
    runtime.physicsOutputs.clear();
    avatar.setState('blocked');
    expect(runtime.pettingMarks(0.65)).toEqual([]);
  });
  it('holds the authored hand through the residue and completes its return inside the finite lifetime', () => {
    const { avatar, runtime } = faceSetup();
    avatar.cue({ ...cue, stage: 'semantic' });
    expect(runtime.poses.sample(8000).phase).toBe('hold');
    expect(runtime.poses.sample(14950).phase).toBe('exit');
    expect(runtime.poses.sample(16200).phase).toBe('none');
    expect(runtime.actor.sample(16200, 0).active).toBe(false);
  });
  it('clears an applied long residue, expression and hand by matching IDs; stale clears have no effect', () => {
    const { avatar, runtime } = avatarWithMaps({ embarrassed: 'blush' });
    const semantic = { ...cue, emotion: 'embarrassed', stage: 'semantic' } as const;
    avatar.cue(semantic);
    vi.setSystemTime(8000);
    expect(runtime.actor.sample(8000, 0).phase).toBe('afterglow');
    expect(runtime.mixer.sample(8000)).toHaveLength(1);
    avatar.clearCue({ ...semantic, segmentId: 2 });
    expect(runtime.poses.sample(8000).phase).toBe('hold');
    avatar.clearCue(semantic);
    expect(runtime.mixer.sample(8000)).toEqual([]);
    expect(runtime.poses.sample(8000).phase).toBe('none');
    expect(runtime.actor.sample(8000, 0)).toMatchObject({ active: false, mouthOpen: 0, smile: 0 });
  });
  it('extends a saved neutral marking on promotion using the original delivery clock without restarting it', () => {
    const { avatar, runtime } = avatarWithMaps({ neutral: 'blush' });
    avatar.cue({ ...cue, emotion: 'neutral', gesture: 'none', stage: 'delivery' });
    vi.setSystemTime(1000);
    const semantic = {
      ...cue,
      emotion: 'neutral',
      gesture: 'none',
      stage: 'semantic',
      segmentId: 2,
    } as const;
    avatar.cue(semantic);
    expect(runtime.mixer.sample(8000, 0.65)).toMatchObject([{ name: 'blush:markings' }]);
    expect(runtime.mixer.sample(8000, 0.65)[0]!.weight).toBeCloseTo(0.6175);
    vi.setSystemTime(8000);
    avatar.cue(semantic);
    expect(runtime.mixer.sample(13800)).toEqual([]);
    expect(runtime.actor.sample(13800, 0).active).toBe(false);
  });
  it('clears residue on errors, approval, reset and a newer message without a hand gesture', () => {
    for (const boundary of ['error', 'blocked', 'reset', 'message'] as const) {
      vi.setSystemTime(0);
      const { avatar, runtime } = avatarWithMaps({ embarrassed: 'blush' });
      avatar.cue({ ...cue, emotion: 'embarrassed' });
      vi.setSystemTime(8000);
      if (boundary === 'reset') avatar.reset();
      else if (boundary === 'message')
        avatar.cue({ ...cue, segmentId: 2, messageId: 'new', emotion: 'neutral', gesture: 'none' });
      else avatar.setState(boundary);
      expect(runtime.poses.sample(8000).phase).toBe('none');
      if (boundary !== 'message') {
        expect(runtime.mixer.sample(8000)).toEqual([]);
        expect(runtime.actor.sample(8000, 0).active).toBe(false);
      }
    }
  });
});

describe('Avatar petting opt-in and interruption — FR-L2D-008', () => {
  const settings = {
    intensity: 'normal',
    framing: 'full',
    positionLocked: true,
    reducedMotion: false,
    pettingEnabled: true,
  } as const;
  it('requires opt-in, local silhouette alpha and the upper region; position lock permits direct petting', () => {
    const { avatar, runtime } = setup();
    expect(avatar.beginPetting()).toBe(false);
    avatar.configure(settings);
    runtime.pettingRegion = { x: 10, y: 10, width: 50, height: 50 };
    vi.spyOn(avatar, 'hit').mockReturnValue(true);
    expect(avatar.pettingHit(20, 20)).toBe(true);
    expect(avatar.pettingHit(20, 80)).toBe(false);
    vi.mocked(avatar.hit).mockReturnValue(false);
    expect(avatar.pettingHit(20, 20)).toBe(false);
    expect(avatar.beginPetting()).toBe(true);
    vi.setSystemTime(50);
    avatar.strokePetting(15);
    expect(runtime.petting.sample(300)).toBeGreaterThan(0.9);
    avatar.endPetting();
    expect(runtime.petting.sample(600)).toBe(0);
  });
  it('stops direct petting on disable, reset, errors and approval without changing message bindings', () => {
    for (const boundary of ['disable', 'reset', 'error', 'blocked'] as const) {
      vi.setSystemTime(0);
      const { avatar, runtime } = setup();
      avatar.configure(settings);
      avatar.beginPetting();
      vi.setSystemTime(50);
      avatar.strokePetting(15);
      expect(runtime.petting.sample(300)).toBeGreaterThan(0.9);
      if (boundary === 'disable') avatar.configure({ ...settings, pettingEnabled: false });
      else if (boundary === 'reset') avatar.reset();
      else avatar.setState(boundary);
      expect(runtime.petting.sample(300)).toBe(0);
      if (boundary === 'blocked' || boundary === 'error') expect(avatar.beginPetting()).toBe(false);
    }
  });
  it('normalizes only supplied local stroke coordinates and resets focus on a new contact', () => {
    const { avatar, runtime } = setup();
    avatar.configure(settings);
    runtime.pettingRegion = { x: 10, y: 20, width: 100, height: 200 };
    avatar.beginPetting();
    avatar.strokePetting(12, 110, 20);
    expect(runtime.pettingFocus).toEqual({ x: 1, y: 1 });
    avatar.strokePetting(12, NaN, 40);
    expect(runtime.pettingFocus).toEqual({ x: 1, y: 1 });
    avatar.strokePetting(200, 10, 220);
    expect(runtime.pettingFocus).toEqual({ x: 1, y: 1 });
    avatar.strokePetting(12, 10, 220);
    expect(runtime.pettingFocus).toEqual({ x: -1, y: -1 });
    avatar.endPetting();
    avatar.strokePetting(12, 110, 20);
    expect(runtime.pettingFocus).toEqual({ x: -1, y: -1 });
    avatar.beginPetting();
    expect(runtime.pettingFocus).toEqual({ x: 0, y: 0 });
  });
});

describe('owned direct-petting chest pose — FR-L2D-008', () => {
  const settings = {
    intensity: 'normal',
    framing: 'bust',
    positionLocked: true,
    reducedMotion: false,
    pettingEnabled: true,
  } as const;
  const endpoints = [
    ['Movement2', 1, 0],
    ['Param56', 1, 1],
    ['Param57', 0, 0],
    ['Param62', 0.034, -0.001],
    ['Param59', 0.476, -0.001],
    ['Param60', 0.86, 0],
    ['Param61', 0.002, 0.001],
  ] as const;
  function touchSetup() {
    const { avatar } = setup();
    const runtime = avatar as unknown as {
      inventory: ModelInventory;
      poses: PoseSequence;
      ranges: Map<string, ParameterRange>;
      indexes: Map<string, number>;
      poseDefinitions: Map<string, Parameters<PoseSequence['start']>[0]>;
      motionInfo: Map<
        string,
        { duration: number; parameters: Set<string>; held: Map<string, number> }
      >;
      motions: Map<string, { doUpdateParameters: ReturnType<typeof vi.fn> }>;
      gestureManager: { isFinished: () => boolean };
      physicsOutputs: Set<string>;
      petPose: boolean;
      petPoseUsed: boolean;
      activeGesture: string;
      lastGesture: number;
      lastGestureName: string;
      samplePettingPose: (frame: PoseFrame) => boolean;
      updatePettingPose: (now: number) => void;
      model: {
        getParameterMinimumValue: (i: number) => number;
        getParameterMaximumValue: () => number;
        setParameterValueByIndex: ReturnType<typeof vi.fn>;
      };
      canvas: { removeEventListener: ReturnType<typeof vi.fn> };
      runtime: { release: ReturnType<typeof vi.fn> };
    };
    runtime.inventory = {
      ...inventory,
      gestureMap: { ...inventory.gestureMap, wave: '默认手切举手' },
    };
    const definition = {
      enter: '默认手切举手',
      exit: '举手切默认手',
      parameter: 'Movement2',
      enterMs: 1133,
      exitMs: 1017,
    };
    runtime.poseDefinitions.set(definition.enter, definition);
    for (const [i, [id]] of endpoints.entries()) {
      runtime.indexes.set(id, i);
      runtime.ranges.set(id, { index: i, min: i < 3 ? 0 : -1, max: 1, neutral: 0 });
    }
    for (const [name, column] of [
      [definition.enter, 1],
      [definition.exit, 2],
    ] as const) {
      runtime.motionInfo.set(name, {
        duration: name === definition.enter ? 1133 : 1017,
        parameters: new Set(endpoints.map((row) => row[0])),
        held: new Map(endpoints.map((row) => [row[0], row[column]])),
      });
      runtime.motions.set(name, { doUpdateParameters: vi.fn() });
    }
    runtime.model = {
      getParameterMinimumValue: (i) => (i < 3 ? 0 : -1),
      getParameterMaximumValue: () => 1,
      setParameterValueByIndex: vi.fn(),
    };
    vi.spyOn(runtime.gestureManager, 'isFinished').mockReturnValue(true);
    vi.spyOn(avatar, 'pettingHit').mockReturnValue(true);
    avatar.configure(settings);
    const stroke = (now: number, distance = 10) => {
      vi.setSystemTime(now);
      avatar.strokePetting(distance, 200, 180);
    };
    const render = (now: number) => {
      vi.setSystemTime(now);
      runtime.updatePettingPose(now);
      const frame = runtime.poses.sample(now);
      runtime.samplePettingPose(frame);
      return frame;
    };
    return { avatar, runtime, stroke, render, definition };
  }
  it('starts only after real local travel and samples authored entry, hold and paired exit without consuming semantic cooldown', () => {
    const { avatar, runtime, stroke, render, definition } = touchSetup();
    avatar.cue({ ...cue, gesture: 'none' });
    expect(runtime.poses.sample(0).phase).toBe('none');
    avatar.beginPetting();
    stroke(10, 3);
    expect(runtime.petPose).toBe(false);
    stroke(20, 0);
    expect(runtime.petPose).toBe(false);
    stroke(30, 5);
    expect(runtime.petPose).toBe(true);
    expect(runtime.lastGesture).toBe(-Infinity);
    expect(runtime.lastGestureName).toBe('');
    for (let now = 50; now <= 1300; now += 50) {
      stroke(now);
      render(now);
    }
    expect(render(1300).phase).toBe('hold');
    avatar.endPetting();
    expect(render(1300)).toMatchObject({ phase: 'exit', timeMs: 0 });
    expect(runtime.motions.get(definition.exit)!.doUpdateParameters).toHaveBeenLastCalledWith(
      runtime.model,
      0,
      1,
      expect.anything(),
    );
    avatar.endPetting();
    expect(render(2317).phase).toBe('none');
    expect(runtime.petPose).toBe(false);
    expect(runtime.lastGesture).toBe(-Infinity);
  });
  it('requires eight pixels of valid own-canvas travel rather than unlocated or missed input', () => {
    const { avatar, runtime, stroke } = touchSetup();
    avatar.beginPetting();
    vi.setSystemTime(10);
    avatar.strokePetting(40, NaN, 180);
    vi.mocked(avatar.pettingHit).mockReturnValue(false);
    stroke(20, 40);
    vi.mocked(avatar.pettingHit).mockReturnValue(true);
    stroke(30, 3);
    expect(runtime.petPose).toBe(false);
    stroke(40, 5);
    expect(runtime.petPose).toBe(true);
    avatar.endPetting();
    expect(runtime.petPose).toBe(false); // no hand frame was ever rendered
  });
  it('bounds inactivity and duplicate release across30/60/120Hz without replaying arms', () => {
    for (const fps of [30, 60, 120]) {
      const { avatar, runtime, stroke, render } = touchSetup();
      avatar.beginPetting();
      for (let n = 1; n <= fps * 1.5; n++) {
        const at = (n * 1000) / fps;
        stroke(at);
        render(at);
      }
      for (let n = 1; n <= fps * 0.9; n++) render(1500 + (n * 1000) / fps);
      render(2400);
      expect(runtime.petPose).toBe(false);
      avatar.endPetting();
      stroke(2500);
      expect(runtime.petPose).toBe(false);
      expect(runtime.lastGesture).toBe(-Infinity);
      vi.setSystemTime(0);
    }
  });
  it('reverses the last actually rendered entry across a long event-frame gap and does not restart on further strokes', () => {
    const { avatar, runtime, stroke, render, definition } = touchSetup();
    avatar.beginPetting();
    stroke(10);
    render(110);
    for (let now = 200; now <= 1400; now += 100) stroke(now);
    vi.setSystemTime(1400);
    avatar.endPetting();
    const released = render(1400);
    expect(released).toMatchObject({ phase: 'exit', reverseEntry: true, timeMs: 100 });
    expect(runtime.motions.get(definition.enter)!.doUpdateParameters).toHaveBeenLastCalledWith(
      runtime.model,
      0.1,
      1,
      expect.anything(),
    );
    expect(render(1450).timeMs).toBe(50);
    expect(render(1500).phase).toBe('none');
    stroke(1550);
    expect(runtime.petPose).toBe(false);
  });
  it('returns from inactivity within900ms, does not refresh on stationary input or repeat within one touch', () => {
    const { avatar, runtime, stroke, render } = touchSetup();
    avatar.beginPetting();
    for (let now = 20; now <= 1600; now += 20) {
      stroke(now);
      render(now);
    }
    expect(render(1700).phase).toBe('hold');
    stroke(1750, 0);
    expect(render(1750)).toMatchObject({ phase: 'exit', timeMs: 0 });
    expect(render(2499).phase).toBe('exit');
    expect(render(2500).phase).toBe('none');
    stroke(2600);
    expect(runtime.petPose).toBe(false);
    avatar.beginPetting();
    stroke(2700);
    expect(runtime.petPose).toBe(true);
  });
  it('keeps every authored phase inside the original12second cap and skips too-late starts', () => {
    const { avatar, runtime, stroke, render } = touchSetup();
    avatar.beginPetting();
    for (let now = 50; now <= 11900; now += 50) {
      stroke(now);
      render(now);
    }
    expect(runtime.poses.sample(11900).phase).toBe('exit');
    avatar.endPetting();
    render(12000);
    expect(runtime.petPose).toBe(false);
    expect(runtime.poses.sample(12000).phase).toBe('none');
    vi.setSystemTime(13000);
    avatar.beginPetting();
    stroke(23000);
    expect(runtime.petPose).toBe(false);
  });
  it('keeps existing/custom poses and unavailable/changed rigs on body-only fallback', () => {
    for (const missing of [
      'custom-map',
      'empty-map',
      'output',
      'range',
      'endpoint',
      'clip',
      'busy',
      'reduced',
      'existing',
      'alpha',
    ] as const) {
      const { avatar, runtime, stroke, definition } = touchSetup();
      if (missing === 'custom-map') runtime.inventory.gestureMap.wave = 'custom';
      if (missing === 'empty-map') delete runtime.inventory.gestureMap.wave;
      if (missing === 'output') runtime.physicsOutputs.add('Param60');
      if (missing === 'range') runtime.ranges.get('Param59')!.max = 2;
      if (missing === 'endpoint')
        runtime.motionInfo.get(definition.enter)!.held.set('Param59', 0.8);
      if (missing === 'clip') runtime.motions.delete(definition.exit);
      if (missing === 'busy') avatar.setState('working');
      if (missing === 'reduced') avatar.configure({ ...settings, reducedMotion: true });
      if (missing === 'existing') runtime.poses.start({ ...definition, enter: 'custom' }, 0);
      if (missing === 'alpha') vi.mocked(avatar.pettingHit).mockReturnValue(false);
      avatar.beginPetting();
      stroke(20);
      expect(runtime.petPose).toBe(false);
      avatar.endPetting(true);
      if (missing === 'existing') expect(runtime.poses.sample(20).definition?.enter).toBe('custom');
      vi.setSystemTime(0);
    }
  });
  it('preserves the old visible return and its deadline through rapid or repeated recontact', () => {
    for (const mode of ['stationary', 'strokes', 'repeat'] as const) {
      const { avatar, runtime, stroke, render } = touchSetup();
      avatar.beginPetting();
      for (let now = 20; now <= 1600; now += 20) {
        stroke(now);
        render(now);
      }
      avatar.endPetting();
      expect(render(1850)).toMatchObject({ phase: 'exit', timeMs: 250 });
      vi.setSystemTime(1851);
      avatar.beginPetting();
      expect(render(1851)).toMatchObject({ phase: 'exit', timeMs: 251 });
      if (mode === 'repeat') {
        vi.setSystemTime(1852);
        avatar.beginPetting();
        vi.setSystemTime(1853);
        avatar.beginPetting();
      }
      if (mode !== 'strokes') avatar.endPetting();
      for (let now = 1860; now <= 2600; now += 20) {
        if (mode === 'strokes') stroke(now);
        render(now);
      }
      expect(render(2616)).toMatchObject({ phase: 'exit', timeMs: 1016 });
      expect(render(2617).phase).toBe('none');
      stroke(2700);
      expect(runtime.petPose).toBe(false);
      expect(runtime.lastGesture).toBe(-Infinity);
      vi.setSystemTime(2800);
      avatar.beginPetting();
      stroke(2810);
      expect(render(2810)).toMatchObject({ phase: 'enter', timeMs: 0 });
      vi.setSystemTime(0);
    }
  });
  it('keeps the old return and face budget alive independently of the new contact, then still cancels immediately for approval', () => {
    const { avatar, runtime, stroke, render } = touchSetup();
    avatar.beginPetting();
    for (let now = 20; now <= 1600; now += 20) {
      stroke(now);
      render(now);
    }
    avatar.endPetting();
    render(1600);
    vi.setSystemTime(1601);
    avatar.beginPetting();
    stroke(1610);
    expect(render(2511)).toMatchObject({ phase: 'exit', timeMs: 911 });
    const pet = (avatar as unknown as { petting: { sample: (now: number) => number } }).petting;
    expect(pet.sample(2511)).toBeGreaterThan(0);
    expect(pet.sample(2650)).toBe(0);
    avatar.endPetting();
    expect(runtime.petPose).toBe(true);
    avatar.setState('blocked');
    expect(runtime.petPose).toBe(false);
    expect(runtime.poses.sample(2511).phase).toBe('none');
  });
  it('preserves smoothed focus and visible body inputs when recontact carries an old release', () => {
    const { avatar, runtime, stroke, render } = touchSetup();
    const physical = avatar as unknown as {
      petting: { sample: (now: number) => number };
      pettingFocus: { x: number; y: number };
      pettingLook: { x: number; y: number };
    };
    avatar.beginPetting();
    for (let now = 20; now <= 1600; now += 20) {
      stroke(now);
      render(now);
    }
    physical.pettingFocus = { x: 0.8, y: -0.4 };
    physical.pettingLook = { x: 0.6, y: -0.2 };
    avatar.endPetting();
    render(1850);
    const before = physical.petting.sample(1851);
    vi.setSystemTime(1851);
    avatar.beginPetting();
    expect(physical.petting.sample(1851)).toBe(before);
    expect(physical.pettingFocus).toEqual({ x: 0.8, y: -0.4 });
    expect(physical.pettingLook).toEqual({ x: 0.6, y: -0.2 });
    avatar.endPetting();
    vi.setSystemTime(1900);
    avatar.beginPetting();
    expect(physical.petting.sample(1900)).toBe(1);
    avatar.configure({ ...settings, reducedMotion: true });
    expect(runtime.petPose).toBe(false);
    expect(physical.petting.sample(1900)).toBe(1); // reduced motion scales, rather than resets, the same envelope
    avatar.configure({ ...settings, pettingEnabled: false });
    expect(physical.petting.sample(1900)).toBe(0);
    vi.setSystemTime(3000);
    avatar.configure(settings);
    avatar.beginPetting();
    expect(physical.pettingFocus).toEqual({ x: 0, y: 0 });
    expect(physical.pettingLook).toEqual({ x: 0, y: 0 });
  });
  it('retains the original twelve-second hand cap when recontact starts a fresh body budget', () => {
    const { avatar, runtime, stroke, render } = touchSetup();
    avatar.beginPetting();
    for (let now = 50; now <= 11900; now += 50) {
      stroke(now);
      render(now);
    }
    avatar.endPetting();
    render(11900);
    vi.setSystemTime(11901);
    avatar.beginPetting();
    stroke(11910);
    expect(render(11999).phase).toBe('exit');
    expect(render(12000).phase).toBe('none');
    expect(runtime.petPose).toBe(false);
    const pet = (avatar as unknown as { petting: { sample: (now: number) => number } }).petting;
    expect(pet.sample(12000)).toBeGreaterThan(0);
  });
  it('keeps direct contact face and authored hand independent of matching semantic clear', () => {
    const { avatar, runtime, stroke, render } = touchSetup();
    avatar.cue({ ...cue, gesture: 'none' });
    avatar.beginPetting();
    for (let now = 20; now <= 1600; now += 20) {
      stroke(now);
      render(now);
    }
    avatar.clearCue(cue);
    expect(runtime.petPose).toBe(true);
    expect(render(1600).phase).toBe('hold');
    const pet = (avatar as unknown as { petting: { sample: (now: number) => number } }).petting;
    expect(pet.sample(1600)).toBeGreaterThan(0.99);
    avatar.endPetting();
    render(1850);
    avatar.clearCue(cue);
    expect(render(1850)).toMatchObject({ phase: 'exit', timeMs: 250 });
  });
  it('clears only owned hands on new cues, disable, reduced motion, busy/error/approval, reset and disposal', () => {
    for (const boundary of [
      'cue',
      'disable',
      'reduced',
      'thinking',
      'working',
      'blocked',
      'error',
      'reset',
      'dispose',
    ] as const) {
      const { avatar, runtime, stroke, render } = touchSetup();
      avatar.cue({ ...cue, gesture: 'none' });
      avatar.beginPetting();
      stroke(20);
      render(100);
      expect(runtime.petPose).toBe(true);
      if (boundary === 'cue')
        avatar.cue({ ...cue, messageId: 'next', segmentId: 2, gesture: 'none' });
      else if (boundary === 'disable') avatar.configure({ ...settings, pettingEnabled: false });
      else if (boundary === 'reduced') avatar.configure({ ...settings, reducedMotion: true });
      else if (boundary === 'reset') avatar.reset();
      else if (boundary === 'dispose') {
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        (
          window as unknown as { removeEventListener: ReturnType<typeof vi.fn> }
        ).removeEventListener = vi.fn();
        runtime.canvas = { removeEventListener: vi.fn() };
        runtime.runtime = { release: vi.fn() };
        avatar.dispose();
      } else avatar.setState(boundary);
      expect(runtime.petPose).toBe(false);
      expect(runtime.poses.sample(100).phase).toBe('none');
      vi.setSystemTime(0);
    }
  });
});
