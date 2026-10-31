import type { Attitude, CharacterCue, Emotion, Gesture } from '../shared/contracts.js';

export type ActingState = 'idle' | 'thinking' | 'working' | 'error' | 'blocked';
export type ActingPreset =
  | 'neutral'
  | 'thinking'
  | 'working'
  | 'explain'
  | 'shy'
  | 'tease'
  | 'happy'
  | 'sad'
  | 'concerned'
  | 'surprised'
  | 'reassure';
export type ActingPreview = 'thinking' | 'explain' | 'shy' | 'tease' | 'happy' | 'reset';
export interface ActingOptions {
  intensity: 'quiet' | 'normal' | 'expressive';
  reducedMotion: boolean;
}
/** Rotations, lean and gaze are normalized [-1,1]; blink (1=open), smile
 * and expressionWeight are [0,1]. These are local model inputs, never window offsets. */
export interface ActingFrame {
  headX: number;
  headY: number;
  headZ: number;
  bodyX: number;
  bodyY: number;
  lean: number;
  gazeX: number;
  gazeY: number;
  blink: number;
  smile: number;
  preset: ActingPreset;
  active: boolean;
  expressionWeight: number;
  emotion: Emotion;
  gesture: Gesture;
  attitude?: Attitude;
}
type Pose = Pick<
  ActingFrame,
  'headX' | 'headY' | 'headZ' | 'bodyX' | 'bodyY' | 'lean' | 'gazeX' | 'gazeY' | 'blink' | 'smile'
>;
interface Reaction {
  attitude?: Attitude;
  preset: ActingPreset;
  emotion: Emotion;
  gesture: Gesture;
  started: number;
}
const DURATION = 4200;
const neutral = (): Pose => ({
  headX: 0,
  headY: 0,
  headZ: 0,
  bodyX: 0,
  bodyY: 0,
  lean: 0,
  gazeX: 0,
  gazeY: 0,
  blink: 1,
  smile: 0,
});
const clamp = (x: number, min = -1, max = 1): number => Math.max(min, Math.min(max, x));
const smooth = (x: number): number => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
// A stable integer hash gives irregular schedules without global randomness or wall clocks.
const random = (n: number): number => {
  let x = Math.imul(n + 173, 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};
const emotionFor = (preset: ActingPreset): Emotion =>
  preset === 'shy'
    ? 'embarrassed'
    : ['happy', 'sad', 'concerned', 'surprised'].includes(preset)
      ? (preset as Emotion)
      : 'neutral';

const PROFILES: Record<ActingPreset, Partial<Pose>> = {
  neutral: {},
  thinking: { gazeX: 0.34, gazeY: 0.3, headZ: -0.2, headY: 0.08 },
  working: { gazeX: -0.15, gazeY: -0.3, headY: -0.1, lean: 0.18 },
  explain: { gazeX: -0.08, headZ: 0.1, lean: 0.22, smile: 0.25 },
  shy: { gazeX: -0.52, gazeY: -0.4, headY: -0.22, headZ: 0.24, lean: -0.13, smile: 0.22 },
  tease: { gazeX: 0.28, headZ: -0.32, headY: -0.05, lean: 0.3, smile: 0.6 },
  happy: { lean: 0.16, smile: 0.85 },
  sad: { gazeY: -0.35, headY: -0.28, headZ: 0.12, lean: -0.2 },
  concerned: { gazeX: -0.18, headZ: 0.2, headY: -0.12, lean: 0.08 },
  surprised: { gazeY: 0.18, headY: 0.2, lean: -0.3 },
  reassure: { gazeX: -0.05, headZ: 0.1, headY: -0.06, lean: 0.1, smile: 0.35 },
};

/** Pure, deterministic local actor. Call sample with a monotonic clock and elapsed seconds.
 * Missing frames advance the schedules by time; damping uses bounded time substeps. */
export class ActingController {
  private options: ActingOptions = { intensity: 'normal', reducedMotion: false };
  private state: ActingState = 'idle';
  private pose = neutral();
  private reaction?: Reaction;
  private lastKey = '';
  private lastCue = -Infinity;
  private epoch?: number;
  private gazeAt = 0;
  private gazeIndex = 0;
  private gaze = { x: 0, y: 0 };
  private blinkAt = 0;
  private blinkIndex = 0;

  configure(options: ActingOptions): void {
    this.options = { ...options };
    // Changing accessibility options also limits the current pose immediately.
    const limit = this.scale();
    for (const key of [
      'headX',
      'headY',
      'headZ',
      'bodyX',
      'bodyY',
      'lean',
      'gazeX',
      'gazeY',
    ] as const)
      this.pose[key] = clamp(this.pose[key], -limit, limit);
  }

  setState(state: ActingState, nowMs: number): void {
    this.initialize(nowMs);
    if (state !== this.state && state !== 'idle') this.reaction = undefined;
    this.state = state;
    if (state === 'blocked') {
      this.reaction = undefined;
      this.pose = neutral();
    }
  }

  cue(cue: Pick<CharacterCue, 'emotion' | 'gesture' | 'attitude'>, nowMs: number): boolean {
    this.initialize(nowMs);
    const hasAttitude = cue.attitude !== undefined && cue.attitude !== 'neutral';
    if (
      this.state === 'blocked' ||
      (cue.emotion === 'neutral' && cue.gesture === 'none' && !hasAttitude)
    )
      return false;
    const key = `${cue.emotion}/${cue.gesture}/${cue.attitude ?? 'neutral'}`;
    if (nowMs - this.lastCue < (key === this.lastKey ? 6200 : 900)) return false;
    const preset: ActingPreset = hasAttitude
      ? (cue.attitude as Exclude<Attitude, 'neutral'>)
      : cue.emotion === 'embarrassed'
        ? 'shy'
        : cue.emotion !== 'neutral'
          ? cue.emotion
          : cue.gesture === 'explain'
            ? 'explain'
            : cue.gesture === 'thinking'
              ? 'thinking'
              : 'happy';
    this.reaction = { preset, ...cue, started: nowMs };
    this.lastKey = key;
    this.lastCue = nowMs;
    return true;
  }

  preview(preset: ActingPreview, nowMs: number): void {
    if (preset === 'reset') {
      this.reset(nowMs);
      return;
    }
    this.initialize(nowMs);
    if (this.state === 'blocked') return;
    const gesture: Gesture =
      preset === 'thinking' ? 'thinking' : preset === 'explain' ? 'explain' : 'none';
    this.reaction = { preset, emotion: emotionFor(preset), gesture, started: nowMs };
  }

  reset(nowMs: number): void {
    this.state = 'idle';
    this.reaction = undefined;
    this.pose = neutral();
    this.lastKey = '';
    this.lastCue = -Infinity;
    this.epoch = undefined;
    this.initialize(nowMs);
  }

  sample(nowMs: number, dtSecs: number): ActingFrame {
    const now = Number.isFinite(nowMs) ? nowMs : (this.epoch ?? 0);
    const dt = Number.isFinite(dtSecs) ? clamp(dtSecs, 0, 1) : 0;
    this.initialize(now - dt * 1000);
    if (this.state !== 'blocked') {
      // Same integration lattice at 30/60/120Hz; never one blend increment per rendered frame.
      const steps = Math.max(1, Math.ceil(dt * 120 - 1e-8));
      for (let i = 1; i <= steps; i++)
        this.advance(now - dt * 1000 + (i * dt * 1000) / steps, dt / steps);
    }
    if (this.reaction && now - this.reaction.started >= DURATION) this.reaction = undefined;
    const reaction = this.reaction;
    const weight = reaction ? this.envelope(now - reaction.started) : 0;
    return {
      ...this.pose,
      preset: reaction?.preset ?? this.base(),
      active: !!reaction,
      expressionWeight: weight,
      emotion: reaction?.emotion ?? (this.state === 'error' ? 'concerned' : 'neutral'),
      gesture: reaction?.gesture ?? 'none',
      ...(reaction?.attitude !== undefined ? { attitude: reaction.attitude } : {}),
    };
  }

  private initialize(now: number): void {
    if (this.epoch !== undefined) return;
    this.epoch = now;
    this.gazeIndex = this.blinkIndex = 0;
    this.gaze = { x: 0, y: 0 };
    this.gazeAt = now + 700;
    this.blinkAt = now + 2300 + random(40) * 1800;
  }
  private scale(): number {
    return (
      { quiet: 0.35, normal: 0.65, expressive: 1 }[this.options.intensity] *
      (this.options.reducedMotion ? 0.18 : 1)
    );
  }
  private base(): ActingPreset {
    return this.state === 'error'
      ? 'concerned'
      : this.state === 'blocked' || this.state === 'idle'
        ? 'neutral'
        : this.state;
  }
  private envelope(age: number): number {
    return smooth(age / 450) * smooth((DURATION - age) / 1100);
  }
  private advance(now: number, dt: number): void {
    while (now >= this.gazeAt) {
      this.gazeIndex++;
      this.gaze = {
        x: (random(this.gazeIndex * 3) - 0.5) * 0.32,
        y: (random(this.gazeIndex * 3 + 1) - 0.5) * 0.2,
      };
      this.gazeAt += 1800 + random(this.gazeIndex * 3 + 2) * 3100;
    }
    while (now >= this.blinkAt + 190) {
      this.blinkIndex++;
      this.blinkAt += 2600 + random(40 + this.blinkIndex) * 4000;
    }
    const reaction = this.reaction;
    const age = reaction ? now - reaction.started : 0;
    const weight = reaction ? this.envelope(age) : 0;
    const base = this.target(this.base(), (now - this.epoch!) / 1000);
    const target = reaction ? this.target(reaction.preset, age / 1000) : base;
    const scale = this.scale();
    const blend = (a: number, b: number): number => a + (b - a) * weight;
    const follow = (key: keyof Pose, value: number, rate: number): void => {
      this.pose[key] = clamp(
        this.pose[key] + (value - this.pose[key]) * (1 - Math.exp(-rate * dt)),
      );
    };
    follow('gazeX', (this.gaze.x + blend(base.gazeX, target.gazeX)) * scale, 17);
    follow('gazeY', (this.gaze.y + blend(base.gazeY, target.gazeY)) * scale, 17);
    follow('headX', this.pose.gazeX * 0.65 + blend(base.headX, target.headX) * scale, 4.5);
    follow('headY', this.pose.gazeY * 0.45 + blend(base.headY, target.headY) * scale, 4.5);
    follow('headZ', blend(base.headZ, target.headZ) * scale, 4);
    follow('bodyX', this.pose.headX * 0.3, 2.1);
    follow('bodyY', this.pose.headY * 0.2, 2.1);
    follow('lean', blend(base.lean, target.lean) * scale, 2.5);
    follow('smile', blend(base.smile, target.smile), 6);
    const blinkAge = now - this.blinkAt;
    this.pose.blink =
      blinkAge >= 0 && blinkAge < 190 ? 1 - Math.sin((Math.PI * blinkAge) / 190) ** 2 : 1;
  }

  private target(preset: ActingPreset, t: number): Pose {
    const p = { ...neutral(), ...PROFILES[preset] };
    const nod = Math.sin(t * 4.8) * Math.exp(-Math.max(0, t - 1) * 0.8);
    if (preset === 'explain') p.headY = nod * 0.13;
    if (preset === 'happy') {
      p.headZ = Math.sin(t * 3.1) * 0.18;
      p.headY = nod * 0.15;
    }
    // Look away first, then cautiously return the eyes while retaining the shy tilt.
    if (preset === 'shy') p.gazeX *= 1 - smooth((t - 1.6) / 1.3);
    if (preset === 'neutral') {
      p.headZ = Math.sin(t * 0.79) * 0.025;
      p.lean = Math.sin(t * 1.21) * 0.018;
    }
    return p;
  }
}
