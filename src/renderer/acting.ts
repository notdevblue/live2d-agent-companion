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
/** Rotations, lean, gaze and smile are normalized [-1,1]; blink (1=open), breath
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
  /** Small semantic mouth opening, never phoneme or speech animation. */
  mouthOpen: number;
  preset: ActingPreset;
  active: boolean;
  expressionWeight: number;
  emotion: Emotion;
  gesture: Gesture;
  attitude?: Attitude;
  variant: number;
  phase: 'idle' | 'anticipation' | 'accent' | 'settle' | 'release' | 'afterglow';
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
  | 'mouthOpen'
  | keyof FaceFrame
>;
interface Reaction {
  attitude?: Attitude;
  preset: ActingPreset;
  emotion: Emotion;
  gesture: Gesture;
  started: number;
  variant: number;
  afterglow: boolean;
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
/** The semantic afterglow budget includes expression fade and authored hand return.
 * Delivery cues and local previews retain the original accent duration. */
export const reactionLifetime = (
  preset: ActingPreset,
  stage: 'delivery' | 'semantic' = 'semantic',
): number => reactionDuration(preset) + (stage === 'semantic' ? 12000 : 0);
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
  mouthOpen: 0,
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
const teaseWink = (t: number, variant: number): number =>
  beat(t, variant ? 0.45 : 0.85, 0.12, 0.35, 0.3);
const accentTime = (preset: ActingPreset, t: number, variant: number): number =>
  variant && ['happy', 'laugh', 'shy', 'tease', 'angry', 'confused'].includes(preset)
    ? Math.max(0, (t - 0.18) / 1.12)
    : t;
// A stable integer hash gives irregular schedules without global randomness or wall clocks.
const random = (n: number): number => {
  let x = Math.imul(n + 173, 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};
const emotionFor = (preset: ActingPreset): Emotion =>
  preset === 'shy'
    ? 'embarrassed'
    : ['happy', 'sad', 'concerned', 'surprised', 'angry', 'confused'].includes(preset)
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
  wave: { headZ: -0.1, lean: 0.1, smile: 0.55, eyeSmile: 0.35 },
  angry: {
    headY: -0.1,
    headZ: -0.08,
    lean: 0.1,
    gazeY: -0.04,
    browY: -0.65,
    pout: 0.4,
    cheek: 0.18,
    eyeL: 1,
    eyeR: 1,
  },
  confused: {
    headZ: 0.26,
    headY: -0.08,
    lean: -0.08,
    gazeX: -0.12,
    browInner: 0.42,
    browY: 0.12,
    eyeL: 0.82,
    eyeR: 1,
  },
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
  private gazeSince = 0;
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
      this.pose[key] = clamp(
        this.pose[key],
        -limit * (key === 'headX' ? 0.7 : key === 'bodyX' ? 0.5 : 1),
        limit * (key === 'headX' ? 0.7 : key === 'bodyX' ? 0.5 : 1),
      );
  }

  setState(state: ActingState, nowMs: number): void {
    this.initialize(nowMs);
    // Task progress is a background state. A visible message owns its bounded
    // reaction until it releases; a new request explicitly resets the actor.
    if (state === 'error' || state === 'blocked') {
      this.reaction = undefined;
      this.pose = neutral();
    }
    this.state = state;
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
      // Resolving neutral adds only a bounded mouth afterglow. It never restarts
      // the original delivery beat or spends a new variant, even after its accent.
      if (this.reaction) this.reaction.afterglow = true;
      else if (nowMs - this.lastCue < reactionLifetime('acknowledge'))
        this.reaction = {
          preset: 'acknowledge',
          emotion: 'neutral',
          gesture: 'none',
          started: this.lastCue,
          variant: 0,
          afterglow: true,
        };
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
    this.reaction = {
      preset,
      ...cue,
      started: nowMs,
      variant,
      afterglow: cue.stage !== 'delivery',
    };
    if (cue.emotion === 'angry' || cue.emotion === 'confused') this.pose.mouthOpen = 0;
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

  /** Exact cue ownership and its original clock, including neutral promotion.
   * Query before and after cue() to distinguish a promotion from a duplicate. */
  reactionTiming(
    cue: Pick<CharacterCue, 'requestId' | 'messageId' | 'segmentId'>,
    nowMs: number,
  ): { started: number; duration: number; lifetime: number } | undefined {
    const reaction = this.reaction;
    if (
      !reaction ||
      !Number.isFinite(nowMs) ||
      !this.lastBeat ||
      this.lastBeat.stage === 'cleared' ||
      cue.requestId !== this.lastBeat.requestId ||
      cue.messageId !== this.lastBeat.messageId ||
      cue.segmentId !== this.lastBeat.segmentId
    )
      return undefined;
    const duration = reactionDuration(reaction.preset);
    const lifetime = reactionLifetime(
      reaction.preset,
      reaction.afterglow ? 'semantic' : 'delivery',
    );
    return nowMs - reaction.started < lifetime
      ? { started: reaction.started, duration, lifetime }
      : undefined;
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
      preset === 'thinking'
        ? 'thinking'
        : preset === 'explain'
          ? 'explain'
          : preset === 'wave'
            ? 'wave'
            : 'none';
    this.reaction = {
      preset,
      emotion: emotionFor(preset),
      gesture,
      started: nowMs,
      variant: 0,
      afterglow: false,
    };
    if (preset === 'angry' || preset === 'confused') this.pose.mouthOpen = 0;
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
    if (
      this.reaction &&
      now - this.reaction.started >=
        reactionLifetime(this.reaction.preset, this.reaction.afterglow ? 'semantic' : 'delivery')
    ) {
      // A damped face must not trail beyond the semantic deadline.
      if (this.reaction.afterglow)
        for (const key of [
          'smile',
          'mouthOpen',
          'eyeSmile',
          'browY',
          'browInner',
          'pout',
          'cheek',
        ] as const)
          this.pose[key] = 0;
      if (this.reaction.afterglow) this.pose.eyeL = this.pose.eyeR = 1;
      this.reaction = undefined;
    }
    const reaction = this.reaction;
    const age = reaction ? now - reaction.started : 0;
    const weight = reaction ? this.envelope(age, reaction.preset) : 0;
    const performanceAge = reaction
      ? accentTime(
          reaction.preset,
          (age - (reaction.emotion === 'embarrassed' && reaction.preset === 'laugh' ? 900 : 0)) /
            1000,
          reaction.variant,
        ) * 1000
      : 0;
    const wink =
      reaction &&
      ((reaction.preset === 'wink' && performanceAge > 350 && performanceAge < 1400) ||
        (reaction.preset === 'tease' &&
          performanceAge > (reaction.variant ? 350 : 750) &&
          performanceAge < (reaction.variant ? 1400 : 1800)) ||
        (reaction.preset === 'laugh' &&
          reaction.variant === 1 &&
          performanceAge > 2000 &&
          performanceAge < 2800));
    const blink = wink ? 1 : this.pose.blink;
    return {
      ...this.pose,
      eyeL: this.pose.eyeL * blink,
      eyeR: this.pose.eyeR * blink,
      breath: this.state === 'blocked' ? 0.5 : 0.5 + this.breathWave(now) * 0.48 * this.scale(),
      offsetY: this.state === 'blocked' ? 0 : this.breathWave(now) * 0.0045 * this.scale(),
      preset: reaction?.preset ?? this.base(),
      active: !!reaction,
      expressionWeight: weight + this.residueWeight(reaction, age) * this.scale(),
      emotion: reaction?.emotion ?? (this.state === 'error' ? 'concerned' : 'neutral'),
      gesture: reaction?.gesture ?? 'none',
      ...(reaction?.attitude !== undefined ? { attitude: reaction.attitude } : {}),
      variant: reaction?.variant ?? 0,
      phase: !reaction
        ? 'idle'
        : age >= reactionDuration(reaction.preset)
          ? 'afterglow'
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
    this.gazeSince = now;
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
  private afterglowFade(reaction: Reaction | undefined, age: number): number {
    if (!reaction?.afterglow) return 0;
    const end = reactionLifetime(reaction.preset);
    return 1 - smooth((age - (end - 1000)) / 1000);
  }
  private residueWeight(reaction: Reaction | undefined, age: number): number {
    if (!reaction?.afterglow) return 0;
    const { duration, release } = timing(reaction.preset);
    if (age < duration - release) return 0;
    return 0.4 * (1 - this.envelope(age, reaction.preset)) * this.afterglowFade(reaction, age);
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
      this.gazeSince = this.gazeAt;
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
    const target = reaction ? this.reactionTarget(reaction, age / 1000) : base;
    // A gesture carries body/gaze intent independently of the face's emotion or attitude.
    if (reaction?.gesture === 'thinking' || reaction?.gesture === 'explain') {
      const gesture = this.amplifyIntent(
        this.target(reaction.gesture, age / 1000, reaction.variant),
      );
      for (const key of ['headX', 'headY', 'headZ', 'gazeX', 'gazeY'] as const)
        target[key] += (gesture[key] - target[key]) * 0.7;
    }
    // Authored explain hands enter around 1.25s. Synchronize two finite local
    // head/brow beats without shortening the hand hold or reviving body accents.
    const explainBeat =
      reaction?.gesture === 'explain'
        ? beat(age / 1000, 1.05, 0.15, 0.1, 0.35) + beat(age / 1000, 7.25, 0.15, 0.1, 0.35)
        : 0;
    const maintenance = this.maintenanceTarget(reaction, age / 1000);
    const idleGaze = !reaction && this.state === 'idle' && this.gazeIndex > 0;
    const idleAge = (now - this.gazeSince) / 1000;
    const idleTilt = idleGaze ? 0.35 * beat(idleAge, 0, 0.35, 0.55, 0.8) : 0;
    const reconnect = idleGaze ? 1 - 0.55 * smooth((idleAge - 0.65) / 0.85) : 1;
    const scale = this.scale();
    const blend = (a: number, b: number): number => a + (b - a) * weight;
    const follow = (key: keyof Pose, value: number, rate: number): void => {
      this.pose[key] = clamp(
        this.pose[key] + (value - this.pose[key]) * (1 - Math.exp(-rate * dt)),
      );
    };
    follow(
      'gazeX',
      (this.gaze.x * reconnect * (idleGaze ? 2.5 : 1) +
        blend(base.gazeX, target.gazeX) +
        maintenance.pose.gazeX * maintenance.weight) *
        scale,
      17,
    );
    follow(
      'gazeY',
      (this.gaze.y * reconnect * (idleGaze ? 2.5 : 1) +
        blend(base.gazeY, target.gazeY) +
        maintenance.pose.gazeY * maintenance.weight) *
        scale,
      17,
    );
    // Short directional beats need a firmer follow than the slow idle/gaze drift.
    const headFollow =
      reaction?.preset === 'nod' || reaction?.preset === 'shake' || explainBeat > 1e-8
        ? 8.5
        : reaction?.preset === 'acknowledge' || reaction?.preset === 'reassure'
          ? 6.5
          : 4.5;
    follow(
      'headX',
      // The actual rig turns visibly around normalized .3–.45 at normal.
      // Couple gaze to the head before the torso follows, bounding the complete
      // target so an authored emotional lean cannot add an excessive turn.
      clamp(
        this.pose.gazeX * 1.6 +
          (blend(base.headX, target.headX) + maintenance.pose.headX * maintenance.weight) * scale,
        -0.7 * scale,
        0.7 * scale,
      ),
      headFollow,
    );
    follow(
      'headY',
      this.pose.gazeY * 0.45 +
        (blend(base.headY, target.headY) -
          0.58 * explainBeat +
          maintenance.pose.headY * maintenance.weight) *
          scale,
      headFollow,
    );
    follow(
      'headZ',
      (blend(base.headZ, target.headZ) +
        maintenance.pose.headZ * maintenance.weight +
        (this.gaze.x < 0 ? -1 : 1) * idleTilt) *
        scale,
      4,
    );
    // A delayed torso inclination stays inside the measured safe PositionX range.
    follow('bodyX', clamp(this.pose.headX * 0.65, -0.5 * scale, 0.5 * scale), 2.1);
    follow('bodyY', this.pose.headY * 0.2 + this.breathWave(now) * 0.13 * scale, 2.1);
    follow(
      'lean',
      (blend(base.lean, target.lean) + maintenance.pose.lean * maintenance.weight) * scale,
      2.5,
    );
    // Accent and held emotion are separate targets. The existing release clock
    // crossfades them; a low generic smile cannot erase the selected emotion.
    const heldFace = this.heldFace(reaction, age / 1000);
    follow(
      'smile',
      blend(base.smile, target.smile) + heldFace.smile * maintenance.weight * scale,
      6,
    );
    const mouthWeight = reaction?.afterglow
      ? smooth(
          (age - (reactionDuration(reaction.preset) - timing(reaction.preset).release)) /
            timing(reaction.preset).release,
        ) * this.afterglowFade(reaction, age)
      : 0;
    const closedMouth =
      reaction?.emotion === 'angry' ||
      reaction?.preset === 'angry' ||
      reaction?.emotion === 'confused' ||
      reaction?.preset === 'confused';
    follow(
      'mouthOpen',
      closedMouth
        ? 0
        : (target.mouthOpen * weight + Math.max(0.12, heldFace.mouthOpen) * mouthWeight) * scale,
      12,
    );
    for (const key of ['eyeL', 'eyeR'] as const) {
      const accentEye = reaction?.preset === 'angry' ? target[key] : blend(base[key], target[key]);
      const eye =
        accentEye +
        (heldFace[key] - accentEye) *
          maintenance.weight *
          { quiet: 0.35, normal: 0.65, expressive: 1 }[this.options.intensity];
      follow(key, 1 + (eye - 1) * (this.options.reducedMotion ? 0.18 : 1), 28);
    }
    for (const key of ['eyeSmile', 'browY', 'browInner', 'pout', 'cheek'] as const) {
      const explainBrow = key === 'browY' ? 0.2 * explainBeat : 0;
      follow(
        key,
        (blend(base[key], target[key]) + heldFace[key] * maintenance.weight + explainBrow) * scale,
        9,
      );
    }
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

  private heldFace(reaction: Reaction | undefined, t: number): Pose {
    const face = neutral();
    if (!reaction?.afterglow || reaction.preset === 'acknowledge') return face;
    const glance = Math.abs(beat(t, 5.1, 0.4, 0.65, 0.6) - beat(t, 9.6, 0.4, 0.65, 0.6));
    if (reaction.preset === 'happy' || reaction.preset === 'laugh' || reaction.gesture === 'wave') {
      face.smile = 0.58;
      face.eyeSmile = 0.78 + 0.06 * glance;
      // This rig's EyeSmile is subtle. Lids carry the joy shape; open them
      // during the finite attention glance instead of holding a sleepy half-eye.
      face.eyeL = face.eyeR = 0.08 + 0.55 * glance;
      face.mouthOpen = reaction.preset === 'happy' ? 0.18 : 0;
      face.browY = 0.12;
    }
    if (reaction.gesture === 'explain' || reaction.preset === 'explain') {
      face.smile = 0.4;
      face.eyeSmile = 0.55 + 0.1 * glance;
      face.eyeL = face.eyeR = 0.62 + 0.25 * glance;
      face.browY = 0.15;
    }
    if (reaction.preset === 'tease') {
      face.smile = 0.7;
      face.eyeSmile = 0.3;
      face.eyeL = reaction.variant ? 0.96 : 0.08;
      face.eyeR = reaction.variant ? 0.08 : 0.96;
      face.browY = 0.08;
    }
    // Emotion remains present when an attitude supplies the accent sequence.
    if (reaction.preset === 'shy' || reaction.emotion === 'embarrassed') {
      face.smile = 0.2;
      face.eyeSmile = 0.35;
      face.eyeL = 0.7;
      face.eyeR = 0.8;
      face.browInner = 0.28;
    }
    if (reaction.emotion === 'concerned' || reaction.preset === 'concerned') {
      face.smile = reaction.preset === 'tease' ? -0.16 : -0.1;
      face.eyeSmile = 0.05;
      face.eyeL = 0.58;
      face.eyeR = 0.76;
      face.browInner = 0.62;
      face.browY = 0.1;
      face.pout = 0.1;
    }
    if (reaction.emotion === 'sad' || reaction.preset === 'sad') {
      face.smile = -0.2;
      face.eyeL = face.eyeR = 0.7;
      face.browInner = 0.5;
      face.browY = -0.16;
    }
    if (reaction.emotion === 'angry' || reaction.preset === 'angry') {
      face.smile = -0.5;
      face.eyeSmile = 0;
      face.eyeL = face.eyeR = 0.55;
      face.browY = -0.48;
      face.pout = 0.12;
      face.cheek = 0.06;
    }
    if (reaction.emotion === 'confused' || reaction.preset === 'confused') {
      face.smile = -0.18;
      face.eyeSmile = 0;
      face.eyeL = 0.62;
      face.eyeR = 0.96;
      face.browInner = 0.5;
      face.browY = 0.16;
      face.pout = 0.22;
    }
    if (reaction.preset === 'reassure' && reaction.emotion === 'neutral') {
      face.smile = 0.3;
      face.eyeSmile = 0.4;
      face.eyeL = face.eyeR = 0.72;
    }
    if (reaction.gesture === 'explain' || reaction.gesture === 'wave') face.browY += 0.1 * glance;
    return face;
  }

  private maintenanceTarget(
    reaction: Reaction | undefined,
    t: number,
  ): { pose: Pose; weight: number } {
    const pose = neutral();
    if (!reaction?.afterglow || reaction.preset === 'acknowledge') return { pose, weight: 0 };
    const { duration, release } = timing(reaction.preset);
    const end = reactionLifetime(reaction.preset) / 1000;
    const weight =
      smooth((t - (duration - release) / 1000) / (release / 1000)) * smooth((end - t) / 1.8);
    // A finite attention phrase: look toward the listener, glance, reconnect.
    // No randomized reactions and no new mouth/speech clock during the hold.
    const glance = beat(t, 5.1, 0.4, 0.65, 0.6) - beat(t, 9.6, 0.4, 0.65, 0.6);
    const sway = Math.sin(((t - duration / 1000) * Math.PI) / 2.8);
    const direction = reaction.variant ? -1 : 1;
    pose.headZ = direction * (0.12 + 0.08 * sway);
    pose.headX = 0.1 * glance;
    pose.gazeX = 0.28 * glance;
    pose.gazeY = -0.06 + 0.05 * sway;
    pose.lean = 0.04;
    if (reaction.preset === 'happy' || reaction.preset === 'laugh' || reaction.gesture === 'wave') {
      pose.headZ = direction * (0.23 + 0.1 * sway);
      pose.headY = -0.08 * (1 + glance);
      pose.lean = 0.08;
    }
    if (reaction.preset === 'tease') {
      pose.headZ = -direction * (0.22 + 0.08 * sway);
      pose.gazeX = 0.18 + 0.24 * glance;
      pose.lean = 0.07;
    }
    if (reaction.preset === 'sad') {
      pose.headZ = direction * 0.13;
      pose.headY = -0.18;
      pose.gazeY = -0.22;
      pose.lean = -0.08;
    }
    if (reaction.preset === 'shy' || reaction.emotion === 'embarrassed') {
      const away = beat(t, 4.7, 0.35, 0.7, 0.7) + beat(t, 9.0, 0.35, 0.55, 0.7);
      const reconnect = beat(t, 7.0, 0.3, 0.55, 0.45);
      pose.gazeX = -direction * (0.16 + 0.22 * away) * (1 - 0.8 * reconnect);
      pose.gazeY = -0.22 - 0.12 * away + 0.16 * reconnect;
      pose.headX = -direction * 0.14 * away;
      pose.headY = -0.14 - 0.1 * away + 0.09 * reconnect;
      pose.headZ = direction * (0.13 + 0.13 * away);
      pose.lean = -0.04;
    }
    if (reaction.preset === 'angry') {
      pose.headZ = -direction * 0.09;
      pose.headX = -direction * 0.26;
      pose.headY = -0.04;
      pose.gazeY = -0.08;
      pose.gazeX = direction * (-0.12 + 0.2 * glance);
      pose.lean = 0;
    }
    if (reaction.preset === 'confused') {
      pose.headZ = direction * 0.16;
      pose.headY = -0.07;
      pose.gazeX = 0.3 * glance;
      pose.gazeY = 0.08;
      pose.lean = -0.04;
    }
    if (reaction.emotion === 'concerned') {
      pose.headZ = direction * (0.22 + 0.08 * sway);
      pose.headY = -0.12;
      pose.gazeY = -0.24;
      pose.gazeX = -0.16 + 0.22 * glance;
      pose.lean = -0.04;
    }
    if (reaction.gesture === 'explain' || reaction.gesture === 'wave') {
      const returning = beat(t, end - 1.4, 0.18, 0.15, 0.75);
      // The verified default explain hand is on screen right, the greeting
      // palm on screen left. Glance toward that hand at each height accent.
      pose.gazeX = (reaction.gesture === 'explain' ? 0.34 : -0.28) * Math.abs(glance);
      pose.gazeY += 0.18 * Math.abs(glance);
      pose.headX = pose.gazeX * 0.5;
      pose.headY -= 0.22 * returning + 0.08 * Math.abs(glance);
      pose.gazeY -= 0.16 * returning;
      pose.headZ += direction * 0.08 * glance;
    }
    return { pose: this.amplifyIntent(pose), weight };
  }

  private amplifyIntent(pose: Pose): Pose {
    // Local model inputs: readable head/gaze poses at normal intensity, with no
    // change to the global setting, breath, window transform or root translation.
    pose.headX *= 1.6;
    pose.headY *= 1.5;
    pose.headZ *= 1.8;
    pose.gazeX *= 1.35;
    pose.gazeY *= 1.35;
    return pose;
  }

  private reactionTarget(reaction: Reaction, t: number): Pose {
    const shyLaugh = reaction.emotion === 'embarrassed' && reaction.preset === 'laugh';
    const target = this.target(
      reaction.preset,
      Math.max(0, t - (shyLaugh ? 0.9 : 0)),
      reaction.variant,
    );
    if (reaction.emotion === 'concerned' && reaction.preset === 'tease') {
      target.browInner = 0.5;
      target.browY = 0.12;
      target.smile = -0.18;
      target.eyeSmile = 0.05;
      // Preserve the source eye closures while changing each lid's neutral shape.
      target.eyeL = (0.64 * target.eyeL) / (reaction.variant ? 0.9 : 0.72);
      target.eyeR = (0.78 * target.eyeR) / (reaction.variant ? 0.66 : 0.98);
      const local = accentTime('tease', t, reaction.variant);
      const anticipation = beat(local, 0.05, 0.3, 0.65, 0.55);
      const reconnect = smooth((local - 1.2) / 1.0);
      target.headZ = 0.3 + 0.12 * anticipation - 0.16 * reconnect;
      target.headX = -0.18 * anticipation;
      target.headY = -0.42 + 0.3 * reconnect;
      target.gazeX = -0.5 * (1 - reconnect) + 0.12 * beat(local, 2.2, 0.2, 0.2, 0.4);
      target.gazeY = -0.28 * (1 - 0.8 * reconnect);
      target.lean = -0.04 + 0.12 * reconnect;
    }
    if (shyLaugh) {
      // Emotion supplies the first glance; attitude supplies the delayed laugh.
      // Both retain their original cue identity and the shared finite lifetime.
      const shy = this.target('shy', t, reaction.variant);
      const aversion = 1 - smooth((t - 0.9) / 0.25);
      for (const key of [
        'headX',
        'headY',
        'headZ',
        'lean',
        'gazeX',
        'gazeY',
        'eyeL',
        'eyeR',
        'eyeSmile',
        'smile',
        'browY',
        'browInner',
      ] as const)
        target[key] += (shy[key] - target[key]) * aversion;
    }
    return reaction.preset === 'acknowledge' ? target : this.amplifyIntent(target);
  }

  private target(preset: ActingPreset, t: number, variant = 0): Pose {
    t = accentTime(preset, t, variant);
    const p = { ...neutral(), ...PROFILES[preset] };
    if (preset === 'acknowledge') {
      // "No deliberate gesture" still gets a visible, one-shot delivery beat.
      // It remains emotionally neutral and never requests an authored hand pose.
      const accent = beat(t, 0.08, 0.18, 0.12, 0.65);
      p.headY = -0.48 * accent;
      p.headZ = (variant ? -1 : 1) * 0.12 * accent;
      p.lean = 0.04 * accent;
      p.browY = 0.08 * accent;
    }
    if (preset === 'happy') {
      p.headZ = (0.16 + 0.3 * beat(t, 0.2, 0.25, 0.7, 0.55)) * (variant ? -1 : 1);
      const welcome = beat(t, 0.12, 0.32, 0.75, 0.75);
      const direction = variant ? -1 : 1;
      p.headX = direction * 0.2 * welcome;
      p.headY = -0.06 - 0.14 * welcome;
      p.gazeY = -0.12 * welcome;
      p.gazeX = direction * (0.08 * welcome + 0.12 * beat(t, 1.25, 0.25, 0.35, 0.5));
      // A single contextual forward-listening phrase, not a new idle/breath cycle.
      p.lean = 0.08 + 0.26 * welcome;
      p.eyeSmile = variant ? 1 : 0.95;
      if (variant) p.smile = 0.72;
      p.browY = 0.12;
      p.mouthOpen = 0.18 + 0.04 * beat(t, 0.25, 0.2, 0.7, 0.45);
      p.eyeL = p.eyeR = 0.7 - 0.4 * beat(t, 0.45, 0.15, 0.45, 0.2);
    }
    // Look away first, then cautiously return the eyes while retaining the shy tilt.
    if (preset === 'shy') {
      const reconnect = 1 - smooth((t - 1.15) / 1.35);
      p.gazeX *= (variant ? -1 : 1) * reconnect;
      p.gazeY *= reconnect;
      p.headY *= 0.4 + 0.6 * reconnect;
      p.headZ *= 0.65 + 0.35 * reconnect;
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
      const wink = teaseWink(t, variant);
      p.eyeL = variant ? 0.9 : 0.72 * (1 - wink);
      p.eyeR = variant ? 0.66 * (1 - wink) : 0.98;
      p.eyeSmile = 0.3;
      p.smile = 0.7;
      const invitation = beat(t, 0.25, 0.25, 0.45, 0.5);
      p.headZ = -0.16 - 0.23 * invitation;
      p.headY = -0.08 * invitation;
      p.gazeX = 0.42 * (1 - smooth((t - 1.1) / 0.8)) - 0.18 * beat(t, 1.8, 0.2, 0.35, 0.5);
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
      const laugh = beat(t, 0.25, 0.2, 0.9, 0.35);
      p.eyeL = p.eyeR = 1 - 0.9 * laugh;
      // One expressive mouth shape, never a repeated speech/phoneme clock.
      p.mouthOpen = 0.35 * beat(t, 0.65, 0.12, 0.4, 0.2);
      const chuckle = beat(t, 0.12, 0.25, 0.8, 0.75);
      const direction = variant ? -1 : 1;
      p.headX = direction * 0.18 * chuckle;
      p.headY = -0.16 * chuckle;
      p.gazeX = direction * 0.07 * chuckle;
      p.lean = 0.08 + 0.28 * chuckle;
      p.headZ = direction * (0.28 * laugh + 0.1 * (1 - smooth((t - 2.6) / 0.6)));
      const settle = 1 - 0.6 * smooth((t - 1.6) / 0.45);
      p.smile *= settle;
      p.eyeSmile *= settle;
      if (variant === 1) p.eyeR *= 1 - beat(t, 2.1, 0.12, 0.3, 0.25);
    }
    if (preset === 'angry') {
      const anger = beat(t, 0, 0.2, 0.6, 0.4);
      p.eyeL = p.eyeR = 0.75 - 0.2 * anger;
      const direction = variant ? -1 : 1;
      const turn = beat(t, 0.1, 0.35, 0.8, 0.65);
      const reconnect = smooth((t - 1.1) / 1.2);
      // Turn the head/torso aside first, then reluctantly reconnect without
      // erasing the side posture or frown once the short eye accent ends.
      p.headX = -direction * (0.42 + 0.08 * turn);
      p.headY = -0.08 - 0.12 * anger;
      p.headZ = -direction * (0.12 + 0.12 * turn);
      p.gazeX = direction * (-0.5 * (1 - reconnect) + 0.12 * reconnect);
      p.gazeY = -0.08 - 0.1 * anger;
      p.lean = -0.06 * turn;
      const soften = 1 - 0.35 * smooth((t - 1.1) / 0.7);
      for (const key of ['browY', 'pout', 'cheek'] as const) p[key] *= soften;
    }
    if (preset === 'confused') {
      const confusion = beat(t, 0, 0.2, 0.8, 0.4);
      p.headZ *= confusion;
      p.headY *= confusion;
      p.lean *= confusion;
      p.eyeL = 0.74 - 0.14 * confusion;
      p.eyeR = 0.96;
      p.smile = -0.18;
      p.pout = 0.18;
      p.gazeX = -0.12 * confusion + 0.22 * beat(t, 1.35, 0.18, 0.25, 0.4);
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
