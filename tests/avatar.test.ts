import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelInventory } from '../src/shared/contracts.js';
import type { ActingFrame } from '../src/renderer/acting.js';
import type { ExpressionLayer, ExpressionParameter } from '../src/renderer/performance.js';

vi.mock('@cubism/live2dcubismframework', () => ({ CubismFramework: {} }));
vi.mock('@cubism/model/cubismusermodel', () => ({ CubismUserModel: class {} }));
vi.mock('@cubism/motion/cubismmotionmanager', () => ({
  CubismMotionManager: class {
    stopAllMotions = vi.fn();
    startMotionPriority = vi.fn();
    isFinished = () => false;
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
