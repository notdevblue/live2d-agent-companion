import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelInventory } from '../src/shared/contracts.js';

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
  gestureMap: { thinking: 'waiting', explain: 'explain' },
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
    actor: { sample: (now: number, dt: number) => { active: boolean; preset: string } };
    mixer: { sample: (now: number) => unknown[] };
    poses: { sample: (now: number) => { phase: string; definition?: { parameter: string } } };
    motions: Map<string, unknown>;
    poseDefinitions: Map<string, unknown>;
  };
  for (const [name, parameter] of [
    ['waiting', 'wait'],
    ['explain', 'hand'],
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
    expect(runtime.actor.sample(2400, 0).active).toBe(false);
    expect(runtime.poses.sample(3000).phase).toBe('exit');
    vi.setSystemTime(3000);
    avatar.setState('thinking');
    expect(runtime.poses.sample(3000).phase).toBe('exit');
    avatar.setState('blocked');
    expect(runtime.poses.sample(3000).phase).toBe('none');
    expect(runtime.mixer.sample(3000)).toEqual([]);
    expect(runtime.actor.sample(3000, 0)).toMatchObject({ preset: 'neutral', active: false });
    avatar.setState('idle');
    expect(runtime.poses.sample(3100).phase).toBe('none');
    expect(runtime.actor.sample(3100, 0).active).toBe(false);
  });
});
