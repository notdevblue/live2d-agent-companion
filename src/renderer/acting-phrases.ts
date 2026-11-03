/** Stateless local acting phrases. Cue ownership, schedules and damping live in acting.ts. */
import type { Attitude, CharacterPreview, Emotion, Gesture } from '../shared/contracts.js';
import type { FaceFrame } from './performance.js';

export type ActingPreset =
  | Exclude<CharacterPreview, 'reset'>
  | 'neutral'
  | 'acknowledge'
  | 'working'
  | 'sad'
  | 'concerned'
  | 'reassure';
export interface Pose extends FaceFrame {
  headX: number;
  headY: number;
  headZ: number;
  bodyX: number;
  bodyY: number;
  bodyZ: number;
  lean: number;
  approach: number;
  gazeX: number;
  gazeY: number;
  blink: number;
  smile: number;
  mouthOpen: number;
}
export interface Reaction {
  attitude?: Attitude;
  preset: ActingPreset;
  emotion: Emotion;
  gesture: Gesture;
  started: number;
  variant: number;
  afterglow: boolean;
}
/** A read-only projection of the existing cue clock; no timer or extra state. */
export interface ReactionClock {
  age: number;
  seconds: number;
  attitudeSeconds: number;
  emotionSeconds: number;
  performanceSeconds: number;
  duration: number;
  lifetime: number;
  accentWeight: number;
  residueWeight: number;
  faceWeight: number;
  mouthWeight: number;
  angryCheck: number;
  phase: 'idle' | 'anticipation' | 'accent' | 'settle' | 'release' | 'afterglow';
  chuckle?: { first: number; second: number };
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
/** Only an expressive face lingers briefly. Body and hand motion use the accent budget.
 * Neutral delivery never acquires an extra performance when its judgement arrives. */
export const reactionLifetime = (
  preset: ActingPreset,
  stage: 'delivery' | 'semantic' = 'semantic',
): number =>
  reactionDuration(preset) + (stage === 'semantic' && preset !== 'acknowledge' ? 2000 : 0);
export const neutral = (): Pose => ({
  headX: 0,
  headY: 0,
  headZ: 0,
  bodyX: 0,
  bodyY: 0,
  bodyZ: 0,
  lean: 0,
  approach: 0,
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
export const clamp = (x: number, min = -1, max = 1): number => Math.max(min, Math.min(max, x));
export const smooth = (x: number): number => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
export const beat = (
  t: number,
  start: number,
  attack: number,
  hold: number,
  release: number,
): number => smooth((t - start) / attack) * (1 - smooth((t - start - attack - hold) / release));
const teaseWink = (t: number, variant: number): number =>
  beat(t, variant ? 0.45 : 0.85, 0.12, 0.35, 0.3);
const accentTime = (preset: ActingPreset, t: number, variant: number): number =>
  variant && ['happy', 'laugh', 'shy', 'tease', 'angry', 'confused'].includes(preset)
    ? Math.max(0, (t - 0.18) / 1.12)
    : t;
// Two unequal local chuckles. Callers pass either wall time (chuckleBeats applies
// accentTime once) or samplePresetPose's t, which is already accent-adjusted.
const chuckleShape = (local: number): { first: number; second: number } => ({
  first: beat(local, 0.15, 0.25, 0.15, 0.5),
  second: beat(local, 1.25, 0.18, 0.12, 0.5),
});
const chuckleBeats = (t: number, variant: number): { first: number; second: number } =>
  chuckleShape(accentTime('laugh', t, variant));
// Compound emotions get their own first beat before the attitude takes over.
// Target eyelids and blink suppression must consume this same delayed clock.
const attitudeTime = (reaction: Reaction, t: number): number =>
  Math.max(
    0,
    t -
      ((reaction.emotion === 'embarrassed' && reaction.preset === 'laugh') ||
      (reaction.emotion === 'concerned' && reaction.preset === 'tease')
        ? 0.9
        : 0),
  );
export const reactionClock = (
  reaction: Reaction | undefined,
  now: number,
): ReactionClock | undefined => {
  if (!reaction) return undefined;
  const age = now - reaction.started;
  const seconds = age / 1000;
  const { duration, attack, release } = timing(reaction.preset);
  const lifetime = reactionLifetime(reaction.preset, reaction.afterglow ? 'semantic' : 'delivery');
  const accentWeight = smooth(age / attack) * smooth((duration - age) / release);
  const fade = reaction.afterglow ? 1 - smooth((age - (lifetime - 1000)) / 1000) : 0;
  const attitudeSeconds = attitudeTime(reaction, seconds);
  const emotionSeconds = accentTime(reaction.preset, seconds, reaction.variant);
  // A small, static face bridges the accent release, then fades over the final second.
  // It never holds the shoulders, head, gaze, canvas approach or an authored hand.
  const faceWeight =
    reaction.afterglow && reaction.preset !== 'acknowledge'
      ? 0.4 * smooth((age - (duration - release)) / release) * fade
      : 0;
  return {
    age,
    seconds,
    attitudeSeconds,
    emotionSeconds,
    performanceSeconds: accentTime(reaction.preset, attitudeSeconds, reaction.variant),
    duration,
    lifetime,
    accentWeight,
    residueWeight: faceWeight,
    faceWeight,
    mouthWeight: faceWeight,
    angryCheck:
      reaction.preset === 'angry' && reaction.gesture === 'none'
        ? beat(attitudeSeconds, 1.95, 0.25, 0.25, 0.65)
        : 0,
    phase:
      age >= duration
        ? 'afterglow'
        : age < attack
          ? 'anticipation'
          : age < 1200
            ? 'accent'
            : age > duration - release
              ? 'release'
              : 'settle',
    ...(reaction.preset === 'laugh' &&
    reaction.gesture === 'none' &&
    (reaction.emotion === 'happy' || reaction.emotion === 'neutral')
      ? { chuckle: chuckleBeats(seconds, reaction.variant) }
      : {}),
  };
};
export const emotionFor = (preset: ActingPreset): Emotion =>
  preset === 'shy'
    ? 'embarrassed'
    : ['happy', 'sad', 'concerned', 'surprised', 'angry', 'confused'].includes(preset)
      ? (preset as Emotion)
      : 'neutral';

/** Eye artwork precedence is shared; previews intentionally keep happy's full duration. */
export function eyeAccentDuration(
  preset: ActingPreset,
  emotion: Emotion,
  source: 'preview' | 'cue',
): number | undefined {
  if (emotion === 'confused') return 1400;
  if (preset === 'laugh') return 1200;
  if (preset === 'tease') return 1100;
  return source === 'cue' && emotion === 'happy' ? 2300 : undefined;
}

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
export function sampleHeldFace(reaction: Reaction | undefined): Pose {
  const face = neutral();
  if (!reaction?.afterglow) return face;
  if (reaction.preset === 'acknowledge') return face;
  if (reaction.preset === 'happy' || reaction.preset === 'laugh' || reaction.gesture === 'wave') {
    face.smile = 0.58;
    face.eyeSmile = 0.78;
    // Leave a relaxed, open-eyed smile rather than another glance or wink.
    face.eyeL = face.eyeR = 0.76;
    face.mouthOpen = reaction.preset === 'happy' ? 0.18 : 0;
    face.browY = 0.12;
    if (reaction.gesture === 'none' && reaction.preset === 'laugh') {
      // The one chuckle leaves a mild, closed-mouth grin.
      face.smile = 0.8;
      face.eyeSmile = 0.9;
    }
  }
  if (reaction.gesture === 'explain' || reaction.preset === 'explain') {
    face.smile = 0.4;
    face.eyeSmile = 0.55;
    face.eyeL = face.eyeR = 0.82;
    face.browY = 0.15;
  }
  if (reaction.preset === 'tease') {
    face.smile = 0.7;
    face.eyeSmile = 0.3;
    face.eyeL = face.eyeR = 0.9;
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
    face.eyeL = face.eyeR = 0.35;
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
  return face;
}

export function amplifyPoseIntent(pose: Pose): Pose {
  // Local model inputs: readable head/gaze poses at normal intensity, with no
  // change to the global setting, breath, window transform or root translation.
  pose.headX *= 1.6;
  pose.headY *= 1.5;
  pose.headZ *= 1.8;
  pose.gazeX *= 1.35;
  pose.gazeY *= 1.35;
  return pose;
}

export function sampleReactionPose(reaction: Reaction, clock: ReactionClock, scale: number): Pose {
  const t = clock.seconds;
  const shyLaugh = reaction.emotion === 'embarrassed' && reaction.preset === 'laugh';
  const target = samplePresetPose(reaction.preset, clock.attitudeSeconds, reaction.variant);
  if (reaction.emotion === 'concerned' && reaction.preset === 'tease') {
    const local = clock.emotionSeconds;
    const worry = 1 - smooth((local - 1.05) / 0.6);
    target.browInner = 0.5 + 0.22 * worry;
    // Separate the initial worry from relief with a deeper frown and lowered
    // outer brows, using the verified upstream controls. Relief
    // returns to the same closed-mouth +.4 and brow +.12 before the wink.
    target.browY = 0.12 - 0.72 * worry;
    target.smile = (0.4 - 1.4 * worry) * Math.min(1, scale / 0.65);
    target.eyeSmile = 0.05;
    // Preserve the source eye closures while changing each lid's neutral shape.
    target.eyeL = (0.88 * target.eyeL) / (reaction.variant ? 0.9 : 0.72);
    target.eyeR = (0.96 * target.eyeR) / (reaction.variant ? 0.66 : 0.98);
    const anticipation = beat(local, 0.05, 0.3, 0.65, 0.55);
    const reconnect = smooth((local - 1.2) / 1.0);
    target.headZ = 0.3 + 0.12 * anticipation - 0.16 * reconnect;
    // Keep the initial concern attentive instead of saturating a bowed,
    // half-lidded pose; the same finite clock still reconnects into the wink.
    target.headX = -0.08 * anticipation;
    target.headY = -0.18 + 0.1 * reconnect;
    target.gazeX = -0.12 * (1 - reconnect) + 0.12 * beat(local, 2.2, 0.2, 0.2, 0.4);
    target.gazeY = -0.12 * (1 - 0.8 * reconnect);
    target.lean = -0.04 + 0.12 * reconnect;
  }
  if (
    (reaction.preset === 'happy' || reaction.preset === 'laugh') &&
    !shyLaugh &&
    reaction.gesture === 'none'
  ) {
    // After the welcome/chuckle, briefly check the listener and reconnect to
    // the mild angled hold. Eye and head inputs turn together on this rig.
    const direction = reaction.variant ? -1 : 1;
    const listen = beat(t, 1.85, 0.45, 0.55, 0.85);
    target.headX -= direction * 0.23 * listen;
    target.gazeX -= direction * 0.24 * listen;
    target.headZ -= direction * 0.13 * listen;
    target.headY += 0.07 * listen;
    target.lean -= 0.03 * listen;
    target.browY += 0.08 * listen;
  }
  if (clock.chuckle) {
    const { first, second } = clock.chuckle;
    const local = clock.emotionSeconds;
    const direction = reaction.variant ? -1 : 1;
    target.headY = -0.24 * first - 0.14 * second;
    target.headZ =
      direction * (0.1 * (1 - smooth((local - 2.6) / 0.6)) + 0.24 * first - 0.17 * second);
  }
  if (shyLaugh) {
    // Emotion supplies the first glance; attitude supplies the delayed laugh.
    // Both retain their original cue identity and the shared finite lifetime.
    const shy = samplePresetPose('shy', t, reaction.variant);
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
  target.approach = target.lean;
  return reaction.preset === 'acknowledge' ? target : amplifyPoseIntent(target);
}

export function samplePresetPose(preset: ActingPreset, t: number, variant = 0): Pose {
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
    // Same chuckle shape as the body. `t` was already passed through accentTime,
    // so this must not call chuckleBeats (that would shift variant 1 twice).
    const { first, second } = chuckleShape(t);
    const span = Math.max(laugh, first, second);
    p.mouthOpen = span * (0.48 + 0.42 * Math.max(first, second));
    const chuckle = beat(t, 0.12, 0.25, 0.8, 0.75);
    const direction = variant ? -1 : 1;
    p.headX = direction * 0.18 * chuckle;
    p.headY = -0.16 * chuckle;
    p.gazeX = direction * 0.07 * chuckle;
    p.lean = 0.08 + 0.28 * chuckle;
    p.headZ = direction * (0.28 * laugh + 0.1 * (1 - smooth((t - 2.6) / 0.6)));
    const settle = 1 - 0.3 * smooth((t - 1.6) / 0.45);
    p.smile *= settle;
    p.eyeSmile *= settle;
    if (variant === 1) p.eyeR *= 1 - beat(t, 2.1, 0.12, 0.3, 0.25);
  }
  if (preset === 'angry') {
    const anger = beat(t, 0, 0.2, 0.6, 0.4);
    p.eyeL = p.eyeR = 0.5 - 0.1 * anger;
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
    const recoil = beat(t, 0.05, 0.2, 0.5, 0.75);
    const curious = smooth((t - 0.85) / 0.9);
    const direction = variant ? -1 : 1;
    // One physical double-take: turn/recoil, then inspect from a curious tilt.
    // BodyX follows this safe head input; neither arms nor rootY are driven.
    p.headX = direction * (-0.3 * recoil + 0.18 * curious);
    p.headZ = direction * (-0.12 * recoil + 0.3 * curious);
    p.headY = 0.14 * recoil - 0.08 * curious;
    p.lean = -0.22 * recoil - 0.04 * curious;
    p.gazeX = direction * (-0.28 * recoil + 0.18 * curious);
    p.gazeY = 0.1 * recoil + 0.05 * curious;
    p.eyeL = 0.74 - 0.14 * recoil;
    p.eyeR = 0.96;
    p.smile = -0.18;
    p.pout = 0.18;
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
  p.approach = p.lean;
  return p;
}

/** Independent shoulder/waist and rig-depth intent, on the existing response
 * clock. Canvas approach is deliberately not part of the physical phrase. */
export function sampleTorsoIntent(
  reaction: Reaction | undefined,
  clock: ReactionClock | undefined,
): { x: number; z: number; lean?: number } | undefined {
  if (!reaction || !clock || reaction.gesture !== 'none') return undefined;
  const direction = reaction.variant ? -1 : 1;
  const t = clock.performanceSeconds;
  if (reaction.preset === 'angry') {
    // Keep the averted stance. The same reluctant eye check briefly loosens
    // the shoulders, which settle back after the listener has been checked.
    const check = clock.angryCheck;
    return {
      x: direction * (-0.44 + 0.3 * check),
      z: direction * (0.22 - 0.14 * check),
      lean: -0.12 + 0.24 * check,
    };
  }
  if (reaction.preset === 'confused') {
    // Recoil with the first look; follow the recovery into an interested
    // forward posture instead of keeping a backward lean while asking back.
    const recoil = beat(t, 0.05, 0.2, 0.5, 0.75);
    const curious = smooth((t - 0.85) / 0.9);
    return {
      x: direction * (-0.3 * recoil + 0.18 * curious),
      z: direction * (0.16 * recoil - 0.2 * curious),
      lean: -0.24 * recoil + 0.42 * curious,
    };
  }
  if (reaction.preset === 'tease' && reaction.emotion === 'concerned') {
    // The brow/mouth worry and delayed wink already use this recovery clock.
    // Release the guarded posture into a small invitation to the listener.
    const relief = smooth((clock.emotionSeconds - 1.2) / 1.0);
    return {
      x: direction * (-0.18 + 0.42 * relief),
      z: direction * (-0.12 + 0.24 * relief),
      lean: -0.1 + 0.55 * relief,
    };
  }
  if (
    reaction.preset === 'tease' &&
    (reaction.emotion === 'neutral' || reaction.emotion === 'happy')
  ) {
    const invitation = beat(t, 0.25, 0.25, 0.45, 0.5);
    // Both existing tease variants roll the head to the same side. The body
    // counterbalances that roll rather than mirroring an unrelated variant.
    return {
      x: 0.14 + 0.12 * invitation,
      z: 0.12 + 0.1 * invitation,
      lean: 0.22 + 0.3 * invitation,
    };
  }
  if (reaction.preset === 'concerned') {
    return { x: -0.12, z: -0.16, lean: 0.28 };
  }
  if (
    reaction.preset === 'shy' ||
    (reaction.preset === 'laugh' && reaction.emotion === 'embarrassed')
  )
    return { x: direction * 0.24, z: -direction * 0.28 };
  if (reaction.preset === 'happy' && reaction.emotion === 'happy')
    return { x: direction * 0.1, z: direction * 0.04 };
  if (clock.chuckle) {
    const { first, second } = clock.chuckle;
    return {
      x: direction * (-0.26 + 0.14 * first - 0.1 * second),
      z: direction * (0.28 - 0.18 * first + 0.02 * second),
    };
  }
  return undefined;
}
