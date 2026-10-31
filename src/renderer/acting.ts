import {
  type Attitude,
  type CharacterCue,
  type CharacterPreview,
  type Emotion,
  type Gesture,
} from '../shared/contracts.js';
import type { FaceFrame } from './performance.js';

export type ActingState = 'idle' | 'thinking' | 'working' | 'error' | 'blocked';
export type ActingPreset =
  | Exclude<CharacterPreview, 'reset'>
  | 'neutral'
  | 'acknowledge'
  | 'working'
  | 'sad'
  | 'concerned'
  | 'reassure';
export type ActingPreview = CharacterPreview;
export interface ActingOptions {
  intensity: 'quiet' | 'normal' | 'expressive';
  reducedMotion: boolean;
}
/** Rotations, lean and gaze are normalized [-1,1]; blink (1=open), breath, smile
 * and expressionWeight are [0,1]. These are local model inputs, never window offsets. */
export interface ActingFrame extends FaceFrame {
  headX: number;
  headY: number;
  headZ: number;
  bodyX: number;
  bodyY: number;
  lean: number;
  gazeX: number;
  gazeY: number;
  blink: number;
  breath: number;
  /** Vertical model translation in clip coordinates, not OS window coordinates. */
  offsetY: number;
  smile: number;
  preset: ActingPreset;
  active: boolean;
  expressionWeight: number;
  emotion: Emotion;
  gesture: Gesture;
  attitude?: Attitude;
  variant: number;
  phase: 'idle' | 'anticipation' | 'accent' | 'settle' | 'release';
}
type Pose = Pick<
  ActingFrame,
  | 'headX'
  | 'headY'
  | 'headZ'
  | 'bodyX'
  | 'bodyY'
  | 'lean'
  | 'gazeX'
  | 'gazeY'
  | 'blink'
  | 'smile'
  | keyof FaceFrame
>;
interface Reaction {
  attitude?: Attitude;
  preset: ActingPreset;
  emotion: Emotion;
  gesture: Gesture;
  started: number;
  variant: number;
}
const timing = (preset: ActingPreset): { duration: number; attack: number; release: number } => {
  if (preset === 'acknowledge') return { duration: 1800, attack: 180, release: 500 };
  if (preset === 'surprised') return { duration: 2200, attack: 100, release: 700 };
  if (preset === 'wink') return { duration: 2400, attack: 220, release: 650 };
  if (preset === 'nod' || preset === 'shake') return { duration: 2600, attack: 200, release: 750 };
  if (preset === 'laugh') return { duration: 3600, attack: 250, release: 1000 };
  return { duration: 4200, attack: 450, release: 1100 };
};
export const reactionDuration = (preset: ActingPreset): number => timing(preset).duration;
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
  eyeL: 1,
  eyeR: 1,
  eyeSmile: 0,
  browY: 0,
  browInner: 0,
  pout: 0,
  cheek: 0,
});
const clamp = (x: number, min = -1, max = 1): number => Math.max(min, Math.min(max, x));
const smooth = (x: number): number => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
const beat = (t: number, start: number, attack: number, hold: number, release: number): number =>
  smooth((t - start) / attack) * (1 - smooth((t - start - attack - hold) / release));
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
  acknowledge: {},
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
  wink: { headZ: -0.2, lean: 0.14, smile: 0.65, eyeSmile: 0.5 },
  nod: { smile: 0.28, eyeSmile: 0.25 },
  shake: { gazeX: 0.12, browInner: 0.2 },
  pout: { gazeX: -0.25, headZ: 0.18, headY: -0.1, browY: -0.35, pout: 0.65, cheek: 0.7 },
  laugh: { smile: 0.85, eyeSmile: 0.9, lean: 0.14 },
  heart: { gazeY: 0.06, headZ: 0.18, smile: 0.65, eyeSmile: 0.35, lean: 0.18 },
  grass: { headZ: -0.12, smile: 0.3, eyeSmile: 0.3 },
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
  private lastBeat?: {
    requestId: string;
    segmentId: number;
    messageId?: string;
    stage: 'delivery' | 'semantic' | 'cleared';
  };
  private epoch?: number;
  private gazeAt = 0;
  private gazeIndex = 0;
  private gaze = { x: 0, y: 0 };
  private blinkAt = 0;
  private blinkIndex = 0;
  private variants = new Map<ActingPreset, number>();

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
    // Task progress is a background state. A visible message owns its short
    // reaction until it releases; a new request explicitly resets the actor.
    if (state === 'error' || state === 'blocked') this.reaction = undefined;
    this.state = state;
    if (state === 'blocked') {
      this.reaction = undefined;
      this.pose = neutral();
    }
  }

  cue(
    cue: Pick<CharacterCue, 'emotion' | 'gesture' | 'attitude'> &
      Partial<Pick<CharacterCue, 'requestId' | 'segmentId' | 'messageId' | 'stage'>>,
    nowMs: number,
  ): boolean {
    this.initialize(nowMs);
    const hasAttitude = cue.attitude !== undefined && cue.attitude !== 'neutral';
    const scoped = !!cue.requestId && Number.isSafeInteger(cue.segmentId) && cue.segmentId! > 0;
    const newRequest = scoped && cue.requestId !== this.lastBeat?.requestId;
    const newBeat = scoped && (newRequest || cue.segmentId! > this.lastBeat!.segmentId);
    const sameMessage =
      scoped && !newRequest && !!cue.messageId && cue.messageId === this.lastBeat?.messageId;
    const promotion =
      sameMessage && this.lastBeat?.stage === 'delivery' && cue.stage === 'semantic';
    if (
      this.state === 'blocked' ||
      (scoped && !newBeat) ||
      (sameMessage && !promotion) ||
      (!scoped && cue.emotion === 'neutral' && cue.gesture === 'none' && !hasAttitude)
    )
      return false;
    if (promotion && cue.emotion === 'neutral' && cue.gesture === 'none' && !hasAttitude) {
      // Resolving neutral does not restart the existing delivery beat or its variant.
      this.lastBeat = { ...this.lastBeat!, segmentId: cue.segmentId!, stage: 'semantic' };
      return false;
    }
    const key = `${cue.emotion}/${cue.gesture}/${cue.attitude ?? 'neutral'}`;
    const newMessage = scoped && !!cue.messageId && cue.messageId !== this.lastBeat?.messageId;
    const interval = key === this.lastKey ? 6200 : 900;
    if (!newRequest && !newMessage && !promotion && nowMs - this.lastCue < interval) return false;
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
              : cue.gesture === 'wave'
                ? 'happy'
                : scoped
                  ? 'acknowledge'
                  : 'neutral';
    const variant = this.variants.get(preset) ?? 0;
    this.variants.set(preset, (variant + 1) % 2);
    this.reaction = { preset, ...cue, started: nowMs, variant };
    this.lastKey = key;
    this.lastCue = nowMs;
    if (scoped)
      this.lastBeat = {
        requestId: cue.requestId!,
        segmentId: cue.segmentId!,
        messageId: cue.messageId,
        stage: cue.stage ?? 'semantic',
      };
    return true;
  }

  clearCue(cue: Pick<CharacterCue, 'requestId' | 'messageId' | 'segmentId'>): boolean {
    if (
      !cue.messageId ||
      cue.requestId !== this.lastBeat?.requestId ||
      cue.messageId !== this.lastBeat.messageId ||
      cue.segmentId !== this.lastBeat.segmentId
    )
      return false;
    this.reaction = undefined;
    this.pose = neutral();
    this.lastBeat.stage = 'cleared';
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
    this.reaction = { preset, emotion: emotionFor(preset), gesture, started: nowMs, variant: 0 };
  }

  reset(nowMs: number): void {
    this.state = 'idle';
    this.reaction = undefined;
    this.pose = neutral();
    this.lastKey = '';
    this.lastCue = -Infinity;
    this.lastBeat = undefined;
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
    if (this.reaction && now - this.reaction.started >= timing(this.reaction.preset).duration)
      this.reaction = undefined;
    const reaction = this.reaction;
    const age = reaction ? now - reaction.started : 0;
    const weight = reaction ? this.envelope(age, reaction.preset) : 0;
    const wink =
      reaction &&
      (reaction.preset === 'wink' || (reaction.preset === 'tease' && reaction.variant === 1)) &&
      age > 350 &&
      age < 1400;
    const blink = wink ? 1 : this.pose.blink;
    return {
      ...this.pose,
      eyeL: this.pose.eyeL * blink,
      eyeR: this.pose.eyeR * blink,
      breath: this.state === 'blocked' ? 0.5 : 0.5 + this.breathWave(now) * 0.48 * this.scale(),
      offsetY: this.state === 'blocked' ? 0 : this.breathWave(now) * 0.0045 * this.scale(),
      preset: reaction?.preset ?? this.base(),
      active: !!reaction,
      expressionWeight: weight,
      emotion: reaction?.emotion ?? (this.state === 'error' ? 'concerned' : 'neutral'),
      gesture: reaction?.gesture ?? 'none',
      ...(reaction?.attitude !== undefined ? { attitude: reaction.attitude } : {}),
      variant: reaction?.variant ?? 0,
      phase: !reaction
        ? 'idle'
        : age < timing(reaction.preset).attack
          ? 'anticipation'
          : age < 1200
            ? 'accent'
            : age > timing(reaction.preset).duration - timing(reaction.preset).release
              ? 'release'
              : 'settle',
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
  private envelope(age: number, preset: ActingPreset): number {
    const { duration, attack, release } = timing(preset);
    return smooth(age / attack) * smooth((duration - age) / release);
  }
  private breathWave(now: number): number {
    // A 4.8s relaxed cycle: shorter inhale, longer exhale, zero speed at either end.
    // Keep the clock independent of cues/resets so starting a reaction never restarts a breath.
    const phase = (((now % 4800) + 4800) % 4800) / 4800;
    return phase < 0.42
      ? -Math.cos((Math.PI * phase) / 0.42)
      : Math.cos((Math.PI * (phase - 0.42)) / 0.58);
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
    while (now >= this.blinkAt + (random(70 + this.blinkIndex) > 0.72 ? 445 : 190)) {
      this.blinkIndex++;
      this.blinkAt += 2600 + random(40 + this.blinkIndex) * 4000;
    }
    const reaction = this.reaction;
    const age = reaction ? now - reaction.started : 0;
    const weight = reaction ? this.envelope(age, reaction.preset) : 0;
    // Do not blend a waiting/working pose back into the message's attack or
    // release. Once the reaction expires the latest task state resumes.
    const base = this.target(reaction ? 'neutral' : this.base(), (now - this.epoch!) / 1000);
    const target = reaction ? this.target(reaction.preset, age / 1000, reaction.variant) : base;
    // A gesture carries body/gaze intent independently of the face's emotion or attitude.
    if (reaction?.gesture === 'thinking' || reaction?.gesture === 'explain') {
      const gesture = this.target(reaction.gesture, age / 1000, reaction.variant);
      for (const key of ['headX', 'headY', 'headZ', 'gazeX', 'gazeY'] as const)
        target[key] += (gesture[key] - target[key]) * 0.7;
    }
    const scale = this.scale();
    const blend = (a: number, b: number): number => a + (b - a) * weight;
    const follow = (key: keyof Pose, value: number, rate: number): void => {
      this.pose[key] = clamp(
        this.pose[key] + (value - this.pose[key]) * (1 - Math.exp(-rate * dt)),
      );
    };
    follow('gazeX', (this.gaze.x + blend(base.gazeX, target.gazeX)) * scale, 17);
    follow('gazeY', (this.gaze.y + blend(base.gazeY, target.gazeY)) * scale, 17);
    // Short directional beats need a firmer follow than the slow idle/gaze drift.
    const headFollow =
      reaction?.preset === 'nod' || reaction?.preset === 'shake'
        ? 8.5
        : reaction?.preset === 'acknowledge' || reaction?.preset === 'reassure'
          ? 6.5
          : 4.5;
    follow('headX', this.pose.gazeX * 0.65 + blend(base.headX, target.headX) * scale, headFollow);
    follow('headY', this.pose.gazeY * 0.45 + blend(base.headY, target.headY) * scale, headFollow);
    follow('headZ', blend(base.headZ, target.headZ) * scale, 4);
    follow('bodyX', this.pose.headX * 0.3, 2.1);
    follow('bodyY', this.pose.headY * 0.2 + this.breathWave(now) * 0.13 * scale, 2.1);
    follow('lean', blend(base.lean, target.lean) * scale, 2.5);
    follow('smile', blend(base.smile, target.smile), 6);
    for (const key of ['eyeL', 'eyeR'] as const)
      follow(
        key,
        1 + (blend(base[key], target[key]) - 1) * (this.options.reducedMotion ? 0.18 : 1),
        28,
      );
    for (const key of ['eyeSmile', 'browY', 'browInner', 'pout', 'cheek'] as const)
      follow(key, blend(base[key], target[key]) * scale, 9);
    const blinkAge = now - this.blinkAt;
    // Occasional double blinks, with a shorter closure than reopening.
    const closure = (age: number): number =>
      age < 0 || age >= 190 ? 0 : age < 65 ? smooth(age / 65) : 1 - smooth((age - 65) / 125);
    this.pose.blink =
      1 -
      Math.max(
        closure(blinkAge),
        random(70 + this.blinkIndex) > 0.72 ? closure(blinkAge - 255) : 0,
      );
  }

  private target(preset: ActingPreset, t: number, variant = 0): Pose {
    const p = { ...neutral(), ...PROFILES[preset] };
    const nod = Math.sin(t * 4.8) * Math.exp(-Math.max(0, t - 1) * 0.8);
    if (preset === 'acknowledge') {
      // "No deliberate gesture" still gets a visible, one-shot delivery beat.
      // It remains emotionally neutral and never requests an authored hand pose.
      const accent = beat(t, 0.08, 0.18, 0.12, 0.65);
      p.headY = -0.48 * accent;
      p.headZ = (variant ? -1 : 1) * 0.12 * accent;
      p.lean = 0.04 * accent;
      p.browY = 0.08 * accent;
    }
    if (preset === 'explain') p.headY = nod * 0.13;
    if (preset === 'happy') {
      p.headZ = Math.sin(t * 3.1) * 0.18 * (variant ? -1 : 1);
      p.headY = nod * 0.15;
      p.eyeSmile = variant ? 0.85 : 0.65;
      if (variant) p.smile = 0.72;
      p.browY = 0.12;
    }
    // Look away first, then cautiously return the eyes while retaining the shy tilt.
    if (preset === 'shy') {
      p.gazeX *= (variant ? -1 : 1) * (1 - smooth((t - 1.6) / 1.3));
      if (variant) p.headZ *= -0.75;
    }
    if (preset === 'shy') {
      p.eyeL = p.eyeR = 0.82;
      p.browInner = 0.22;
      p.eyeSmile = 0.25;
      p.headZ += 0.06 * beat(t, 0.6, 0.2, 0.4, 0.7);
    }
    if (preset === 'thinking') {
      p.browInner = 0.3;
      p.eyeL = p.eyeR = 0.86;
      // A second, smaller glance after the first look-up; no window translation.
      p.gazeX *= 1 - 0.4 * beat(t % 5.2, 2, 0.4, 0.5, 0.6);
    }
    if (preset === 'tease') {
      p.eyeL = p.eyeR = 0.72;
      p.eyeSmile = 0.45;
      if (variant === 1) p.eyeR = 1 - beat(t, 0.45, 0.12, 0.3, 0.25);
      p.headZ -= 0.07 * beat(t, 0.35, 0.2, 0.4, 0.7);
    }
    if (preset === 'wink') p[variant ? 'eyeR' : 'eyeL'] = 1 - beat(t, 0.45, 0.12, 0.3, 0.25);
    if (preset === 'nod' || preset === 'reassure')
      p.headY +=
        Math.sin(Math.max(0, t - 0.25) * 6.4) *
        (preset === 'nod' ? 0.6 : 0.36) *
        beat(t, 0.15, 0.2, 0.6, 1);
    if (preset === 'shake')
      p.headX = Math.sin(Math.max(0, t - 0.25) * 9) * 0.52 * beat(t, 0.15, 0.2, 0.6, 1);
    if (preset === 'pout') {
      p.headX = -0.16 * beat(t, 0.35, 0.3, 1, 1);
      p.eyeL = p.eyeR = 0.7;
    }
    if (preset === 'laugh') {
      const laugh = beat(t, 0.25, 0.2, 1.3, 0.8);
      p.eyeL = p.eyeR = 1 - 0.9 * laugh;
      p.headY = Math.sin(t * 12) * 0.06 * laugh;
      p.headZ = Math.sin(t * 3) * 0.09 * laugh;
    }
    if (preset === 'surprised') {
      const recoil = beat(t, 0, 0.09, 0.15, 0.7);
      p.lean -= 0.22 * recoil;
      p.headY += 0.12 * recoil;
      p.browInner = 0.35;
    }
    if (preset === 'sad' || preset === 'concerned') p.browInner = 0.38;
    if (preset === 'explain') {
      p.browY = 0.14;
      p.eyeSmile = variant ? 0.35 : 0.2;
      if (variant) p.gazeX = 0.12;
    }
    if (preset === 'neutral') {
      p.headZ = Math.sin(t * 0.79) * 0.025;
      p.lean = Math.sin(t * 1.21) * 0.018;
    }
    return p;
  }
}
