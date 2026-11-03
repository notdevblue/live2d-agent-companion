import {
  type Attitude,
  type CharacterCue,
  type CharacterPreview,
  type Emotion,
  type Gesture,
} from '../shared/contracts.js';
import type { FaceFrame } from './performance.js';
import {
  type ActingPreset,
  type Pose,
  type Reaction,
  neutral,
  clamp,
  smooth,
  beat,
  reactionClock,
  emotionFor,
  reactionDuration,
  reactionLifetime,
  sampleHeldFace,
  amplifyPoseIntent,
  sampleReactionPose,
  samplePresetPose,
  sampleTorsoIntent,
} from './acting-phrases.js';
export { type ActingPreset, reactionDuration, reactionLifetime } from './acting-phrases.js';

export type ActingState = 'idle' | 'thinking' | 'working' | 'error' | 'blocked';
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
  bodyZ: number;
  lean: number;
  /** Canvas framing approach, separate from rig posture; legacy frames may omit it. */
  approach?: number;
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
// A stable integer hash gives irregular schedules without global randomness or wall clocks.
const random = (n: number): number => {
  let x = Math.imul(n + 173, 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
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
  private gazeIdle = false;
  private blinkAt = 0;
  private blinkIndex = 0;
  private variants = new Map<ActingPreset, number>();

  /** Existing gaze-clock identity for local idle choreography; reading it spends no beat. */
  get gazeSlotId(): number {
    return this.gazeIndex;
  }

  /** Start of that same gaze slot; consumers add no timer or clock state. */
  get gazeSlotStartedAt(): number {
    return this.gazeSince;
  }

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
      'bodyZ',
      'lean',
      'approach',
      'gazeX',
      'gazeY',
    ] as const) {
      const range = key === 'headX' ? 0.7 : key === 'bodyX' ? 0.5 : key === 'bodyZ' ? 0.3 : 1;
      this.pose[key] = clamp(this.pose[key], -limit * range, limit * range);
    }
  }

  setState(state: ActingState, nowMs: number): void {
    this.initialize(nowMs);
    // Task progress is a background state. A visible message owns its bounded
    // reaction until it releases; a new request explicitly resets the actor.
    if (state === 'error' || state === 'blocked') {
      this.reaction = undefined;
      this.pose = neutral();
    }
    // Consume missed edges under the previous state, before a blocked/work
    // interval can become an eligible idle glance on release.
    this.advanceSchedules(nowMs);
    this.state = state;
    if (state !== 'idle') this.gazeIdle = false;
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
      // A neutral result keeps the original brief delivery deadline. It never
      // resurrects an expired beat or spends another variant.
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
    this.gazeIdle = false;
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
    this.gazeIdle = false;
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
    const clock = reactionClock(reaction, now);
    const performanceAge = (clock?.performanceSeconds ?? 0) * 1000;
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
    // A reluctant eye-only check inside the short angry reaction. Project it
    // after pose integration so gaze→head→torso following cannot unwind the
    // averted posture. The existing cue clock returns both eyes by 3.1s.
    const angryCheck = (clock?.angryCheck ?? 0) * this.scale();
    return {
      ...this.pose,
      gazeX: clamp(this.pose.gazeX + (reaction?.variant ? -1 : 1) * 0.45 * angryCheck),
      eyeL: clamp(this.pose.eyeL + 0.22 * angryCheck, 0, 1) * blink,
      eyeR: clamp(this.pose.eyeR + 0.22 * angryCheck, 0, 1) * blink,
      breath: this.state === 'blocked' ? 0.5 : 0.5 + this.breathWave(now) * 0.48 * this.scale(),
      offsetY: this.state === 'blocked' ? 0 : this.breathWave(now) * 0.0045 * this.scale(),
      preset: reaction?.preset ?? this.base(),
      active: !!reaction,
      expressionWeight: (clock?.accentWeight ?? 0) + (clock?.residueWeight ?? 0) * this.scale(),
      emotion: reaction?.emotion ?? (this.state === 'error' ? 'concerned' : 'neutral'),
      gesture: reaction?.gesture ?? 'none',
      ...(reaction?.attitude !== undefined ? { attitude: reaction.attitude } : {}),
      variant: reaction?.variant ?? 0,
      phase: clock?.phase ?? 'idle',
    };
  }

  private initialize(now: number): void {
    if (this.epoch !== undefined) return;
    this.epoch = now;
    this.gazeIndex = this.blinkIndex = 0;
    this.gaze = { x: 0, y: 0 };
    this.gazeIdle = false;
    this.gazeAt = now + 6000;
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
  private breathWave(now: number): number {
    // A 4.8s relaxed cycle: shorter inhale, longer exhale, zero speed at either end.
    // Keep the clock independent of cues/resets so starting a reaction never restarts a breath.
    const phase = (((now % 4800) + 4800) % 4800) / 4800;
    return phase < 0.42
      ? -Math.cos((Math.PI * phase) / 0.42)
      : Math.cos((Math.PI * (phase - 0.42)) / 0.58);
  }
  private advanceSchedules(now: number): void {
    while (now >= this.gazeAt) {
      this.gazeIndex++;
      this.gazeSince = this.gazeAt;
      this.gazeIdle = !this.reaction && this.state === 'idle';
      this.gaze = {
        x: (random(this.gazeIndex * 3) - 0.5) * 0.32,
        y: (random(this.gazeIndex * 3 + 1) - 0.5) * 0.2,
      };
      const [rest, variation] = {
        quiet: [14000, 6000],
        normal: [10000, 5000],
        expressive: [7000, 4000],
      }[this.options.intensity] as [number, number];
      this.gazeAt +=
        (rest + random(this.gazeIndex * 3 + 2) * variation) *
        (this.options.reducedMotion ? 1.5 : 1);
    }
    while (now >= this.blinkAt + (random(70 + this.blinkIndex) > 0.72 ? 445 : 190)) {
      this.blinkIndex++;
      this.blinkAt += 2600 + random(40 + this.blinkIndex) * 4000;
    }
  }
  private advance(now: number, dt: number): void {
    this.advanceSchedules(now);
    const reaction = this.reaction;
    const clock = reactionClock(reaction, now);
    const age = clock?.age ?? 0;
    const weight = clock?.accentWeight ?? 0;
    // Do not blend a waiting/working pose back into the message's attack or
    // release. Once the reaction expires the latest task state resumes.
    const base = samplePresetPose(reaction ? 'neutral' : this.base(), (now - this.epoch!) / 1000);
    const scale = this.scale();
    const target = reaction ? sampleReactionPose(reaction, clock!, scale) : base;
    // A gesture carries body/gaze intent independently of the face's emotion or attitude.
    if (reaction?.gesture === 'thinking' || reaction?.gesture === 'explain') {
      const gesture = amplifyPoseIntent(
        samplePresetPose(reaction.gesture, age / 1000, reaction.variant),
      );
      for (const key of ['headX', 'headY', 'headZ', 'gazeX', 'gazeY'] as const)
        target[key] += (gesture[key] - target[key]) * 0.7;
    }
    // Keep the two short explain accents inside the original motion budget.
    const explainBeat =
      reaction?.gesture === 'explain'
        ? beat(age / 1000, 1.05, 0.15, 0.1, 0.35) + beat(age / 1000, 2.35, 0.18, 0.12, 0.45)
        : 0;
    const idleGaze = !reaction && this.state === 'idle' && this.gazeIdle;
    const idleAge = (now - this.gazeSince) / 1000;
    // One small glance returns to center. Most of each slot is quiet rest;
    // eyes lead the head naturally, without extra tilts or weight-shift phrases.
    const ambientWeight = reaction
      ? 0
      : this.state === 'idle'
        ? idleGaze
          ? beat(idleAge, 0, 0.6, 0.8, 1.6)
          : 0
        : 1;
    const faceWeight = clock?.faceWeight ?? 0;
    const blend = (a: number, b: number): number => a + (b - a) * weight;
    const follow = (key: keyof Pose, value: number, rate: number): void => {
      this.pose[key] = clamp(
        this.pose[key] + (value - this.pose[key]) * (1 - Math.exp(-rate * dt)),
      );
    };
    follow('gazeX', (this.gaze.x * ambientWeight + blend(base.gazeX, target.gazeX)) * scale, 17);
    follow('gazeY', (this.gaze.y * ambientWeight + blend(base.gazeY, target.gazeY)) * scale, 17);
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
        this.pose.gazeX * 1.6 + blend(base.headX, target.headX) * scale,
        -0.7 * scale,
        0.7 * scale,
      ),
      headFollow,
    );
    follow(
      'headY',
      this.pose.gazeY * 0.45 + (blend(base.headY, target.headY) - 0.58 * explainBeat) * scale,
      headFollow,
    );
    follow('headZ', blend(base.headZ, target.headZ) * scale, 4);
    // Emotion can hold a distinct shoulder/waist attitude on the existing cue
    // envelope, while idle and explicit gestures retain delayed head following.
    const torso = sampleTorsoIntent(reaction, clock);
    const torsoWeight = torso ? weight : 0;
    const bodyX = this.pose.headX * 0.65;
    const bodyZ = this.pose.headZ * 0.7;
    follow(
      'bodyX',
      clamp(bodyX + ((torso?.x ?? 0) * scale - bodyX) * torsoWeight, -0.5 * scale, 0.5 * scale),
      2.1,
    );
    follow('bodyY', this.pose.headY * 0.2 + this.breathWave(now) * 0.13 * scale, 2.1);
    follow(
      'bodyZ',
      clamp(bodyZ + ((torso?.z ?? 0) * scale - bodyZ) * torsoWeight, -0.3 * scale, 0.3 * scale),
      2.1,
    );
    const legacyLean = blend(base.lean, target.lean) * scale;
    follow(
      'lean',
      torso?.lean === undefined
        ? legacyLean
        : legacyLean + (torso.lean * scale - legacyLean) * torsoWeight,
      2.5,
    );
    follow('approach', blend(base.approach, target.approach) * scale, 2.5);
    // Accent and held emotion are separate targets. The existing release clock
    // crossfades them; a low generic smile cannot erase the selected emotion.
    const heldFace = sampleHeldFace(reaction);
    follow('smile', blend(base.smile, target.smile) + heldFace.smile * faceWeight * scale, 6);
    const mouthWeight = clock?.mouthWeight ?? 0;
    const closedMouth =
      reaction?.emotion === 'angry' ||
      reaction?.preset === 'angry' ||
      reaction?.emotion === 'confused' ||
      reaction?.preset === 'confused';
    follow(
      'mouthOpen',
      closedMouth ? 0 : (target.mouthOpen * weight + heldFace.mouthOpen * mouthWeight) * scale,
      12,
    );
    for (const key of ['eyeL', 'eyeR'] as const) {
      const accentEye = reaction?.preset === 'angry' ? target[key] : blend(base[key], target[key]);
      const eye =
        accentEye +
        (heldFace[key] - accentEye) *
          faceWeight *
          { quiet: 0.35, normal: 0.65, expressive: 1 }[this.options.intensity];
      const eyeWeight = reaction?.preset === 'angry' ? Math.min(1, weight + faceWeight) : 1;
      follow(key, 1 + (eye - 1) * eyeWeight * (this.options.reducedMotion ? 0.18 : 1), 28);
    }
    for (const key of ['eyeSmile', 'browY', 'browInner', 'pout', 'cheek'] as const) {
      const explainBrow = key === 'browY' ? 0.2 * explainBeat : 0;
      follow(
        key,
        (blend(base[key], target[key]) + heldFace[key] * faceWeight + explainBrow) * scale,
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
}
