import { describe, expect, it } from 'vitest';
import {
  ActingController,
  reactionDuration,
  reactionLifetime,
  type ActingFrame,
  type ActingPreset,
} from '../src/renderer/acting.js';
import { ATTITUDES, EMOTIONS, GESTURES } from '../src/shared/contracts.js';

const motionKeys = [
  'headX',
  'headY',
  'headZ',
  'bodyX',
  'bodyY',
  'bodyZ',
  'lean',
  'gazeX',
  'gazeY',
] as const;
function advance(actor: ActingController, end: number, fps = 60, start = 0): ActingFrame {
  let frame = actor.sample(start, 0);
  const count = Math.round(((end - start) * fps) / 1000);
  for (let i = 1; i <= count; i++) frame = actor.sample(start + (i * 1000) / fps, 1 / fps);
  return frame;
}
function magnitude(frame: ActingFrame): number {
  return motionKeys.reduce((sum, key) => sum + Math.abs(frame[key]), 0);
}

describe('local acting scheduler — FR-L2D-002/003/004, FR-DIR-002', () => {
  it('looks toward the verified default hand at both finite attention accents', () => {
    for (const gesture of ['explain', 'wave'] as const) {
      const actor = new ActingController();
      actor.cue(
        { requestId: 'hand', messageId: 'm', segmentId: 1, emotion: 'neutral', gesture },
        0,
      );
      const first = advance(actor, 5700),
        second = advance(actor, 10200, 60, 5700);
      for (const frame of [first, second]) {
        if (gesture === 'explain') expect(frame.gazeX).toBeGreaterThan(0.15);
        else expect(frame.gazeX).toBeLessThan(-0.12);
        expect(frame.gazeY).toBeGreaterThan(-0.05);
      }
    }
  });
  it('promotes a delivery beat once and does not restart it for a neutral semantic result', () => {
    for (const positive of [true, false]) {
      const actor = new ActingController();
      const delivery = {
        requestId: 'r',
        messageId: 'm',
        segmentId: 1,
        stage: 'delivery',
        emotion: 'neutral',
        gesture: 'none',
      } as const;
      actor.cue(delivery, 0);
      const before = advance(actor, 600);
      const semantic = {
        ...delivery,
        segmentId: 2,
        stage: 'semantic',
        emotion: positive ? 'happy' : 'neutral',
      } as const;
      expect(actor.cue(semantic, 600)).toBe(positive);
      const after = actor.sample(600, 0);
      if (positive) expect(after.preset).toBe('happy');
      else expect(after).toEqual(before);
      expect(actor.cue({ ...semantic, segmentId: 3 }, 700)).toBe(false);
    }
  });
  it('clears only the exact current cue and never resurrects its semantic result', () => {
    const actor = new ActingController();
    const delivery = {
      requestId: 'r',
      messageId: 'm',
      segmentId: 1,
      stage: 'delivery',
      emotion: 'neutral',
      gesture: 'none',
    } as const;
    actor.cue(delivery, 0);
    advance(actor, 500);
    expect(actor.clearCue({ ...delivery, segmentId: 2 })).toBe(false);
    expect(actor.clearCue(delivery)).toBe(true);
    expect(actor.sample(500, 0)).toMatchObject({ active: false, preset: 'neutral' });
    expect(actor.cue({ ...delivery, stage: 'semantic', emotion: 'happy', segmentId: 2 }, 600)).toBe(
      false,
    );
    actor.cue({ ...delivery, messageId: 'next', segmentId: 3 }, 700);
    expect(actor.clearCue(delivery)).toBe(false);
    expect(actor.sample(700, 0).active).toBe(true);
  });
  it.each(
    EMOTIONS.flatMap((emotion) =>
      ATTITUDES.flatMap((attitude) => GESTURES.map((gesture) => ({ emotion, attitude, gesture }))),
    ),
  )('renders and expires every supported combination: $emotion/$attitude/$gesture', (decision) => {
    const actor = new ActingController();
    const cue = { ...decision, requestId: 'audit', messageId: 'm', segmentId: 1 };
    expect(actor.cue(cue, 0)).toBe(true);
    const frame = advance(actor, 1100);
    expect(frame.active).toBe(true);
    expect(frame.emotion).toBe(decision.emotion);
    expect(frame.gesture).toBe(decision.gesture);
    for (const key of [
      ...motionKeys,
      'eyeL',
      'eyeR',
      'eyeSmile',
      'smile',
      'expressionWeight',
    ] as const) {
      expect(Number.isFinite(frame[key])).toBe(true);
      expect(Math.abs(frame[key])).toBeLessThanOrEqual(1);
    }
    expect(actor.cue(cue, 1200)).toBe(false);
    expect(advance(actor, 18000, 30, 1100)).toMatchObject({ active: false, preset: 'neutral' });
  });
  it('keeps accent timings and gives only semantic cues a bounded twelve-second afterglow budget', () => {
    for (const [preset, duration] of [
      ['acknowledge', 1800],
      ['surprised', 2200],
      ['wink', 2400],
      ['nod', 2600],
      ['laugh', 3600],
      ['happy', 4200],
    ] as const) {
      expect(reactionDuration(preset)).toBe(duration);
      expect(reactionLifetime(preset, 'delivery')).toBe(duration);
      expect(reactionLifetime(preset)).toBe(duration + 12000);
    }
  });

  it('holds a distinct mild emotional face after the body accent, then fades finitely', () => {
    const actor = new ActingController(),
      idle = new ActingController();
    actor.configure({ intensity: 'expressive', reducedMotion: false });
    idle.configure({ intensity: 'expressive', reducedMotion: false });
    actor.cue({ emotion: 'happy', gesture: 'none' }, 0);
    const held = advance(actor, 7000),
      baseline = advance(idle, 7000);
    expect(held).toMatchObject({ phase: 'afterglow', active: true, expressionWeight: 0.4 });
    expect(held.smile).toBeCloseTo(0.58, 6);
    expect(held.eyeSmile).toBeGreaterThanOrEqual(0.78);
    expect(held.eyeSmile).toBeLessThanOrEqual(0.84);
    expect(held.browY).toBeCloseTo(0.12, 6);
    expect(held.mouthOpen).toBeCloseTo(0.18, 6);
    for (const key of ['offsetY', 'breath', 'blink'] as const)
      expect(held[key]).toBeCloseTo(baseline[key], 7);
    expect(Math.abs(held.headZ)).toBeGreaterThan(0.1);
    const fading = advance(actor, 15700, 60, 7000);
    expect(fading.expressionWeight).toBeCloseTo(0.2);
    expect(fading.mouthOpen).toBeLessThan(held.mouthOpen);
    expect(advance(actor, 16200, 60, 15700)).toMatchObject({
      active: false,
      phase: 'idle',
      expressionWeight: 0,
      mouthOpen: 0,
      smile: 0,
      eyeSmile: 0,
    });
    const ended = advance(actor, 17000, 60, 16200);
    expect(ended.smile).toBeLessThan(0.001);
    expect(ended.mouthOpen).toBeLessThan(0.001);
  });

  it('keeps bright joy distinct from a closed-mouth laugh after the single chuckle', () => {
    for (const intensity of ['quiet', 'normal', 'expressive'] as const)
      for (const reducedMotion of [false, true]) {
        const paths = [30, 60, 120].map((fps) => {
          const happy = new ActingController(),
            laugh = new ActingController();
          for (const actor of [happy, laugh]) actor.configure({ intensity, reducedMotion });
          happy.cue(
            { requestId: 'joy', messageId: 'm', segmentId: 1, emotion: 'happy', gesture: 'none' },
            0,
          );
          laugh.cue(
            {
              requestId: 'laugh',
              messageId: 'm',
              segmentId: 1,
              emotion: 'happy',
              attitude: 'laugh',
              gesture: 'none',
            },
            0,
          );
          const joy = advance(happy, 7000, fps),
            grin = advance(laugh, 7000, fps);
          expect(joy.eyeL).toBeGreaterThan(grin.eyeL);
          expect(joy.eyeR).toBeGreaterThan(grin.eyeR);
          expect(grin.smile).toBeGreaterThan(joy.smile);
          expect(grin.eyeSmile).toBeGreaterThan(joy.eyeSmile);
          expect(grin.mouthOpen).toBeLessThan(0.00001);
          expect(joy.mouthOpen).toBeGreaterThan(0);
          expect(grin).toMatchObject({ active: true, phase: 'afterglow', gesture: 'none' });
          expect(advance(laugh, reactionLifetime('laugh'), fps, 7000)).toMatchObject({
            active: false,
            mouthOpen: 0,
            eyeL: 1,
            eyeR: 1,
          });
          return { joy, grin };
        });
        for (const path of paths.slice(1))
          for (const name of ['joy', 'grin'] as const)
            for (const key of ['eyeL', 'eyeR', 'smile', 'eyeSmile', 'mouthOpen'] as const)
              expect(path[name][key]).toBeCloseTo(paths[0]![name][key], 7);
      }
  });

  it('clears an already applied semantic cue during afterglow without accepting stale clears', () => {
    const actor = new ActingController();
    const cue = {
      requestId: 'r',
      messageId: 'm',
      segmentId: 2,
      stage: 'semantic',
      emotion: 'embarrassed',
      gesture: 'explain',
      attitude: 'laugh',
    } as const;
    actor.cue(cue, 0);
    expect(advance(actor, 6000)).toMatchObject({ phase: 'afterglow', active: true });
    expect(actor.clearCue({ ...cue, segmentId: 1 })).toBe(false);
    expect(actor.clearCue({ ...cue, messageId: 'other' })).toBe(false);
    expect(actor.clearCue(cue)).toBe(true);
    expect(actor.sample(6000, 0)).toMatchObject({
      active: false,
      emotion: 'neutral',
      mouthOpen: 0,
      smile: 0,
      eyeSmile: 0,
      expressionWeight: 0,
    });
    expect(actor.cue({ ...cue, segmentId: 3 }, 6100)).toBe(false);
    const next = { ...cue, segmentId: 4, messageId: 'next', emotion: 'happy' } as const;
    expect(actor.cue(next, 6200)).toBe(true);
    advance(actor, 11000, 60, 6200);
    expect(actor.clearCue(cue)).toBe(false);
    expect(actor.sample(11000, 0).active).toBe(true);
  });

  it('adds a neutral semantic afterglow after a delivery has expired without replaying its nod', () => {
    const actor = new ActingController();
    const cue = {
      requestId: 'r',
      messageId: 'm',
      segmentId: 1,
      stage: 'delivery',
      emotion: 'neutral',
      gesture: 'none',
    } as const;
    actor.cue(cue, 0);
    expect(advance(actor, 2400).active).toBe(false);
    expect(actor.cue({ ...cue, stage: 'semantic', segmentId: 2 }, 2400)).toBe(false);
    const held = advance(actor, 5000, 60, 2400);
    expect(held).toMatchObject({
      preset: 'acknowledge',
      phase: 'afterglow',
      smile: 0,
      eyeSmile: 0,
    });
    expect(held.mouthOpen).toBeCloseTo(0.12 * 0.65, 6);
    expect(Math.abs(held.headY)).toBeLessThan(0.1);
    expect(advance(actor, reactionLifetime('acknowledge'), 60, 5000).active).toBe(false);
  });

  it('applies intensity and reduced motion to every held facial channel at all supported frame rates', () => {
    for (const [intensity, reducedMotion, scale] of [
      ['expressive', false, 1],
      ['normal', false, 0.65],
      ['quiet', false, 0.35],
      ['normal', true, 0.65 * 0.18],
    ] as const) {
      const frames = [30, 60, 120].map((fps) => {
        const actor = new ActingController();
        actor.configure({ intensity, reducedMotion });
        actor.cue({ emotion: 'happy', gesture: 'explain' }, 0);
        return advance(actor, 9000, fps);
      });
      for (const frame of frames) {
        expect(frame.mouthOpen).toBeCloseTo(0.18 * scale, 6);
        expect(frame.smile).toBeCloseTo(0.4 * scale, 6);
        expect(frame.eyeSmile).toBeCloseTo(0.55 * scale, 6);
        expect(frame.expressionWeight).toBeCloseTo(0.4 * scale, 6);
        for (const key of [
          ...motionKeys,
          'mouthOpen',
          'smile',
          'eyeSmile',
          'blink',
          'breath',
          'offsetY',
        ] as const)
          expect(frame[key]).toBeCloseTo(frames[0]![key], 7);
      }
    }
  });

  it('exposes exact cue timing for neutral promotion without restarting its delivery clock', () => {
    const actor = new ActingController();
    const delivery = {
      requestId: 'r',
      messageId: 'm',
      segmentId: 1,
      stage: 'delivery',
      emotion: 'neutral',
      gesture: 'none',
    } as const;
    actor.cue(delivery, 100);
    expect(actor.reactionTiming(delivery, 500)).toEqual({
      started: 100,
      duration: 1800,
      lifetime: 1800,
    });
    const semantic = { ...delivery, segmentId: 2, stage: 'semantic' } as const;
    expect(actor.reactionTiming(semantic, 500)).toBeUndefined();
    expect(actor.cue(semantic, 500)).toBe(false);
    const timing = { started: 100, duration: 1800, lifetime: 13800 };
    expect(actor.reactionTiming(semantic, 500)).toEqual(timing);
    expect(actor.reactionTiming(delivery, 500)).toBeUndefined();
    expect(actor.cue(semantic, 700)).toBe(false);
    expect(actor.reactionTiming(semantic, 700)).toEqual(timing);
    expect(actor.reactionTiming(semantic, 13900)).toBeUndefined();
    expect(actor.reactionTiming(semantic, NaN)).toBeUndefined();
    actor.clearCue(semantic);
    expect(actor.reactionTiming(semantic, 700)).toBeUndefined();
  });

  it.each(['angry', 'confused'] as const)(
    'composes %s safely, keeps its semantic face bounded and deterministic, and clears it',
    (emotion) => {
      const frames = [30, 60, 120].map((fps) => {
        const actor = new ActingController();
        actor.cue({ emotion, gesture: 'none' }, 0);
        const accent = advance(actor, 1100, fps);
        const residue = advance(actor, 7000, fps, 1100);
        expect(accent).toMatchObject({ emotion, preset: emotion, gesture: 'none' });
        if (emotion === 'angry') {
          expect(accent.browY).toBeLessThan(-0.35);
          expect(accent.pout).toBeGreaterThan(0.2);
          expect(residue.browY).toBeLessThan(-0.04);
          expect(Math.abs(residue.browY)).toBeLessThan(Math.abs(accent.browY) * 0.8);
          expect(residue.smile).toBeLessThan(-0.2);
        } else {
          expect(accent.browInner).toBeGreaterThan(0.2);
          expect(Math.abs(accent.headZ)).toBeGreaterThan(0.08);
          expect(residue.browInner).toBeGreaterThan(0.08);
        }
        expect(residue).toMatchObject({ phase: 'afterglow', expressionWeight: 0.26 });
        expect(residue.mouthOpen).toBe(0);
        expect(advance(actor, reactionLifetime(emotion), fps, 7000)).toMatchObject({
          active: false,
          mouthOpen: 0,
          browY: 0,
          browInner: 0,
        });
        actor.cue({ emotion, gesture: 'none' }, 20000);
        advance(actor, 27000, fps, 20000);
        actor.setState('blocked', 27000);
        expect(actor.sample(27000, 0)).toMatchObject({
          active: false,
          mouthOpen: 0,
          browY: 0,
          browInner: 0,
          pout: 0,
          cheek: 0,
        });
        return { accent, residue };
      });
      for (const sample of frames.slice(1))
        for (const phase of ['accent', 'residue'] as const)
          for (const key of [
            ...motionKeys,
            'eyeL',
            'eyeR',
            'browY',
            'browInner',
            'pout',
            'mouthOpen',
          ] as const)
            expect(sample[phase][key]).toBeCloseTo(frames[0]![phase][key], 7);
    },
  );

  it('makes all newly exposed previews finite and keeps a wave as an explicit hand gesture', () => {
    for (const preset of ['sad', 'concerned', 'reassure', 'wave', 'angry', 'confused'] as const) {
      const actor = new ActingController();
      actor.preview(preset, 0);
      const face = advance(actor, 1100);
      expect(face).toMatchObject({ active: true, preset });
      if (preset === 'wave') expect(face.gesture).toBe('wave');
      if (preset === 'angry' || preset === 'confused') expect(face.emotion).toBe(preset);
      expect(advance(actor, reactionDuration(preset), 60, 1100)).toMatchObject({
        active: false,
        phase: 'idle',
        expressionWeight: 0,
      });
    }
  });

  it('gives happiness one short half-eye smile without increasing translation or breath', () => {
    const actor = new ActingController(),
      idle = new ActingController();
    actor.cue({ emotion: 'happy', gesture: 'none' }, 0);
    const accent = advance(actor, 1000),
      baseline = advance(idle, 1000);
    expect(accent.eyeL).toBeCloseTo(0.3, 3);
    expect(accent.eyeR).toBeCloseTo(0.3, 3);
    expect(accent.eyeSmile).toBeGreaterThan(0.4);
    expect(accent.offsetY).toBe(baseline.offsetY);
    expect(accent.breath).toBe(baseline.breath);
    expect(advance(actor, 1500, 60, 1000).eyeL).toBeCloseTo(0.7, 3);
  });

  it('makes laughter a visible tilt and one mouth pulse before settling to a closed-mouth grin', () => {
    const actor = new ActingController(),
      reduced = new ActingController();
    actor.preview('laugh', 0);
    reduced.configure({ intensity: 'normal', reducedMotion: true });
    reduced.preview('laugh', 0);
    let highIntervals = 0,
      wasOpen = false,
      peak = 0;
    for (let frame = 1; frame <= 144; frame++) {
      const time = (frame * 1000) / 60;
      const sample = actor.sample(time, 1 / 60);
      const quiet = reduced.sample(time, 1 / 60);
      const open = sample.mouthOpen > 0.1;
      if (open && !wasOpen) highIntervals++;
      wasOpen = open;
      peak = Math.max(peak, sample.mouthOpen);
      expect(quiet.mouthOpen).toBeCloseTo(sample.mouthOpen * 0.18, 7);
      if (frame === 60) {
        expect(sample.headZ).toBeGreaterThan(0.16);
        expect(sample.eyeL).toBeLessThan(0.11);
      }
    }
    expect(highIntervals).toBe(1);
    expect(peak).toBeGreaterThan(0.35 * 0.65 * 0.95);
    const settled = actor.sample(2400, 0);
    expect(settled.mouthOpen).toBeLessThan(0.001);
    expect(settled.eyeL).toBeGreaterThan(0.99);
    expect(settled.smile).toBeGreaterThan(0.5);
    expect(advance(actor, 3600, 60, 2400).active).toBe(false);
  });

  it('first averts embarrassed laughter, then delays the laugh without changing cue identity or lifetime', () => {
    const actor = new ActingController(),
      plain = new ActingController();
    actor.cue({ emotion: 'embarrassed', attitude: 'laugh', gesture: 'none' }, 0);
    plain.cue({ emotion: 'happy', attitude: 'laugh', gesture: 'none' }, 0);
    const shy = advance(actor, 700),
      laugh = advance(plain, 700);
    expect(shy).toMatchObject({ emotion: 'embarrassed', attitude: 'laugh', preset: 'laugh' });
    expect(shy.gazeX).toBeLessThan(laugh.gazeX - 0.25);
    expect(shy.headY).toBeLessThan(-0.2);
    expect(shy.eyeL).toBeGreaterThan(0.8);
    expect(shy.mouthOpen).toBe(0);
    const delayed = advance(actor, 1800, 60, 700);
    expect(delayed.eyeL).toBeLessThan(0.11);
    expect(delayed.mouthOpen).toBeGreaterThan(0.19);
    expect(delayed.gazeX).toBeGreaterThan(shy.gazeX + 0.2);
    expect(advance(actor, reactionLifetime('laugh'), 60, 1800)).toMatchObject({
      active: false,
      mouthOpen: 0,
      eyeSmile: 0,
    });
  });

  it('adds a single variant-one wink only after the two-eye laugh closure', () => {
    for (const variant of [0, 1]) {
      const actor = new ActingController();
      const cue = { emotion: 'happy', attitude: 'laugh', gesture: 'none' } as const;
      if (variant) {
        actor.cue(cue, 0);
        actor.reset(0);
      }
      actor.cue(cue, 0);
      const closed = advance(actor, 1100);
      expect(closed).toMatchObject({ variant });
      expect(closed.eyeL).toBeLessThan(0.11);
      expect(closed.eyeR).toBeLessThan(0.11);
      const reconnectAt = variant ? 2300 : 1950;
      const reopened = advance(actor, reconnectAt, 60, 1100);
      expect(reopened.eyeL).toBeGreaterThan(0.99);
      expect(reopened.eyeR).toBeGreaterThan(0.99);
      const winkAt = variant ? 2700 : 2400;
      const wink = advance(actor, winkAt, 60, reconnectAt);
      expect(wink.eyeL).toBeGreaterThan(0.99);
      if (variant) expect(wink.eyeR).toBeLessThan(0.11);
      else expect(wink.eyeR).toBeGreaterThan(0.99);
      const settled = advance(actor, 3300, 60, winkAt);
      expect(Math.abs(settled.eyeL - settled.eyeR)).toBeLessThan(0.03);
    }
  });

  it('makes anger a half-eye beat and keeps angry/confused mouths closed through afterglow', () => {
    const actor = new ActingController();
    actor.cue({ emotion: 'angry', gesture: 'none' }, 0);
    const attack = advance(actor, 200);
    expect(attack.eyeL).toBeGreaterThan(0.75);
    expect(attack.eyeL).toBeLessThan(0.9);
    const held = advance(actor, 700, 60, 200);
    expect(held.eyeL).toBeCloseTo(0.4, 3);
    expect(held.mouthOpen).toBe(0);
    const returned = advance(actor, 1500, 60, 700);
    expect(returned.eyeL).toBeCloseTo(0.5, 3);
    expect(Math.abs(returned.headZ)).toBeGreaterThan(0.15);
    const reconnect = advance(actor, 2800, 60, 1500);
    expect(Math.abs(reconnect.headZ)).toBeLessThan(Math.abs(returned.headZ) * 0.7);
    for (const emotion of ['angry', 'confused'] as const) {
      const a = new ActingController();
      a.cue({ emotion, gesture: 'none' }, 0);
      for (let frame = 1; frame <= 960; frame++)
        expect(a.sample((frame * 1000) / 60, 1 / 60).mouthOpen).toBe(0);
    }
  });

  it('gives confusion one recoil and opposite curious tilt instead of leaving its body unchanged', () => {
    const actor = new ActingController();
    actor.cue({ emotion: 'confused', gesture: 'none' }, 0);
    const emphasis = advance(actor, 800);
    expect(emphasis.headX).toBeLessThan(-0.3);
    expect(emphasis.bodyX).toBeLessThan(-0.1);
    expect(emphasis.lean).toBeLessThan(-0.08);
    expect(emphasis.headZ).toBeLessThan(-0.08);
    const settled = advance(actor, 2300, 60, 800);
    expect(settled.headX).toBeGreaterThan(0.1);
    expect(settled.gazeX).toBeGreaterThan(emphasis.gazeX + 0.3);
    expect(settled.headZ).toBeGreaterThan(0.25);
    expect(settled.lean).toBeGreaterThan(0.15);
    expect(settled.bodyZ).toBeLessThan(0);
    expect(settled.approach).toBeLessThanOrEqual(0);
    expect(settled.eyeL).toBeCloseTo(0.74, 3);
    expect(settled.eyeR).toBeGreaterThan(0.95);
  });

  it('gives an explain hand two early emphases, a later emphasis and one return acknowledgment within its original lifetime', () => {
    const actor = new ActingController(),
      baseline = new ActingController();
    actor.cue({ emotion: 'happy', gesture: 'explain' }, 0);
    baseline.cue({ emotion: 'happy', gesture: 'none' }, 0);
    let intervals = 0,
      wasNodding = false;
    for (let frame = 1; frame <= 972; frame++) {
      const time = (frame * 1000) / 60;
      const sample = actor.sample(time, 1 / 60),
        plain = baseline.sample(time, 1 / 60);
      const nodding = sample.headY < plain.headY - 0.1;
      if (nodding && !wasNodding) intervals++;
      wasNodding = nodding;
      if (frame === 75 || frame === 160 || frame === 450) {
        if (frame === 75) expect(sample.headY).toBeLessThan(-0.3);
        else expect(sample.headY).toBeLessThan(plain.headY - 0.1);
        expect(sample.browY).toBeGreaterThan(plain.browY + (frame === 160 ? 0.04 : 0.08));
      }
      expect(sample.offsetY).toBe(plain.offsetY);
      expect(sample.breath).toBe(plain.breath);
      if (frame === 960) expect(sample.active).toBe(true);
      if (frame === 972) expect(sample.active).toBe(false);
    }
    expect(intervals).toBe(4);
    const toneOnly = new ActingController();
    toneOnly.cue({ emotion: 'neutral', attitude: 'explain', gesture: 'none' }, 0);
    expect(advance(toneOnly, 7500).headY).toBeGreaterThan(-0.05);
  });

  it('keeps all sequential performances deterministic across 30/60/120fps including the late explain beat', () => {
    for (const cue of [
      { emotion: 'happy', gesture: 'none', attitude: 'laugh' },
      { emotion: 'embarrassed', gesture: 'none', attitude: 'laugh' },
      { emotion: 'happy', gesture: 'explain' },
      { emotion: 'angry', gesture: 'none' },
      { emotion: 'confused', gesture: 'none' },
    ] as const) {
      const paths = [30, 60, 120].map((fps) => {
        const actor = new ActingController();
        actor.cue(cue, 0);
        const values: ActingFrame[] = [];
        let start = 0;
        for (const time of [1000, 1500, 2400, 7500, 9000]) {
          values.push(advance(actor, time, fps, start));
          start = time;
        }
        return values;
      });
      for (const path of paths.slice(1))
        for (let i = 0; i < path.length; i++)
          for (const key of [
            ...motionKeys,
            'eyeL',
            'eyeR',
            'browY',
            'mouthOpen',
            'offsetY',
            'breath',
          ] as const)
            expect(path[i]![key]).toBeCloseTo(paths[0]![i]![key], 7);
    }
  });

  it('keeps worried teasing visibly withdrawn and concerned instead of reusing neutral teasing posture', () => {
    const worried = new ActingController(),
      playful = new ActingController();
    worried.cue({ emotion: 'concerned', attitude: 'tease', gesture: 'none' }, 0);
    playful.cue({ emotion: 'neutral', attitude: 'tease', gesture: 'none' }, 0);
    for (const [start, time] of [
      [0, 1000],
      [1000, 7000],
    ] as const) {
      const a = advance(worried, time, 60, start),
        b = advance(playful, time, 60, start);
      expect(a).toMatchObject({ emotion: 'concerned', attitude: 'tease', preset: 'tease' });
      expect(a.headZ).toBeGreaterThan(b.headZ + 0.2);
      expect(a.browInner).toBeGreaterThan(b.browInner + 0.2);
      expect(a.smile).toBeLessThan(b.smile * 0.6);
      expect(a.gazeY).toBeLessThan(b.gazeY - 0.08);
      expect(a.offsetY).toBe(b.offsetY);
    }
  });

  it('maintains finite expressive attention in a semantic hold, then withdraws it with the original deadline', () => {
    const actor = new ActingController(),
      idle = new ActingController();
    actor.cue({ emotion: 'happy', gesture: 'none' }, 0);
    const poses: ActingFrame[] = [];
    let start = 0;
    for (const time of [6000, 10500, 13000]) {
      const held = advance(actor, time, 60, start),
        baseline = advance(idle, time, 60, start);
      expect(held).toMatchObject({ phase: 'afterglow', active: true });
      expect(held.eyeSmile).toBeGreaterThan(0.3);
      expect(held.headZ).toBeGreaterThan(baseline.headZ + 0.08);
      expect(held.offsetY).toBe(baseline.offsetY);
      expect(held.breath).toBe(baseline.breath);
      poses.push(held);
      start = time;
    }
    expect(Math.abs(poses[0]!.gazeX - poses[1]!.gazeX)).toBeGreaterThan(0.15);
    const ended = advance(actor, reactionLifetime('happy'), 60, start);
    expect(ended).toMatchObject({ active: false, mouthOpen: 0, eyeSmile: 0, smile: 0 });
    expect(advance(actor, 18000, 60, 16200).headZ).toBeCloseTo(
      advance(idle, 18000, 60, 13000).headZ,
      2,
    );
  });

  it('coordinates long explain and greeting holds with gaze, face, and a finite return phrase', () => {
    for (const gesture of ['explain', 'wave'] as const) {
      const actor = new ActingController();
      const cue = {
        emotion: 'neutral',
        gesture,
        requestId: 'r',
        messageId: 'm',
        segmentId: 1,
      } as const;
      actor.cue(cue, 0);
      const looking = advance(actor, 6000);
      const reconnect = advance(actor, 8500, 60, 6000);
      expect(looking.eyeSmile).toBeGreaterThan(0.15);
      expect(looking.smile).toBeGreaterThan(0.12);
      expect(Math.abs(looking.gazeX - reconnect.gazeX)).toBeGreaterThan(0.12);
      const beforeReturn = advance(actor, 14000, 60, 8500);
      const returning = advance(actor, 15150, 60, 14000);
      expect(returning.headY).toBeLessThan(beforeReturn.headY - 0.02);
      expect(returning.eyeSmile).toBeLessThan(beforeReturn.eyeSmile);
      expect(actor.reactionTiming(cue, 15150)?.lifetime).toBe(16200);
      expect(advance(actor, 16200, 60, 15150)).toMatchObject({ active: false, smile: 0 });
    }
  });

  it('gives the second happiness variant a later, longer accent instead of only adding a wink', () => {
    const first = new ActingController(),
      second = new ActingController();
    const cue = { emotion: 'happy', gesture: 'none' } as const;
    second.cue(cue, 0);
    second.reset(0);
    first.cue(cue, 0);
    second.cue(cue, 0);
    const a = advance(first, 600),
      b = advance(second, 600);
    expect(b.variant).toBe(1);
    expect(b.eyeL).toBeGreaterThan(a.eyeL + 0.25);
    const laterA = advance(first, 1300, 60, 600),
      laterB = advance(second, 1300, 60, 600);
    expect(laterB.eyeL).toBeLessThan(laterA.eyeL - 0.35);
    expect(laterA.headZ).toBeGreaterThan(0);
    expect(laterB.headZ).toBeLessThan(0);
    expect(advance(first, 16200, 60, 1300).active).toBe(false);
    expect(advance(second, 16200, 60, 1300).active).toBe(false);
  });

  it('reconnects both axes of a shy glance and softens anger after its readable accent', () => {
    const shy = new ActingController(),
      angry = new ActingController();
    shy.cue({ emotion: 'embarrassed', gesture: 'none' }, 0);
    angry.cue({ emotion: 'angry', gesture: 'none' }, 0);
    const away = advance(shy, 700),
      stern = advance(angry, 700);
    expect(away.gazeX).toBeLessThan(-0.3);
    expect(away.gazeY).toBeLessThan(-0.2);
    const reconnect = advance(shy, 3000, 60, 700),
      soft = advance(angry, 3000, 60, 700);
    expect(reconnect.gazeX).toBeGreaterThan(away.gazeX + 0.2);
    expect(reconnect.gazeY).toBeGreaterThan(away.gazeY + 0.15);
    expect(Math.abs(soft.browY)).toBeLessThan(Math.abs(stern.browY) * 0.75);
    expect(soft.mouthOpen).toBe(0);
  });

  it('keeps held attention and return phrases scaled, interruptible, and deterministic at every frame rate', () => {
    for (const gesture of ['none', 'explain', 'wave'] as const) {
      const paths = [30, 60, 120].map((fps) => {
        const normal = new ActingController(),
          reduced = new ActingController();
        reduced.configure({ intensity: 'normal', reducedMotion: true });
        const cue = { emotion: 'happy', gesture } as const;
        normal.cue(cue, 0);
        reduced.cue(cue, 0);
        const values: ActingFrame[] = [];
        let start = 0;
        for (const time of [6000, 10500, 15200]) {
          const full = advance(normal, time, fps, start),
            quiet = advance(reduced, time, fps, start);
          for (const key of [...motionKeys, 'smile', 'eyeSmile', 'mouthOpen'] as const)
            expect(quiet[key]).toBeCloseTo(full[key] * 0.18, key === 'smile' ? 4 : 7);
          values.push(full);
          start = time;
        }
        normal.setState('blocked', 15200);
        expect(normal.sample(15200, 0)).toMatchObject({
          active: false,
          headZ: 0,
          gazeX: 0,
          smile: 0,
        });
        return values;
      });
      for (const path of paths.slice(1))
        for (let i = 0; i < path.length; i++)
          for (const key of [...motionKeys, 'smile', 'eyeSmile', 'mouthOpen'] as const)
            expect(path[i]![key]).toBeCloseTo(paths[0]![i]![key], 7);
    }
  });

  it('pairs existing irregular idle gaze shifts with a restrained tilt and viewer reconnection', () => {
    const actor = new ActingController(),
      reduced = new ActingController();
    reduced.configure({ intensity: 'normal', reducedMotion: true });
    const before = advance(actor, 600);
    advance(reduced, 600);
    expect(Math.abs(before.headZ)).toBeLessThan(0.01);
    const shifted = advance(actor, 1400, 60, 600),
      quiet = advance(reduced, 1400, 60, 600);
    expect(Math.abs(shifted.headZ)).toBeGreaterThan(0.08);
    expect(quiet.headZ).toBeCloseTo(shifted.headZ * 0.18, 7);
    expect(shifted).toMatchObject({ active: false, mouthOpen: 0, smile: 0 });
    const reconnect = advance(actor, 2500, 60, 1400);
    expect(reconnect.gazeX * shifted.gazeX).toBeLessThan(0);
    expect(reconnect.gazeX * reconnect.headX).toBeLessThan(0);
    expect(Math.abs(reconnect.gazeX)).toBeGreaterThan(Math.abs(shifted.gazeX) * 0.4);
    expect(Math.abs(reconnect.headZ)).toBeLessThan(Math.abs(shifted.headZ) * 0.5);
    actor.setState('blocked', 2500);
    expect(actor.sample(2500, 0)).toMatchObject({ headZ: 0, gazeX: 0, mouthOpen: 0 });
    const frames = [30, 60, 120].map((fps) => advance(new ActingController(), 10000, fps));
    for (const frame of frames.slice(1))
      for (const key of [...motionKeys, 'offsetY', 'breath', 'blink'] as const)
        expect(frame[key]).toBeCloseTo(frames[0]![key], 7);
  });

  it('preserves the real one-eye closure when worried emotion composes with teasing variant one', () => {
    const paths = [30, 60, 120].map((fps) => {
      const actor = new ActingController();
      const cue = { emotion: 'concerned', attitude: 'tease', gesture: 'none' } as const;
      actor.cue(cue, 0);
      actor.reset(0);
      actor.cue(cue, 0);
      const worry = advance(actor, 800, fps);
      expect(worry.eyeL).toBeGreaterThan(0.6);
      expect(worry.eyeR).toBeGreaterThan(0.75);
      expect(worry.smile).toBeLessThan(-0.7);
      expect(worry.browInner).toBeGreaterThan(0.4);
      expect(worry.gazeX).toBeLessThan(-0.1);
      expect(worry.gazeX).toBeGreaterThan(-0.2);
      // Put an idle blink under the delayed wink. Both eyes must not close.
      (actor as unknown as { blinkAt: number }).blinkAt = 1850;
      const wink = advance(actor, 1900, fps, 800);
      expect(wink).toMatchObject({ emotion: 'concerned', attitude: 'tease', variant: 1 });
      expect(wink.eyeR).toBeLessThan(0.04);
      expect(wink.eyeL).toBeGreaterThan(0.6);
      expect(wink.browInner).toBeGreaterThan(0.3);
      const returned = advance(actor, 2500, fps, 1900);
      expect(returned.eyeR).toBeGreaterThan(0.76);
      const reconnect = advance(actor, 3000, fps, 2500);
      expect(Math.abs(reconnect.gazeX)).toBeLessThan(Math.abs(worry.gazeX) * 0.4);
      expect(reconnect.browInner).toBeGreaterThan(0.3);
      expect(reconnect.headZ).toBeGreaterThan(0.1);
      actor.setState('blocked', 3000);
      expect(actor.sample(3000, 0)).toMatchObject({ eyeL: 1, eyeR: 1, headZ: 0, gazeX: 0 });
      return { worry, wink, returned, reconnect };
    });
    for (const path of paths.slice(1))
      for (const phase of ['worry', 'wink', 'returned', 'reconnect'] as const)
        for (const key of [...motionKeys, 'eyeL', 'eyeR', 'browInner'] as const)
          expect(path[phase][key]).toBeCloseTo(paths[0]![phase][key], 7);
  });

  it('keeps readable emotional head intent after the initial peak while respecting global intensity and root motion', () => {
    for (const cue of [
      { emotion: 'happy', gesture: 'none' },
      { emotion: 'concerned', attitude: 'tease', gesture: 'none' },
      { emotion: 'embarrassed', gesture: 'none' },
    ] as const) {
      const actor = new ActingController(),
        reduced = new ActingController(),
        idle = new ActingController();
      reduced.configure({ intensity: 'normal', reducedMotion: true });
      actor.cue(cue, 0);
      reduced.cue(cue, 0);
      const accent = advance(actor, 1000),
        quiet = advance(reduced, 1000),
        baseline = advance(idle, 1000);
      expect(Math.abs(accent.headZ)).toBeGreaterThan(0.28);
      expect(quiet.headZ).toBeCloseTo(accent.headZ * 0.18, 7);
      expect(accent.offsetY).toBe(baseline.offsetY);
      expect(accent.breath).toBe(baseline.breath);
      const residue = advance(actor, 2800, 60, 1000);
      if (cue.emotion === 'happy') expect(residue.headX).toBeLessThan(-0.3);
      else expect(Math.abs(residue.headZ)).toBeGreaterThan(0.12);
      if (cue.emotion === 'happy') expect(residue.mouthOpen).toBeCloseTo(0.18 * 0.65, 6);
      else expect(residue.mouthOpen).toBe(0);
      expect(advance(actor, reactionLifetime(residue.preset), 60, 2800).active).toBe(false);
    }
  });

  it('keeps every held emotional face distinct instead of converging to a polite smile', () => {
    const held = (emotion: (typeof EMOTIONS)[number], attitude?: 'tease') => {
      const actor = new ActingController();
      actor.cue({ emotion, gesture: 'none', ...(attitude ? { attitude } : {}) }, 0);
      return advance(actor, 8000);
    };
    const happy = held('happy'),
      angry = held('angry'),
      confused = held('confused');
    const shy = held('embarrassed'),
      worried = held('concerned', 'tease'),
      playful = held('neutral', 'tease');
    expect(happy.eyeSmile).toBeGreaterThan(0.49);
    expect(happy.eyeL).toBeGreaterThan(0.8);
    expect(happy.eyeL).toBeLessThan(0.9);
    expect(happy.smile).toBeGreaterThan(0.35);
    expect(angry.smile).toBeLessThan(-0.2);
    expect(angry.browY).toBeLessThan(-0.25);
    expect(angry.eyeL).toBeLessThan(0.75);
    expect(angry.mouthOpen).toBe(0);
    expect(confused.smile).toBeLessThan(-0.1);
    expect(confused.browInner).toBeGreaterThan(0.3);
    expect(confused.pout).toBeGreaterThan(0.12);
    expect(confused.eyeR - confused.eyeL).toBeGreaterThan(0.2);
    expect(confused.mouthOpen).toBe(0);
    expect(shy.smile).toBeGreaterThan(0.1);
    expect(shy.smile).toBeLessThan(happy.smile * 0.5);
    expect(shy.browInner).toBeGreaterThan(0.16);
    expect(worried.smile).toBeLessThan(-0.08);
    expect(worried.browInner).toBeGreaterThan(0.35);
    expect(worried.gazeY).toBeLessThan(-0.15);
    expect(playful.smile).toBeGreaterThan(0.4);
    expect(playful.eyeR - playful.eyeL).toBeGreaterThan(0.2);
    expect(playful.gazeX).toBeGreaterThan(0.1);
    expect(playful.browInner).toBe(0);
  });

  it('preserves either timed wink side through the actual worried emotion composition', () => {
    for (const variant of [0, 1]) {
      for (const fps of [30, 60, 120]) {
        const actor = new ActingController();
        const cue = { emotion: 'concerned', attitude: 'tease', gesture: 'none' } as const;
        if (variant) {
          actor.cue(cue, 0);
          actor.reset(0);
        }
        actor.cue(cue, 0);
        const time = variant ? 1800 : 2000;
        const frame = advance(actor, time, fps);
        expect(frame).toMatchObject({ emotion: 'concerned', attitude: 'tease', variant });
        expect(frame[variant ? 'eyeR' : 'eyeL']).toBeLessThan(0.04);
        expect(frame[variant ? 'eyeL' : 'eyeR']).toBeGreaterThan(0.6);
        expect(frame.browInner).toBeGreaterThan(0.3);
        const recovered = advance(actor, 2800, fps, time);
        expect(recovered.eyeL).toBeGreaterThan(0.6);
        expect(recovered.eyeR).toBeGreaterThan(0.75);
        expect(recovered.smile).toBeGreaterThan(0.3);
        expect(recovered.mouthOpen).toBe(0);
        const held = advance(actor, 8000, fps, 2800);
        expect(held.smile).toBeLessThan(-0.1);
        expect(held.browInner).toBeGreaterThan(0.3);
      }
    }
  });

  it('keeps composed held faces deterministic, accessibility-scaled and neutral at the finite deadline', () => {
    for (const cue of [
      { emotion: 'happy', gesture: 'none' },
      { emotion: 'angry', gesture: 'none' },
      { emotion: 'confused', gesture: 'none' },
      { emotion: 'embarrassed', gesture: 'none' },
      { emotion: 'concerned', attitude: 'tease', gesture: 'none' },
      { emotion: 'neutral', attitude: 'tease', gesture: 'none' },
      { emotion: 'neutral', gesture: 'explain' },
      { emotion: 'neutral', gesture: 'wave' },
    ] as const) {
      const frames = [30, 60, 120].map((fps) => {
        const actor = new ActingController(),
          reduced = new ActingController();
        reduced.configure({ intensity: 'normal', reducedMotion: true });
        actor.cue(cue, 0);
        reduced.cue(cue, 0);
        const full = advance(actor, 8000, fps),
          quiet = advance(reduced, 8000, fps);
        for (const key of [
          ...motionKeys,
          'smile',
          'eyeSmile',
          'browY',
          'browInner',
          'pout',
          'cheek',
          'mouthOpen',
        ] as const)
          expect(quiet[key]).toBeCloseTo(full[key] * 0.18, 6);
        for (const key of ['eyeL', 'eyeR'] as const)
          expect(1 - quiet[key]).toBeCloseTo((1 - full[key]) * 0.18, 6);
        const end = reactionLifetime(full.preset);
        const expired = advance(actor, end, fps, 8000);
        expect(expired).toMatchObject({
          active: false,
          smile: 0,
          mouthOpen: 0,
          eyeSmile: 0,
          browY: 0,
          browInner: 0,
          pout: 0,
          cheek: 0,
        });
        expect(expired.eyeL).toBe(expired.blink);
        expect(expired.eyeR).toBe(expired.blink);
        return full;
      });
      for (const frame of frames.slice(1))
        for (const key of [
          ...motionKeys,
          'eyeL',
          'eyeR',
          'smile',
          'eyeSmile',
          'browY',
          'browInner',
          'pout',
        ] as const)
          expect(frame[key]).toBeCloseTo(frames[0]![key], 7);
    }
  });

  it('turns the head and delayed torso coherently toward idle and authored-hand attention', () => {
    const idle = new ActingController();
    const early = advance(idle, 900),
      looking = advance(idle, 1400, 60, 900);
    expect(Math.abs(looking.headX)).toBeGreaterThan(0.18);
    expect(Math.abs(looking.bodyX)).toBeGreaterThan(0.05);
    expect(looking.headX * looking.gazeX).toBeGreaterThan(0);
    expect(looking.headX * looking.bodyX).toBeGreaterThan(0);
    expect(Math.abs(early.bodyX)).toBeLessThan(Math.abs(early.headX) * 0.4);
    for (const gesture of ['explain', 'wave'] as const) {
      const actor = new ActingController();
      const cue = {
        requestId: 'r',
        messageId: 'm',
        segmentId: 1,
        emotion: 'neutral',
        gesture,
      } as const;
      actor.cue(cue, 0);
      const attention = advance(actor, 6000);
      expect(attention).toMatchObject({ phase: 'afterglow', active: true });
      expect(Math.abs(attention.headX)).toBeGreaterThan(0.35);
      expect(Math.abs(attention.bodyX)).toBeGreaterThan(0.14);
      expect(attention.headX * attention.gazeX).toBeGreaterThan(0);
      expect(attention.headX * attention.bodyX).toBeGreaterThan(0);
      expect(actor.clearCue(cue)).toBe(true);
      expect(actor.sample(6000, 0)).toMatchObject({ headX: 0, bodyX: 0, gazeX: 0, active: false });
    }
  });

  it('bounds calibrated horizontal poses under large compound cues and preserves quiet/reduced frame trajectories', () => {
    for (const [intensity, reducedMotion, scale] of [
      ['expressive', false, 1],
      ['normal', false, 0.65],
      ['quiet', false, 0.35],
      ['normal', true, 0.65 * 0.18],
    ] as const) {
      const frames = [30, 60, 120].map((fps) => {
        const actor = new ActingController();
        actor.configure({ intensity, reducedMotion });
        actor.cue({ emotion: 'concerned', attitude: 'tease', gesture: 'none' }, 0);
        const path: ActingFrame[] = [];
        let start = 0;
        for (const time of [1000, 6000, 10500]) {
          const frame = advance(actor, time, fps, start);
          expect(Math.abs(frame.headX)).toBeLessThanOrEqual(0.7 * scale + 1e-10);
          expect(Math.abs(frame.bodyX)).toBeLessThanOrEqual(0.5 * scale + 1e-10);
          path.push(frame);
          start = time;
        }
        actor.configure({ intensity: 'quiet', reducedMotion: true });
        expect(Math.abs(actor.sample(10500, 0).headX)).toBeLessThanOrEqual(
          0.7 * 0.35 * 0.18 + 1e-10,
        );
        expect(Math.abs(actor.sample(10500, 0).bodyX)).toBeLessThanOrEqual(
          0.5 * 0.35 * 0.18 + 1e-10,
        );
        actor.setState('blocked', 10500);
        expect(actor.sample(10500, 0)).toMatchObject({ headX: 0, bodyX: 0, gazeX: 0 });
        return path;
      });
      for (const path of frames.slice(1))
        for (let i = 0; i < path.length; i++)
          for (const key of [...motionKeys, 'offsetY', 'breath'] as const)
            expect(path[i]![key]).toBeCloseTo(frames[0]![i]![key], 7);
    }
  });

  it('gives anger an early turn-away and reluctant reconnection without clearing the side posture', () => {
    const actor = new ActingController();
    actor.cue({ emotion: 'angry', gesture: 'none' }, 0);
    const away = advance(actor, 1000);
    expect(away.headX).toBeLessThan(-0.35);
    expect(away.bodyX).toBeLessThan(-0.14);
    expect(away.gazeX).toBeLessThan(-0.3);
    expect(away.gesture).toBe('none');
    const reconnect = advance(actor, 2800, 60, 1000);
    expect(reconnect.gazeX).toBeGreaterThan(away.gazeX + 0.3);
    expect(reconnect.headX).toBeLessThan(-0.15);
    expect(reconnect.bodyX).toBeLessThan(-0.1);
    expect(reconnect.mouthOpen).toBe(0);
    const held = advance(actor, 8000, 60, 2800);
    expect(held.headX).toBeLessThan(-0.2);
    expect(held.smile).toBeLessThan(-0.2);
    actor.setState('blocked', 8000);
    expect(actor.sample(8000, 0)).toMatchObject({ headX: 0, bodyX: 0, lean: 0 });
  });

  it('gives joy and laughter one forward body phrase that settles without adding a hand or changing breath', () => {
    for (const attitude of ['neutral', 'laugh'] as const) {
      const actor = new ActingController(),
        reduced = new ActingController(),
        idle = new ActingController();
      reduced.configure({ intensity: 'normal', reducedMotion: true });
      const cue = { emotion: 'happy', attitude, gesture: 'none' } as const;
      actor.cue(cue, 0);
      reduced.cue(cue, 0);
      const accent = advance(actor, 1000),
        quiet = advance(reduced, 1000),
        baseline = advance(idle, 1000);
      expect(accent.lean).toBeGreaterThan(0.18);
      expect(accent.headX).toBeGreaterThan(0.1);
      if (attitude === 'laugh') expect(accent.bodyX).toBeLessThan(-0.1);
      else expect(accent.bodyX).toBeGreaterThan(0.04);
      expect(accent.gesture).toBe('none');
      expect(quiet.lean).toBeCloseTo(accent.lean * 0.18, 7);
      expect(accent.offsetY).toBe(baseline.offsetY);
      expect(accent.breath).toBe(baseline.breath);
      expect(advance(actor, 3000, 60, 1000).lean).toBeLessThan(accent.lean * 0.5);
    }
  });

  it('gives pure laughter two unequal finite chuckles across variants, frame rates and accessibility', () => {
    for (const emotion of ['happy', 'neutral'] as const)
      for (const variant of [0, 1])
        for (const [intensity, intensityScale] of [
          ['quiet', 0.35],
          ['normal', 0.65],
          ['expressive', 1],
        ] as const)
          for (const reducedMotion of [false, true]) {
            const scale = intensityScale * (reducedMotion ? 0.18 : 1);
            const direction = variant ? -1 : 1;
            const cue = {
              emotion,
              attitude: 'laugh',
              gesture: 'none',
            } as const;
            const paths = [30, 60, 120].map((fps) => {
              const actor = new ActingController(),
                idle = new ActingController();
              for (const a of [actor, idle]) a.configure({ intensity, reducedMotion });
              if (variant) {
                actor.cue(cue, 0);
                actor.reset(0);
              }
              actor.cue(cue, 0);
              const times = variant ? [1000, 1600, 2100] : [700, 1300, 1700];
              const frames: ActingFrame[] = [];
              let start = 0;
              for (const time of [...times, 4000, 8000]) {
                const frame = advance(actor, time, fps, start),
                  baseline = advance(idle, time, fps, start);
                expect(Math.abs(frame.headY)).toBeLessThanOrEqual(scale);
                expect(Math.abs(frame.headZ)).toBeLessThanOrEqual(scale);
                expect(Math.abs(frame.bodyX)).toBeLessThanOrEqual(0.5 * scale);
                expect(Math.abs(frame.bodyZ)).toBeLessThanOrEqual(0.3 * scale);
                expect(frame.offsetY).toBe(baseline.offsetY);
                expect(frame.breath).toBe(baseline.breath);
                expect(frame).toMatchObject({
                  emotion,
                  attitude: 'laugh',
                  gesture: 'none',
                  variant,
                });
                frames.push(frame);
                start = time;
              }
              const [first, recovered, second] = frames as [ActingFrame, ActingFrame, ActingFrame];
              // Two distinct dips separated by a recovery, with a smaller
              // second chuckle and a different roll/shoulder response.
              expect(first.headY).toBeLessThan(recovered.headY - 0.15 * scale);
              expect(second.headY).toBeLessThan(recovered.headY - 0.08 * scale);
              expect(first.headY).toBeLessThan(second.headY - 0.04 * scale);
              expect(first.headZ * direction).toBeGreaterThan(
                second.headZ * direction + 0.3 * scale,
              );
              expect(first.bodyX * direction).toBeGreaterThan(
                second.bodyX * direction + 0.1 * scale,
              );
              expect(second.bodyZ * direction).toBeGreaterThan(
                first.bodyZ * direction + 0.1 * scale,
              );
              const held = frames.at(-1)!;
              expect(held.bodyX).toBeCloseTo(-direction * 0.26 * scale, 6);
              expect(held.bodyZ).toBeCloseTo(direction * 0.28 * scale, 6);
              expect(advance(actor, reactionLifetime('laugh'), fps, 8000)).toMatchObject({
                active: false,
                smile: 0,
                mouthOpen: 0,
              });
              return frames;
            });
            for (const path of paths.slice(1))
              for (let i = 0; i < path.length; i++)
                for (const key of [...motionKeys, 'offsetY', 'breath'] as const)
                  expect(path[i]![key]).toBeCloseTo(paths[0]![i]![key], 7);
          }
  });

  it('keeps the original single recovery for hand gestures, concern and other attitudes', () => {
    const controls = [
      { emotion: 'happy', attitude: 'laugh', gesture: 'wave' },
      { emotion: 'happy', attitude: 'laugh', gesture: 'thinking' },
      { emotion: 'happy', attitude: 'laugh', gesture: 'explain' },
      { emotion: 'concerned', attitude: 'laugh', gesture: 'none' },
      { emotion: 'happy', attitude: 'neutral', gesture: 'none' },
    ] as const;
    for (const cue of controls) {
      const actor = new ActingController();
      actor.cue(cue, 0);
      const middle = advance(actor, 1300),
        recovered = advance(actor, 1700, 60, 1300);
      expect(recovered.headY).toBeGreaterThan(middle.headY);
      expect(recovered).toMatchObject(cue);
    }
  });

  it('clears chuckles immediately at existing ownership boundaries and retains short delivery/preview deadlines', () => {
    const cue = {
      requestId: 'chuckle',
      messageId: 'm',
      segmentId: 1,
      emotion: 'happy',
      attitude: 'laugh',
      gesture: 'none',
    } as const;
    for (const fps of [30, 60, 120]) {
      for (const boundary of ['clear', 'reset', 'blocked', 'error'] as const) {
        const actor = new ActingController();
        actor.cue(cue, 0);
        const second = advance(actor, 1700, fps);
        expect(second.headY).toBeLessThan(-0.1);
        expect(actor.clearCue({ ...cue, segmentId: 2 })).toBe(false);
        expect(actor.sample(1700, 0)).toEqual(second);
        if (boundary === 'clear') expect(actor.clearCue(cue)).toBe(true);
        else if (boundary === 'reset') actor.reset(1700);
        else actor.setState(boundary, 1700);
        expect(actor.sample(1700, 0)).toMatchObject({
          active: false,
          headY: 0,
          headZ: 0,
          bodyX: 0,
          bodyZ: 0,
        });
      }
      for (const mode of ['preview', 'delivery'] as const) {
        const actor = new ActingController();
        if (mode === 'preview') actor.preview('laugh', 0);
        else actor.cue({ ...cue, stage: 'delivery' }, 0);
        const second = advance(actor, 1700, fps);
        expect(second.headY).toBeLessThan(-0.1);
        expect(advance(actor, reactionDuration('laugh'), fps, 1700).active).toBe(false);
      }
    }
  });

  it('gives concerned teasing an attentive small bow before reconnecting on the same finite clock', () => {
    const paths = [30, 60, 120].map((fps) => {
      const actor = new ActingController();
      actor.cue({ emotion: 'concerned', attitude: 'tease', gesture: 'none' }, 0);
      const away = advance(actor, 700, fps);
      expect(away.headY).toBeLessThan(-0.15);
      expect(away.headY).toBeGreaterThan(-0.27);
      expect(away.headX).toBeLessThan(-0.15);
      expect(away.headX).toBeGreaterThan(-0.3);
      const reconnect = advance(actor, 2600, fps, 700);
      expect(reconnect.headY).toBeGreaterThan(away.headY + 0.06);
      expect(reconnect.gazeX).toBeGreaterThan(away.gazeX + 0.13);
      expect(reconnect).toMatchObject({ emotion: 'concerned', attitude: 'tease', gesture: 'none' });
      expect(advance(actor, reactionLifetime('tease'), fps, 2600).active).toBe(false);
      return { away, reconnect };
    });
    for (const path of paths.slice(1))
      for (const phase of ['away', 'reconnect'] as const)
        for (const key of [...motionKeys, 'offsetY', 'breath', 'mouthOpen'] as const)
          expect(path[phase][key]).toBeCloseTo(paths[0]![phase][key], 7);
  });

  it('connects attentive concern to the delayed wink, closed-mouth relief and concerned hold at every intensity', () => {
    for (const [intensity, intensityScale] of [
      ['quiet', 0.35],
      ['normal', 0.65],
      ['expressive', 1],
    ] as const)
      for (const reducedMotion of [false, true])
        for (const variant of [0, 1]) {
          const reducedScale = reducedMotion ? 0.18 : 1;
          const scale = intensityScale * reducedScale;
          const faceScale = Math.min(1, scale / 0.65);
          const cue = {
            requestId: 'attentive-concern',
            messageId: 'm',
            segmentId: 1,
            emotion: 'concerned',
            attitude: 'tease',
            gesture: 'none',
          } as const;
          const paths = [30, 60, 120].map((fps) => {
            const actor = new ActingController(),
              idle = new ActingController();
            for (const a of [actor, idle]) a.configure({ intensity, reducedMotion });
            if (variant) {
              actor.cue(cue, 0);
              actor.reset(0);
            }
            actor.cue(cue, 0);
            const worry = advance(actor, 1000, fps),
              baseline = advance(idle, 1000, fps);
            expect(worry.smile).toBeLessThan(-0.7 * faceScale);
            expect(worry.browInner).toBeGreaterThan(0.65 * scale);
            expect(worry.eyeL).toBeGreaterThan(1 - 0.13 * reducedScale);
            expect(worry.eyeR).toBeGreaterThan(1 - 0.05 * reducedScale);
            // The small downward/side glance still reads as concern while
            // leaving room below the existing .7 head clamp.
            expect(worry.headX).toBeGreaterThan(-0.55 * scale);
            expect(worry.headX).toBeLessThan(-0.3 * scale);
            expect(worry.headY).toBeGreaterThan(-0.4 * scale);
            expect(worry.headY).toBeLessThan(-0.25 * scale);
            expect(worry.breath).toBe(baseline.breath);
            expect(worry.offsetY).toBe(baseline.offsetY);
            const winkAt = variant ? 1800 : 2000;
            (actor as unknown as { blinkAt: number }).blinkAt = winkAt - 50;
            const wink = advance(actor, winkAt, fps, 1000);
            const closed = wink[variant ? 'eyeR' : 'eyeL'],
              open = wink[variant ? 'eyeL' : 'eyeR'];
            expect(open - closed).toBeGreaterThan(0.7 * reducedScale);
            expect(open).toBeGreaterThan(1 - 0.13 * reducedScale);
            expect(closed).toBeLessThan(1 - 0.85 * reducedScale);
            const relief = advance(actor, 3000, fps, winkAt);
            expect(relief.smile).toBeGreaterThan(0.35 * faceScale);
            expect(relief.eyeL).toBeGreaterThan(1 - 0.13 * reducedScale);
            expect(relief.eyeR).toBeGreaterThan(1 - 0.05 * reducedScale);
            const held = advance(actor, 8000, fps, 3000);
            expect(held.smile).toBeLessThan(-0.14 * scale);
            expect(held.browInner).toBeGreaterThan(0.6 * scale);
            for (const frame of [worry, wink, relief, held])
              expect(frame).toMatchObject({
                emotion: 'concerned',
                attitude: 'tease',
                gesture: 'none',
                active: true,
                mouthOpen: 0,
                variant,
              });
            const expired = advance(actor, reactionLifetime('tease'), fps, 8000);
            expect(expired).toMatchObject({ active: false, smile: 0, browInner: 0, mouthOpen: 0 });
            expect(expired.eyeL).toBe(expired.blink);
            expect(expired.eyeR).toBe(expired.blink);
            return [worry, wink, relief, held, expired];
          });
          for (const path of paths.slice(1))
            for (let i = 0; i < path.length; i++)
              for (const key of [
                ...motionKeys,
                'eyeL',
                'eyeR',
                'smile',
                'browInner',
                'breath',
                'offsetY',
              ] as const)
                expect(path[i]![key]).toBeCloseTo(paths[0]![i]![key], 7);
        }
  });

  it('lets eyes counter-look before the torso settles and retains a side posture within the same slot', () => {
    const actor = new ActingController();
    const looking = advance(actor, 1400);
    const settling = advance(actor, 2200, 60, 1400);
    expect(settling.gazeX * looking.gazeX).toBeLessThan(0);
    expect(settling.gazeX * settling.headX).toBeLessThan(0);
    expect(Math.abs(settling.bodyX)).toBeGreaterThan(Math.abs(looking.bodyX) * 1.7);
    expect(settling.bodyX).toBeLessThan(-0.2);
    const returned = advance(actor, 4500, 60, 2200);
    expect(Math.abs(returned.bodyX)).toBeLessThan(Math.abs(settling.bodyX));
    expect(returned.gazeX * returned.headX).toBeLessThan(0);
    expect(returned).toMatchObject({ active: false, gesture: 'none', mouthOpen: 0 });
  });

  it('keeps laughter tilted toward the listener and sulking tilted away through their holds', () => {
    for (const variant of [0, 1])
      for (const reducedMotion of [false, true]) {
        const direction = variant ? -1 : 1;
        const paths = [30, 60, 120].map((fps) => {
          const frames = ['happy', 'laugh', 'angry'].map((kind) => {
            const actor = new ActingController();
            actor.configure({ intensity: 'normal', reducedMotion });
            const cue = {
              emotion: kind === 'angry' ? 'angry' : 'happy',
              attitude: kind === 'laugh' ? 'laugh' : 'neutral',
              gesture: 'none',
            } as const;
            if (variant) {
              actor.cue(cue, 0);
              actor.reset(0);
            }
            actor.cue(cue, 0);
            const held = advance(actor, 8000, fps);
            expect(held.gesture).toBe('none');
            expect(advance(actor, reactionLifetime(held.preset), fps, 8000).active).toBe(false);
            return held;
          });
          const [happy, laugh, angry] = frames as [ActingFrame, ActingFrame, ActingFrame];
          expect(laugh.headZ * direction).toBeGreaterThan(happy.headZ * direction);
          expect(angry.headZ * direction).toBeLessThan(0);
          expect(laugh.headZ * direction).toBeGreaterThan(0);
          expect(angry.mouthOpen).toBe(0);
          expect(angry.offsetY).toBe(laugh.offsetY);
          expect(angry.breath).toBe(laugh.breath);
          return frames;
        });
        for (const path of paths.slice(1))
          for (let i = 0; i < path.length; i++)
            expect(path[i]!.headZ).toBeCloseTo(paths[0]![i]!.headZ, 7);
      }
  });

  it('damps the emotional torso roll within intensity limits and clears it with the cue', () => {
    for (const [intensity, reducedMotion, scale] of [
      ['quiet', false, 0.35],
      ['normal', false, 0.65],
      ['expressive', false, 1],
      ['normal', true, 0.65 * 0.18],
    ] as const) {
      const frames = [30, 60, 120].map((fps) => {
        const actor = new ActingController();
        actor.configure({ intensity, reducedMotion });
        const cue = {
          requestId: 'roll',
          messageId: 'm',
          segmentId: 1,
          emotion: 'happy',
          attitude: 'laugh',
          gesture: 'none',
        } as const;
        actor.cue(cue, 0);
        const early = advance(actor, 300, fps);
        expect(Math.abs(early.bodyZ)).toBeLessThan(Math.abs(early.headZ));
        const held = advance(actor, 8000, fps, 300);
        expect(held.bodyZ).toBeGreaterThan(0);
        expect(Math.abs(held.bodyZ)).toBeLessThanOrEqual(0.3 * scale + 1e-10);
        expect(actor.clearCue(cue)).toBe(true);
        expect(actor.sample(8000, 0).bodyZ).toBe(0);
        actor.setState('blocked', 8000);
        expect(actor.sample(9000, 1).bodyZ).toBe(0);
        return held.bodyZ;
      });
      for (const frame of frames.slice(1)) expect(frame).toBeCloseTo(frames[0]!, 7);
    }
  });

  it('holds distinct emotional torso attitudes on the original cue clock across frame rates and accessibility', () => {
    const cases = [
      { emotion: 'happy', attitude: 'neutral', preset: 'happy', x: 0.1, z: 0.04 },
      { emotion: 'happy', attitude: 'laugh', preset: 'laugh', x: -0.26, z: 0.28 },
      { emotion: 'neutral', attitude: 'laugh', preset: 'laugh', x: -0.26, z: 0.28 },
      { emotion: 'embarrassed', attitude: 'neutral', preset: 'shy', x: 0.24, z: -0.28 },
      { emotion: 'embarrassed', attitude: 'laugh', preset: 'laugh', x: 0.24, z: -0.28 },
      { emotion: 'angry', attitude: 'neutral', preset: 'angry', x: -0.44, z: 0.22 },
    ] as const;
    for (const profile of cases)
      for (const variant of [0, 1])
        for (const [intensity, intensityScale] of [
          ['quiet', 0.35],
          ['normal', 0.65],
          ['expressive', 1],
        ] as const)
          for (const reducedMotion of [false, true]) {
            const scale = intensityScale * (reducedMotion ? 0.18 : 1);
            const direction = variant ? -1 : 1;
            const cue = {
              requestId: 'torso',
              messageId: 'm',
              segmentId: 1,
              emotion: profile.emotion,
              attitude: profile.attitude,
              gesture: 'none',
            } as const;
            const end = reactionLifetime(profile.preset);
            const paths = [30, 60, 120].map((fps) => {
              const actor = new ActingController(),
                idle = new ActingController();
              for (const a of [actor, idle]) a.configure({ intensity, reducedMotion });
              if (variant) {
                actor.cue(cue, 0);
                actor.reset(0);
              }
              actor.cue(cue, 0);
              const frames: ActingFrame[] = [];
              let start = 0;
              for (const at of [300, 1000, 3000, 8000, end - 600, end]) {
                const frame = advance(actor, at, fps, start),
                  baseline = advance(idle, at, fps, start);
                expect(Math.abs(frame.bodyX)).toBeLessThanOrEqual(0.5 * scale + 1e-10);
                expect(Math.abs(frame.bodyZ)).toBeLessThanOrEqual(0.3 * scale + 1e-10);
                expect(frame.offsetY).toBe(baseline.offsetY);
                expect(frame.breath).toBe(baseline.breath);
                if (at === 8000) {
                  if (profile.preset === 'angry') {
                    // The finite shoulder check leaves a small damped tail.
                    // Bound it by the maximum excursion and time since 3.1s.
                    const checkTail = Math.exp(-2.1 * (8 - 3.1));
                    expect(Math.abs(frame.bodyX - direction * profile.x * scale)).toBeLessThan(
                      (0.3 * checkTail + Math.exp(-2.1 * 8)) * scale,
                    );
                    expect(Math.abs(frame.bodyZ - direction * profile.z * scale)).toBeLessThan(
                      (0.14 * checkTail + Math.exp(-2.1 * 8)) * scale,
                    );
                  } else {
                    expect(frame.bodyX).toBeCloseTo(direction * profile.x * scale, 6);
                    expect(frame.bodyZ).toBeCloseTo(direction * profile.z * scale, 6);
                  }
                  expect(frame).toMatchObject({
                    active: true,
                    preset: profile.preset,
                    emotion: profile.emotion,
                    attitude: profile.attitude,
                    gesture: 'none',
                    variant,
                  });
                  expect(actor.reactionTiming(cue, at)).toMatchObject({
                    started: 0,
                    duration: reactionDuration(profile.preset),
                    lifetime: end,
                  });
                }
                frames.push(frame);
                start = at;
              }
              expect(frames.at(-1)!.active).toBe(false);
              expect(actor.reactionTiming(cue, end)).toBeUndefined();
              return frames;
            });
            for (const path of paths.slice(1))
              for (let i = 0; i < path.length; i++)
                for (const key of [...motionKeys, 'breath', 'offsetY', 'expressionWeight'] as const)
                  expect(path[i]![key]).toBeCloseTo(paths[0]![i]![key], 7);
          }
  });

  it('releases a guarded worried posture into the existing playful recovery', () => {
    const actor = new ActingController();
    actor.cue({ emotion: 'concerned', attitude: 'tease', gesture: 'none' }, 0);
    const worried = advance(actor, 700);
    const playful = advance(actor, 3000, 60, 700);
    expect(worried.lean).toBeLessThan(0);
    expect(worried.bodyX).toBeLessThan(0);
    expect(playful.lean).toBeGreaterThan(0.15);
    expect(playful.bodyX).toBeGreaterThan(0);
    expect(playful.lean).toBeGreaterThan(playful.approach! + 0.1);
    expect(playful).toMatchObject({ gesture: 'none', preset: 'tease' });
  });

  it('supports a playful wink with a physical approach and counterbalanced shoulders', () => {
    const actor = new ActingController();
    actor.cue({ emotion: 'neutral', attitude: 'tease', gesture: 'none' }, 0);
    const inviting = advance(actor, 1200);
    expect(inviting.headZ).toBeLessThan(0);
    expect(inviting.bodyZ).toBeGreaterThan(0);
    expect(inviting.lean).toBeGreaterThan(inviting.approach!);
    expect(inviting.gesture).toBe('none');
  });

  it.each([
    { emotion: 'confused', attitude: 'neutral' },
    { emotion: 'concerned', attitude: 'neutral' },
    { emotion: 'neutral', attitude: 'tease' },
    { emotion: 'concerned', attitude: 'tease' },
  ] as const)(
    'keeps $emotion/$attitude body phrasing bounded and consistent across frame rates',
    (profile) => {
      for (const intensity of ['quiet', 'normal', 'expressive'] as const)
        for (const reducedMotion of [false, true])
          for (const variant of [0, 1]) {
            const scale =
              { quiet: 0.35, normal: 0.65, expressive: 1 }[intensity] * (reducedMotion ? 0.18 : 1);
            const cue = {
              ...profile,
              requestId: 'phrase',
              messageId: 'm',
              segmentId: 1,
              gesture: 'none',
            } as const;
            const paths = [30, 60, 120].map((fps) => {
              const actor = new ActingController();
              actor.configure({ intensity, reducedMotion });
              if (variant) {
                actor.cue(cue, 0);
                actor.reset(0);
              }
              actor.cue(cue, 0);
              let from = 0;
              return [700, 1500, 2500, 3200, 4000, 8000, 16200, 18200].map((at) => {
                const frame = advance(actor, at, fps, from);
                from = at;
                expect(Math.abs(frame.bodyX)).toBeLessThanOrEqual(0.5 * scale + 1e-9);
                expect(Math.abs(frame.bodyZ)).toBeLessThanOrEqual(0.3 * scale + 1e-9);
                expect(Math.abs(frame.lean)).toBeLessThanOrEqual(scale + 1e-9);
                expect(frame.approach).toBeDefined();
                if (at >= reactionLifetime(frame.preset)) expect(frame.active).toBe(false);
                return frame;
              });
            });
            for (const path of paths.slice(1))
              for (let i = 0; i < path.length; i++) {
                for (const key of [...motionKeys, 'offsetY', 'breath', 'mouthOpen'] as const)
                  expect(path[i]![key]).toBeCloseTo(paths[0]![i]![key], 7);
                expect(path[i]!.approach!).toBeCloseTo(paths[0]![i]!.approach!, 7);
              }
          }
    },
  );

  it('preserves delayed head-following for explicit gestures and other emotional attitudes', () => {
    const gestures = ['wave', 'explain', 'thinking'] as const;
    const cues = [
      ...(['happy', 'angry', 'embarrassed'] as const).flatMap((emotion) =>
        gestures.map((gesture) => ({ emotion, gesture, attitude: 'neutral' as const })),
      ),
      ...gestures.map((gesture) => ({
        emotion: 'happy' as const,
        attitude: 'laugh' as const,
        gesture,
      })),
      ...([
        { emotion: 'concerned', attitude: 'laugh', gesture: 'none' },
        { emotion: 'sad', attitude: 'neutral', gesture: 'none' },
        { emotion: 'embarrassed', attitude: 'tease', gesture: 'none' },
        { emotion: 'confused', attitude: 'explain', gesture: 'none' },
        { emotion: 'angry', attitude: 'explain', gesture: 'none' },
      ] as const),
    ];
    for (const cue of cues) {
      const actor = new ActingController();
      actor.cue(cue, 0);
      let previous = actor.sample(0, 0);
      // At the actor's 120Hz integration lattice, each returned head input is
      // exactly the input that its delayed torso follower just consumed.
      for (let i = 1; i <= 960; i++) {
        const frame = actor.sample((i * 1000) / 120, 1 / 120);
        const bound = (value: number, limit: number): number =>
          Math.max(-limit, Math.min(limit, value));
        const follow = 1 - Math.exp(-2.1 / 120);
        expect(frame.bodyX).toBeCloseTo(
          previous.bodyX + (bound(frame.headX * 0.65, 0.5 * 0.65) - previous.bodyX) * follow,
          10,
        );
        expect(frame.bodyZ).toBeCloseTo(
          previous.bodyZ + (bound(frame.headZ * 0.7, 0.3 * 0.65) - previous.bodyZ) * follow,
          10,
        );
        previous = frame;
      }
    }
  });

  it('releases independent torso intent by every original deadline while allowing existing damping to finish', () => {
    for (const preset of ['happy', 'laugh', 'shy', 'angry'] as const)
      for (const mode of ['semantic', 'delivery', 'preview'] as const) {
        const actor = new ActingController();
        actor.setState('working', 0);
        if (mode === 'preview') actor.preview(preset, 0);
        else
          actor.cue(
            {
              emotion: preset === 'shy' ? 'embarrassed' : preset === 'laugh' ? 'happy' : preset,
              attitude: preset === 'laugh' ? 'laugh' : 'neutral',
              gesture: 'none',
              stage: mode,
            },
            0,
          );
        const end = reactionLifetime(preset, mode === 'semantic' ? 'semantic' : 'delivery');
        const held = advance(actor, end - 1500, 120),
          releasing = advance(actor, end - 300, 120, end - 1500),
          expired = advance(actor, end, 120, end - 300);
        expect(held.active).toBe(true);
        expect(releasing.active).toBe(true);
        expect(expired).toMatchObject({ active: false, preset: 'working', gesture: 'none' });
        // The deadline removes intent, not the established damped body pose.
        // Working has no idle weight shift, so subsequent inputs must consist
        // entirely of the original delayed head/torso coupling.
        expect(Math.abs(expired.bodyX) + Math.abs(expired.bodyZ)).toBeGreaterThan(0.001);
        let previous = expired;
        for (let i = 1; i <= 120; i++) {
          const frame = actor.sample(end + (i * 1000) / 120, 1 / 120);
          const follow = 1 - Math.exp(-2.1 / 120);
          expect(frame.bodyX).toBeCloseTo(
            previous.bodyX + (frame.headX * 0.65 - previous.bodyX) * follow,
            10,
          );
          expect(frame.bodyZ).toBeCloseTo(
            previous.bodyZ + (frame.headZ * 0.7 - previous.bodyZ) * follow,
            10,
          );
          previous = frame;
        }
      }
  });

  it('immediately clears independent torso poses on exact clear, reset, approval and error', () => {
    for (const emotion of ['happy', 'angry', 'embarrassed', 'confused', 'concerned'] as const)
      for (const boundary of ['clear', 'reset', 'blocked', 'error'] as const) {
        const actor = new ActingController();
        const cue = {
          requestId: 'torso-owner',
          messageId: 'm',
          segmentId: 1,
          emotion,
          gesture: 'none',
        } as const;
        actor.cue(cue, 0);
        const held = advance(actor, 8000);
        expect(Math.abs(held.bodyX)).toBeGreaterThan(0.05);
        expect(actor.clearCue({ ...cue, messageId: 'stale' })).toBe(false);
        expect(actor.sample(8000, 0)).toEqual(held);
        if (boundary === 'clear') expect(actor.clearCue(cue)).toBe(true);
        else if (boundary === 'reset') actor.reset(8000);
        else actor.setState(boundary, 8000);
        expect(actor.sample(8000, 0)).toMatchObject({
          active: false,
          bodyX: 0,
          bodyZ: 0,
          headX: 0,
          gesture: 'none',
        });
      }
  });

  it('keeps torso transitions continuous through delivery promotion and ignores repeated semantic cues', () => {
    for (const fps of [30, 60, 120]) {
      const actor = new ActingController();
      const delivery = {
        requestId: 'torso-promotion',
        messageId: 'm',
        segmentId: 1,
        emotion: 'angry',
        gesture: 'none',
        stage: 'delivery',
      } as const;
      actor.cue(delivery, 0);
      const before = advance(actor, 1000, fps);
      const semantic = { ...delivery, segmentId: 2, stage: 'semantic' } as const;
      expect(actor.cue(semantic, 1000)).toBe(true);
      expect(actor.sample(1000, 0)).toMatchObject({ bodyX: before.bodyX, bodyZ: before.bodyZ });
      expect(actor.reactionTiming(semantic, 1000)).toEqual({
        started: 1000,
        duration: reactionDuration('angry'),
        lifetime: reactionLifetime('angry'),
      });
      const held = advance(actor, 8000, fps, 1000);
      expect(held).toMatchObject({ variant: 1, active: true });
      // This promotion starts a new 7s-old reaction. Its one shoulder check
      // and the inherited opposite stance must decay within the same filter.
      const checkTail = Math.exp(-2.1 * (7 - 3.1));
      const inheritedTail = Math.exp(-2.1 * 7);
      expect(Math.abs(held.bodyX - 0.44 * 0.65)).toBeLessThan(
        (0.3 * checkTail + inheritedTail) * 0.65,
      );
      expect(Math.abs(held.bodyZ + 0.22 * 0.65)).toBeLessThan(
        (0.14 * checkTail + 0.6 * inheritedTail) * 0.65,
      );
      expect(actor.cue({ ...semantic, segmentId: 3 }, 8000)).toBe(false);
      expect(actor.sample(8000, 0)).toEqual(held);
      expect(advance(actor, 1000 + reactionLifetime('angry'), fps, 8000).active).toBe(false);
    }
  });

  it('limits an already visible torso roll immediately when intensity or reduced motion changes', () => {
    for (const [intensity, reducedMotion, scale] of [
      ['quiet', false, 0.35],
      ['normal', false, 0.65],
      ['expressive', true, 0.18],
      ['normal', true, 0.65 * 0.18],
      ['quiet', true, 0.35 * 0.18],
    ] as const) {
      const actor = new ActingController();
      actor.configure({ intensity: 'expressive', reducedMotion: false });
      actor.cue({ emotion: 'happy', attitude: 'laugh', gesture: 'none' }, 0);
      expect(advance(actor, 8000).bodyZ).toBeGreaterThan(0.25);
      actor.configure({ intensity, reducedMotion });
      expect(Math.abs(actor.sample(8000, 0).bodyZ)).toBeLessThanOrEqual(0.3 * scale + 1e-10);
      expect(Math.abs(advance(actor, 8100, 60, 8000).bodyZ)).toBeLessThanOrEqual(
        0.3 * scale + 1e-10,
      );
      actor.reset(8100);
      expect(actor.sample(8100, 0).bodyZ).toBe(0);
    }
  });

  it('exposes the existing gaze slot without restarting its clock or consuming a reaction', () => {
    const paths = [30, 60, 120].map((fps) => {
      const actor = new ActingController();
      expect(actor.gazeSlotId).toBe(0);
      advance(actor, 600, fps);
      expect(actor.gazeSlotId).toBe(0);
      advance(actor, 1400, fps, 600);
      const slot = actor.gazeSlotId;
      expect(actor.gazeSlotStartedAt).toBeCloseTo(700);
      const startedAt = actor.gazeSlotStartedAt;
      expect(actor.gazeSlotStartedAt).toBe(startedAt);
      expect(slot).toBeGreaterThan(0);
      expect(actor.gazeSlotId).toBe(slot);
      actor.cue({ emotion: 'happy', gesture: 'none' }, 1400);
      advance(actor, 10000, fps, 1400);
      expect(actor.sample(10000, 0).active).toBe(true);
      expect(actor.gazeSlotId).toBeGreaterThan(slot);
      const result = actor.gazeSlotId;
      actor.reset(10000);
      expect(actor.gazeSlotId).toBe(0);
      expect(actor.gazeSlotStartedAt).toBe(10000);
      return result;
    });
    expect(paths).toEqual([paths[0], paths[0], paths[0]]);
  });

  it('keeps idle posture slots continuous, deterministic through frame gaps and bounded by accessibility', () => {
    for (const [intensity, reducedMotion, scale] of [
      ['normal', false, 0.65],
      ['quiet', false, 0.35],
      ['normal', true, 0.65 * 0.18],
    ] as const) {
      const paths = [30, 60, 120].map((fps) => {
        const actor = new ActingController();
        actor.configure({ intensity, reducedMotion });
        let previous = actor.sample(0, 0),
          slots = 0,
          slot = 0;
        const frames: ActingFrame[] = [];
        for (let i = 1; i <= fps * 10; i++) {
          const frame = actor.sample((i * 1000) / fps, 1 / fps);
          const nextSlot = (actor as unknown as { gazeIndex: number }).gazeIndex;
          if (nextSlot !== slot) {
            slots++;
            expect(Math.abs(frame.headX - previous.headX)).toBeLessThan(4.5 / fps);
            expect(Math.abs(frame.bodyX - previous.bodyX)).toBeLessThan(2.1 / fps);
            slot = nextSlot;
          }
          expect(Math.abs(frame.headX)).toBeLessThanOrEqual(0.7 * scale + 1e-10);
          expect(Math.abs(frame.bodyX)).toBeLessThanOrEqual(0.5 * scale + 1e-10);
          if (i % fps === 0) frames.push(frame);
          previous = frame;
        }
        expect(slots).toBeGreaterThanOrEqual(3);
        return frames;
      });
      const gaps = new ActingController();
      gaps.configure({ intensity, reducedMotion });
      gaps.sample(0, 0);
      for (let time = 1000; time <= 10000; time += 1000) {
        const frame = gaps.sample(time, 1);
        for (const key of motionKeys)
          expect(frame[key]).toBeCloseTo(paths[0]![time / 1000 - 1]![key], 7);
      }
      for (const path of paths.slice(1))
        for (let i = 0; i < path.length; i++)
          for (const key of [...motionKeys, 'offsetY', 'breath'] as const)
            expect(path[i]![key]).toBeCloseTo(paths[0]![i]![key], 7);
      const normal = advance(new ActingController(), 10000);
      for (const key of motionKeys)
        expect(paths[0]![9]![key]).toBeCloseTo((normal[key] * scale) / 0.65, 7);
      const skipped = gaps.sample(60000, 1);
      expect(skipped).toMatchObject({ active: false, gesture: 'none', mouthOpen: 0 });
      expect((gaps as unknown as { gazeAt: number }).gazeAt).toBeGreaterThan(60000);
      expect(Math.abs(skipped.bodyX)).toBeLessThanOrEqual(0.5 * scale + 1e-10);
      gaps.setState('blocked', 60000);
      expect(gaps.sample(60000, 0)).toMatchObject({ headX: 0, bodyX: 0, gazeX: 0 });
    }
  });

  it('gives happy and laugh a finite listener glance followed by an angled reconnection', () => {
    for (const attitude of ['neutral', 'laugh'] as const)
      for (const variant of [0, 1]) {
        const cue = {
          requestId: 'listener',
          messageId: 'm',
          segmentId: 1,
          emotion: 'happy',
          attitude,
          gesture: 'none',
        } as const;
        const paths = [30, 60, 120].map((fps) => {
          const actor = new ActingController(),
            reduced = new ActingController();
          reduced.configure({ intensity: 'normal', reducedMotion: true });
          for (const a of [actor, reduced]) {
            if (variant) {
              a.cue(cue, 0);
              a.reset(0);
            }
            a.cue(cue, 0);
          }
          const direction = variant ? -1 : 1;
          const glance = advance(actor, 2800, fps),
            quiet = advance(reduced, 2800, fps);
          expect(glance.headX * direction).toBeLessThan(-0.25);
          expect(glance.gazeX * direction).toBeLessThan(-0.12);
          expect(glance).toMatchObject({ emotion: 'happy', attitude, gesture: 'none', variant });
          for (const key of motionKeys) expect(quiet[key]).toBeCloseTo(glance[key] * 0.18, 7);
          const bodySettled = advance(actor, 3200, fps, 2800);
          // Eyes/head can check the listener without undoing the emotional
          // torso posture: joy rests upright; laughter counterbalances it.
          if (attitude === 'laugh') expect(bodySettled.bodyX * direction).toBeLessThan(-0.14);
          else expect(bodySettled.bodyX * direction).toBeGreaterThan(0.05);
          const reconnected = advance(actor, 4500, fps, 3200);
          expect(reconnected.headX * direction).toBeGreaterThan(0.08);
          expect(reconnected.headX * direction - glance.headX * direction).toBeGreaterThan(0.4);
          expect(reconnected.smile).toBeGreaterThan(0.3);
          const preset = attitude === 'laugh' ? 'laugh' : 'happy';
          expect(advance(actor, reactionLifetime(preset), fps, 4500).active).toBe(false);
          actor.reset(reactionLifetime(preset));
          expect(actor.sample(reactionLifetime(preset), 0)).toMatchObject({ headX: 0, bodyX: 0 });
          return { glance, bodySettled, reconnected };
        });
        for (const path of paths.slice(1))
          for (const phase of ['glance', 'bodySettled', 'reconnected'] as const)
            for (const key of [...motionKeys, 'offsetY', 'breath'] as const)
              expect(path[phase][key]).toBeCloseTo(paths[0]![phase][key], 7);
        const cleared = new ActingController();
        cleared.cue(cue, 0);
        advance(cleared, 2800);
        expect(cleared.clearCue(cue)).toBe(true);
        expect(cleared.sample(2800, 0)).toMatchObject({
          active: false,
          headX: 0,
          bodyX: 0,
          gazeX: 0,
          mouthOpen: 0,
        });
      }
  });

  it('keeps calibrated angry lids readable at every intensity with reduced motion and an exact deadline', () => {
    for (const [intensity, scale] of [
      ['quiet', 0.35],
      ['normal', 0.65],
      ['expressive', 1],
    ] as const)
      for (const reducedMotion of [false, true]) {
        const cue = {
          requestId: 'stern',
          messageId: 'm',
          segmentId: 1,
          emotion: 'angry',
          gesture: 'none',
        } as const;
        const expected = 1 + (0.5 + (0.35 - 0.5) * scale - 1) * (reducedMotion ? 0.18 : 1);
        const frames = [30, 60, 120].map((fps) => {
          const actor = new ActingController();
          actor.configure({ intensity, reducedMotion });
          actor.cue(cue, 0);
          const accent = advance(actor, 600, fps);
          expect(accent.eyeL).toBeCloseTo(1 - 0.6 * (reducedMotion ? 0.18 : 1), 3);
          const held = advance(actor, 8000, fps, 600);
          expect(held.eyeL).toBeCloseTo(expected, 6);
          expect(held.eyeR).toBeCloseTo(expected, 6);
          expect(held.mouthOpen).toBe(0);
          expect(advance(actor, reactionLifetime('angry'), fps, 8000)).toMatchObject({
            active: false,
            eyeL: 1,
            eyeR: 1,
            mouthOpen: 0,
          });
          return held;
        });
        for (const frame of frames.slice(1))
          for (const key of [...motionKeys, 'eyeL', 'eyeR', 'mouthOpen'] as const)
            expect(frame[key]).toBeCloseTo(frames[0]![key], 7);
        const cleared = new ActingController();
        cleared.configure({ intensity, reducedMotion });
        cleared.cue(cue, 0);
        advance(cleared, 8000);
        cleared.clearCue(cue);
        expect(cleared.sample(8000, 0)).toMatchObject({ active: false, eyeL: 1, eyeR: 1 });
      }
  });

  it('checks the listener once with angry eyes while keeping the averted body and frown', () => {
    for (const [intensity, intensityScale] of [
      ['quiet', 0.35],
      ['normal', 0.65],
      ['expressive', 1],
    ] as const)
      for (const reducedMotion of [false, true])
        for (const variant of [0, 1]) {
          const cue = {
            requestId: 'reluctant-check',
            messageId: 'm',
            segmentId: 1,
            emotion: 'angry',
            gesture: 'none',
          } as const;
          const scale = intensityScale * (reducedMotion ? 0.18 : 1);
          const direction = variant ? -1 : 1;
          const paths = [30, 60, 120].map((fps) => {
            const actor = new ActingController();
            actor.configure({ intensity, reducedMotion });
            if (variant) {
              actor.cue(cue, 0);
              actor.reset(0);
            }
            actor.cue(cue, 0);
            const before = advance(actor, 1900, fps),
              checking = advance(actor, 2300, fps, 1900),
              returned = advance(actor, 3100, fps, 2300);
            for (const eye of ['eyeL', 'eyeR'] as const) {
              expect(checking[eye]).toBeGreaterThan(before[eye] + 0.2 * scale);
              expect(checking[eye]).toBeGreaterThan(returned[eye] + 0.2 * scale);
              expect(returned[eye]).toBeCloseTo(before[eye], 5);
            }
            // Eyes lead the check; shoulders loosen after them but stay on the
            // averted side, while the head and frown retain their intent.
            expect(checking.gazeX * direction).toBeGreaterThan(0.24 * scale);
            expect(checking.headX * direction).toBeLessThan(-0.2 * scale);
            expect(checking.bodyX * direction).toBeLessThan(-0.16 * scale);
            expect(checking.bodyX * direction).toBeGreaterThan(before.bodyX * direction);
            const resettled = advance(actor, 4500, fps, 3100);
            expect(resettled.bodyX * direction).toBeLessThan(checking.bodyX * direction);
            expect(checking.approach).toBeLessThanOrEqual(0);
            for (const frame of [before, checking, returned]) {
              expect(frame).toMatchObject({
                active: true,
                emotion: 'angry',
                gesture: 'none',
                mouthOpen: 0,
                variant,
              });
              expect(frame.browY).toBeLessThan(-0.35 * scale);
              expect(frame.pout).toBeGreaterThan(0.25 * scale);
              expect(frame.eyeSmile).toBe(0);
              expect(Math.abs(frame.headX)).toBeLessThanOrEqual(0.7 * scale);
              expect(Math.abs(frame.bodyX)).toBeLessThanOrEqual(0.5 * scale);
            }
            // After the finite check, the calibrated held face retains its
            // original bounded lifetime.
            const held = advance(actor, 8000, fps, 4500);
            expect(held.eyeL).toBeCloseTo(
              1 + (0.5 + (0.35 - 0.5) * intensityScale - 1) * (reducedMotion ? 0.18 : 1),
              6,
            );
            expect(advance(actor, reactionLifetime('angry'), fps, 8000)).toMatchObject({
              active: false,
              eyeL: 1,
              eyeR: 1,
              mouthOpen: 0,
            });
            return [before, checking, returned, held];
          });
          for (const path of paths.slice(1))
            for (let i = 0; i < path.length; i++)
              for (const key of [
                ...motionKeys,
                'eyeL',
                'eyeR',
                'browY',
                'pout',
                'breath',
                'offsetY',
              ] as const)
                expect(path[i]![key]).toBeCloseTo(paths[0]![i]![key], 7);
        }
  });

  it('keeps the angry eye check out of other attitudes and explicit gesture intent', () => {
    for (const attitude of ['tease', 'laugh', 'reassure', 'shy', 'explain'] as const) {
      const angry = new ActingController(),
        neutral = new ActingController();
      angry.cue({ emotion: 'angry', attitude, gesture: 'none' }, 0);
      neutral.cue({ emotion: 'neutral', attitude, gesture: 'none' }, 0);
      const emotional = advance(angry, 2300),
        control = advance(neutral, 2300);
      for (const key of ['gazeX', 'gazeY', 'eyeL', 'eyeR'] as const)
        expect(emotional[key]).toBe(control[key]);
    }
    for (const gesture of ['thinking', 'explain', 'wave'] as const) {
      const actor = new ActingController();
      actor.cue({ emotion: 'angry', gesture }, 0);
      const frame = advance(actor, 2300);
      expect(frame.eyeL).toBeCloseTo(0.5, 6);
      expect(frame.eyeR).toBeCloseTo(0.5, 6);
      expect(frame.gesture).toBe(gesture);
    }
  });

  it('preserves blinks and short preview/delivery deadlines during the angry eye check', () => {
    for (const fps of [30, 60, 120]) {
      const blinking = new ActingController();
      blinking.cue({ emotion: 'angry', gesture: 'none' }, 0);
      (blinking as unknown as { blinkAt: number }).blinkAt = 2235;
      const closed = advance(blinking, 2300, fps);
      expect(closed.eyeL).toBe(0);
      expect(closed.eyeR).toBe(0);
      expect(closed.gazeX).toBeGreaterThan(0.3);
      for (const mode of ['preview', 'delivery'] as const) {
        const actor = new ActingController();
        if (mode === 'preview') actor.preview('angry', 0);
        else actor.cue({ emotion: 'angry', gesture: 'none', stage: 'delivery' }, 0);
        const checking = advance(actor, 2300, fps);
        expect(checking.gazeX).toBeGreaterThan(0.3);
        expect(checking.eyeL).toBeGreaterThan(0.64);
        const returned = advance(actor, 3100, fps, 2300);
        expect(returned.eyeL).toBeCloseTo(0.5, 6);
        expect(advance(actor, reactionDuration('angry'), fps, 3100).active).toBe(false);
      }
    }
  });

  it('clears the early angry eye check on every existing reaction boundary', () => {
    const cue = {
      requestId: 'reluctant-check',
      messageId: 'm',
      segmentId: 1,
      emotion: 'angry',
      gesture: 'none',
    } as const;
    for (const fps of [30, 60, 120])
      for (const boundary of ['clear', 'reset', 'blocked', 'error', 'replace'] as const) {
        const actor = new ActingController();
        actor.cue(cue, 0);
        const checking = advance(actor, 2300, fps);
        expect(checking.gazeX).toBeGreaterThan(0.2);
        if (boundary === 'clear') expect(actor.clearCue(cue)).toBe(true);
        else if (boundary === 'reset') actor.reset(2300);
        else if (boundary === 'replace') {
          actor.cue(
            { ...cue, messageId: 'next', emotion: 'neutral', attitude: 'reassure', segmentId: 2 },
            2300,
          );
          // The previous local pose may blend into this new reaction, but its
          // independent checking glance must disappear immediately.
          expect(actor.sample(2300, 0).gazeX).toBeLessThan(checking.gazeX - 0.25);
          continue;
        } else actor.setState(boundary, 2300);
        expect(actor.sample(2300, 0)).toMatchObject({
          active: false,
          gazeX: 0,
          eyeL: 1,
          eyeR: 1,
          mouthOpen: 0,
        });
      }
  });

  it('releases angry lids continuously before semantic, delivery and preview deadlines at every frame rate', () => {
    for (const mode of ['semantic', 'delivery', 'preview'] as const)
      for (const intensity of ['quiet', 'normal', 'expressive'] as const)
        for (const reducedMotion of [false, true]) {
          const deadline =
            mode === 'semantic' ? reactionLifetime('angry') : reactionDuration('angry');
          const paths = [30, 60, 120].map((fps) => {
            const actor = new ActingController();
            actor.configure({ intensity, reducedMotion });
            if (mode === 'preview') actor.preview('angry', 0);
            else actor.cue({ emotion: 'angry', gesture: 'none', stage: mode }, 0);
            let clock = 0;
            const at = (time: number): ActingFrame => {
              let frame = actor.sample(clock, 0);
              while (clock + 1000 / fps < time - 1e-7) {
                clock += 1000 / fps;
                frame = actor.sample(clock, 1 / fps);
              }
              if (time > clock) frame = actor.sample(time, (time - clock) / 1000);
              clock = time;
              return frame;
            };
            const earlyTail = at(deadline - 600),
              near = at(deadline - 100),
              last = at(deadline - 1),
              end = at(deadline),
              after = at(deadline + 100);
            for (const key of ['eyeL', 'eyeR'] as const) {
              expect(near[key]).toBeGreaterThan(earlyTail[key]);
              expect(last[key]).toBeGreaterThan(near[key]);
              expect(last[key]).toBeGreaterThan(0.995);
              expect(Math.abs(end[key] - last[key])).toBeLessThan(0.002);
              expect(after[key]).toBeGreaterThanOrEqual(end[key]);
            }
            expect(end.active).toBe(false);
            expect(after.mouthOpen).toBe(0);
            return [earlyTail, near, last, end, after];
          });
          for (const path of paths.slice(1))
            for (let i = 0; i < path.length; i++)
              for (const key of ['eyeL', 'eyeR'] as const)
                expect(path[i]![key]).toBeCloseTo(paths[0]![i]![key], 5);
        }
  });

  it('bounds both new emotional sequences on the existing clock across variants, accessibility and frame rates', () => {
    for (const emotion of ['concerned', 'confused'] as const)
      for (const variant of [0, 1]) {
        const cue = {
          requestId: 'physical',
          messageId: 'm',
          segmentId: 1,
          emotion,
          attitude: emotion === 'concerned' ? 'tease' : 'neutral',
          gesture: 'none',
        } as const;
        const make = (intensity: 'quiet' | 'normal' = 'normal', reducedMotion = false) => {
          const actor = new ActingController();
          actor.configure({ intensity, reducedMotion });
          if (variant) {
            actor.cue(cue, 0);
            actor.reset(0);
          }
          actor.cue(cue, 0);
          return actor;
        };
        const paths = [30, 60, 120].map((fps) => {
          const actor = make(),
            reduced = make('normal', true),
            quiet = make('quiet'),
            idle = new ActingController();
          const path: ActingFrame[] = [];
          let start = 0;
          for (const time of [300, 800, 1500, 2300, 3000, 8000]) {
            const frame = advance(actor, time, fps, start),
              r = advance(reduced, time, fps, start),
              q = advance(quiet, time, fps, start),
              baseline = advance(idle, time, fps, start);
            for (const key of motionKeys) {
              expect(r[key]).toBeCloseTo(frame[key] * 0.18, 7);
              expect(q[key]).toBeCloseTo((frame[key] * 0.35) / 0.65, 7);
            }
            expect(frame.offsetY).toBe(baseline.offsetY);
            expect(frame.breath).toBe(baseline.breath);
            expect(frame).toMatchObject({ gesture: 'none', variant });
            if (emotion === 'confused') expect(frame.mouthOpen).toBe(0);
            if (emotion === 'concerned' && time === 800) {
              expect(frame.eyeL).toBeGreaterThan(0.6);
              expect(frame.eyeR).toBeGreaterThan(0.75);
              expect(r.smile).toBeCloseTo(frame.smile * 0.18, 7);
              expect(q.smile).toBeCloseTo((frame.smile * 0.35) / 0.65, 7);
            }
            path.push(frame);
            start = time;
          }
          const preset = emotion === 'concerned' ? 'tease' : 'confused';
          expect(advance(actor, reactionLifetime(preset), fps, start).active).toBe(false);
          return path;
        });
        for (const path of paths.slice(1))
          for (let i = 0; i < path.length; i++)
            for (const key of [...motionKeys, 'eyeL', 'eyeR', 'smile', 'browInner'] as const)
              expect(path[i]![key]).toBeCloseTo(paths[0]![i]![key], 7);
        for (const boundary of ['clear', 'blocked', 'error', 'reset'] as const) {
          const actor = make();
          advance(actor, 800);
          if (boundary === 'clear') actor.clearCue(cue);
          else if (boundary === 'reset') actor.reset(800);
          else actor.setState(boundary, 800);
          expect(actor.sample(800, 0).active).toBe(false);
          if (boundary === 'blocked' || boundary === 'reset')
            expect(actor.sample(800, 0)).toMatchObject({ headX: 0, bodyX: 0, lean: 0 });
        }
      }
  });

  it('updates accessibility settings while a semantic face is already held', () => {
    const actor = new ActingController(),
      reference = new ActingController();
    actor.cue({ emotion: 'happy', gesture: 'none' }, 0);
    reference.cue({ emotion: 'happy', gesture: 'none' }, 0);
    advance(actor, 6000);
    const before = advance(reference, 8000);
    actor.configure({ intensity: 'quiet', reducedMotion: true });
    const after = advance(actor, 8000, 60, 6000);
    const ratio = (0.35 * 0.18) / 0.65;
    for (const key of ['smile', 'eyeSmile', 'browY', 'mouthOpen', 'expressionWeight'] as const)
      expect(after[key]).toBeCloseTo(before[key] * ratio, 5);
  });

  it('ends held faces immediately on error, approval, reset and a newer neutral delivery', () => {
    for (const boundary of ['error', 'blocked', 'reset', 'next'] as const) {
      const actor = new ActingController();
      actor.cue({ emotion: 'happy', gesture: 'wave' }, 0);
      advance(actor, 6000);
      if (boundary === 'reset') actor.reset(6000);
      else if (boundary === 'next')
        actor.cue(
          {
            requestId: 'r',
            messageId: 'next',
            segmentId: 1,
            stage: 'delivery',
            emotion: 'neutral',
            gesture: 'none',
          },
          6000,
        );
      else actor.setState(boundary, 6000);
      if (boundary === 'next') {
        const next = advance(actor, 7000, 60, 6000);
        expect(next).toMatchObject({ preset: 'acknowledge', emotion: 'neutral' });
        expect(next.mouthOpen).toBeLessThan(0.001);
        expect(next.smile).toBeLessThan(0.001);
      } else
        expect(actor.sample(6000, 0)).toMatchObject({
          active: false,
          mouthOpen: 0,
          smile: 0,
          eyeSmile: 0,
          expressionWeight: 0,
        });
    }
  });

  it('varies successive semantic beats while rejecting duplicate segments and resetting to neutral', () => {
    const actor = new ActingController();
    const cue = {
      emotion: 'happy',
      gesture: 'none',
      requestId: 'reply',
      segmentId: 1,
      messageId: 'first',
    } as const;
    expect(actor.cue(cue, 0)).toBe(true);
    const first = advance(actor, 1000);
    expect(actor.cue({ ...cue, segmentId: 2, messageId: 'next' }, 1100)).toBe(true);
    const second = advance(actor, 2100, 60, 1100);
    expect(second.variant).not.toBe(first.variant);
    expect(second.eyeSmile).toBeGreaterThan(first.eyeSmile);
    expect(second.smile).toBeLessThan(first.smile);
    expect(actor.cue({ ...cue, segmentId: 2, messageId: 'next' }, 8000)).toBe(false);
    expect(
      actor.cue({ ...cue, emotion: 'neutral', segmentId: 3, messageId: 'neutral' }, 8000),
    ).toBe(true);
    expect(advance(actor, 9000, 60, 8000).preset).toBe('acknowledge');
    expect(actor.cue({ ...cue, requestId: 'new-reply' }, 9100)).toBe(true);
  });
  it('gives a neutral message a short visible delivery beat without inventing emotion or a hand gesture', () => {
    const actor = new ActingController(),
      idle = new ActingController();
    const cue = {
      emotion: 'neutral',
      gesture: 'none',
      attitude: 'neutral',
      requestId: 'r',
      messageId: 'progress',
      stage: 'delivery',
      segmentId: 1,
    } as const;
    actor.cue(cue, 0);
    const response = advance(actor, 500),
      baseline = advance(idle, 500);
    expect(response).toMatchObject({
      preset: 'acknowledge',
      active: true,
      emotion: 'neutral',
      gesture: 'none',
      smile: 0,
    });
    expect(response.headY).toBeLessThan(baseline.headY - 0.05);
    expect(response.headZ).toBeGreaterThan(baseline.headZ + 0.01);
    expect(response.offsetY).toBe(baseline.offsetY);
    expect(actor.cue(cue, 700)).toBe(false);
    expect(advance(actor, 2000, 60, 500)).toMatchObject({ preset: 'neutral', active: false });
    actor.cue({ ...cue, messageId: 'final', segmentId: 2 }, 2000);
    expect(advance(actor, 2500, 60, 2000).headZ).toBeLessThan(0);
    actor.setState('blocked', 2500);
    expect(actor.sample(2500, 0)).toMatchObject({ active: false, headY: 0, headZ: 0 });
    expect(actor.cue({ ...cue, segmentId: 3, messageId: 'late' }, 2600)).toBe(false);
  });
  it('keeps neutral delivery beats consistent across frame rates and scales them with reduced motion', () => {
    const frames = [30, 60, 120].map((fps) => {
      const actor = new ActingController();
      actor.cue(
        { emotion: 'neutral', gesture: 'none', requestId: 'r', messageId: 'm', segmentId: 1 },
        0,
      );
      return advance(actor, 500, fps);
    });
    expect(frames[0]!.headY).toBeCloseTo(frames[2]!.headY, 6);
    expect(frames[1]!.headY).toBeCloseTo(frames[2]!.headY, 6);
    const reduced = new ActingController();
    reduced.configure({ intensity: 'normal', reducedMotion: true });
    reduced.cue(
      { emotion: 'neutral', gesture: 'none', requestId: 'r', messageId: 'm', segmentId: 1 },
      0,
    );
    expect(advance(reduced, 500).headY).toBeCloseTo(frames[1]!.headY * 0.18, 6);
  });
  it('winks one eye, then releases both eyes without starting a repeated wink', () => {
    const actor = new ActingController();
    actor.preview('wink', 0);
    const wink = advance(actor, 700);
    expect(wink.eyeL).toBeLessThan(0.08);
    expect(wink.eyeR).toBeGreaterThan(0.98);
    expect(wink.phase).toBe('accent');
    expect(advance(actor, 1700, 60, 700).eyeL).toBeGreaterThan(0.98);
    expect(advance(actor, 2600, 60, 1700).active).toBe(false);
  });

  it('keeps facial emotion while composing a thinking gaze and head gesture', () => {
    const a = new ActingController(),
      b = new ActingController();
    a.cue({ emotion: 'happy', gesture: 'thinking' }, 0);
    b.cue({ emotion: 'happy', gesture: 'none' }, 0);
    const mixed = advance(a, 1300),
      happy = advance(b, 1300);
    expect(mixed.smile).toBeCloseTo(happy.smile);
    expect(mixed.eyeSmile).toBeCloseTo(happy.eyeSmile);
    expect(mixed.gazeX - happy.gazeX).toBeGreaterThan(0.12);
    expect(mixed.headZ).not.toBeCloseTo(happy.headZ, 2);
  });

  it('gives surprise a quick recoil and shorter release than a shy reaction', () => {
    const a = new ActingController(),
      b = new ActingController();
    a.preview('surprised', 0);
    b.preview('shy', 0);
    expect(advance(a, 350).lean).toBeLessThan(-0.12);
    expect(advance(a, 1800, 60, 350).phase).toBe('release');
    expect(advance(a, 2300, 60, 1800).active).toBe(false);
    expect(advance(b, 2300).active).toBe(true);
  });

  it('puffs cheeks and pouts without opening a speech mouth, reducing and clearing the reaction safely', () => {
    const actor = new ActingController(),
      reduced = new ActingController();
    reduced.configure({ intensity: 'normal', reducedMotion: true });
    actor.preview('pout', 0);
    reduced.preview('pout', 0);
    const face = advance(actor, 1300),
      quiet = advance(reduced, 1300);
    expect(face.cheek).toBeGreaterThan(0.4);
    expect(face.pout).toBeGreaterThan(0.35);
    expect(quiet.cheek).toBeCloseTo(face.cheek * 0.18);
    actor.setState('blocked', 1300);
    expect(actor.sample(1400, 0.1)).toMatchObject({
      eyeL: 1,
      eyeR: 1,
      cheek: 0,
      pout: 0,
      eyeSmile: 0,
      browInner: 0,
    });
  });

  it('makes nodding and shaking directional accents instead of repeated whole-window bobbing', () => {
    for (const [preset, key] of [
      ['nod', 'headY'],
      ['shake', 'headX'],
    ] as const) {
      const actor = new ActingController();
      actor.preview(preset, 0);
      const values: number[] = [];
      for (let i = 1; i <= 120; i++) values.push(actor.sample((i * 1000) / 60, 1 / 60)[key]);
      expect(Math.max(...values)).toBeGreaterThan(0.035);
      expect(Math.min(...values)).toBeLessThan(-0.035);
      expect(Math.abs(actor.sample(2000, 0).offsetY)).toBeLessThanOrEqual(0.002925);
    }
  });

  it('makes short head beats visible at normal intensity without increasing model translation', () => {
    for (const preset of ['acknowledge', 'nod', 'shake', 'reassure'] as const) {
      const actor = new ActingController(),
        idle = new ActingController();
      if (preset === 'acknowledge')
        actor.cue(
          { emotion: 'neutral', gesture: 'none', requestId: 'r', messageId: 'm', segmentId: 1 },
          0,
        );
      else if (preset === 'reassure')
        actor.cue({ emotion: 'neutral', gesture: 'none', attitude: 'reassure' }, 0);
      else actor.preview(preset, 0);
      const values: number[] = [];
      for (let i = 1; i <= 156; i++) {
        const time = (i * 1000) / 60;
        const frame = actor.sample(time, 1 / 60),
          baseline = idle.sample(time, 1 / 60);
        const axis = preset === 'shake' ? 'headX' : 'headY';
        // An independent idle side-turn is no longer a neutral reference for
        // a shake. Verify its actual left/right excursion; nods remain relative.
        values.push(preset === 'shake' ? frame[axis] : frame[axis] - baseline[axis]);
        expect(frame.offsetY).toBe(baseline.offsetY);
      }
      // At a +/-30 degree rig, a clear nod must travel at least 6 degrees
      // below neutral; explicit nod/shake must also return above neutral.
      expect(Math.min(...values)).toBeLessThan(preset === 'shake' ? -0.16 : -0.2);
      if (preset === 'nod' || preset === 'shake') expect(Math.max(...values)).toBeGreaterThan(0.25);
      actor.setState('blocked', 2600);
      expect(actor.sample(2600, 0)).toMatchObject({ headX: 0, headY: 0, active: false });
    }
  });

  it('alternates a restrained teasing variant without spending variants on local previews', () => {
    const actor = new ActingController();
    actor.preview('tease', 0);
    actor.reset(1000);
    const cue = { emotion: 'neutral', gesture: 'none', attitude: 'tease' } as const;
    actor.cue(cue, 1000);
    expect(advance(actor, 1700, 60, 1000).variant).toBe(0);
    actor.cue(cue, 7200);
    const next = advance(actor, 8150, 60, 7200);
    expect(next.variant).toBe(1);
    expect(next.eyeR).toBeLessThan(next.eyeL * 0.3);
  });

  it('keeps the new face accents deterministic at 30, 60 and 120 FPS', () => {
    for (const preset of ['wink', 'pout', 'laugh', 'surprised', 'nod', 'shake'] as const) {
      const frames = [30, 60, 120].map((fps) => {
        const actor = new ActingController();
        actor.preview(preset, 0);
        return advance(actor, 1100, fps);
      });
      for (const frame of frames.slice(1))
        for (const key of [
          'eyeL',
          'eyeR',
          'eyeSmile',
          'browY',
          'browInner',
          'cheek',
          'pout',
          ...motionKeys,
        ] as const)
          expect(frame[key]).toBeCloseTo(frames[0]![key], 7);
    }
  });

  it('uses the existing laugh performance for automatic cues, then releases and blocks it', () => {
    for (const fps of [30, 60, 120]) {
      const actor = new ActingController();
      const preview = new ActingController();
      const cue = {
        requestId: 'r',
        messageId: 'm',
        segmentId: 1,
        emotion: 'neutral',
        gesture: 'none',
        attitude: 'laugh',
      } as const;
      expect(actor.cue(cue, 0)).toBe(true);
      preview.preview('laugh', 0);
      const frame = advance(actor, 1100, fps);
      const reference = advance(preview, 1100, fps);
      expect(frame).toMatchObject({ preset: 'laugh', attitude: 'laugh', gesture: 'none' });
      for (const key of ['eyeL', 'eyeR', 'eyeSmile', 'smile', ...motionKeys] as const)
        expect(frame[key]).toBeCloseTo(reference[key], 7);
      expect(frame.eyeL).toBeLessThan(0.2);
      expect(frame.eyeR).toBeLessThan(0.2);
      expect(frame.smile).toBeGreaterThan(0.8);
      expect(actor.cue(cue, 1200)).toBe(false);
      expect(advance(actor, 4600, fps, 1100)).toMatchObject({
        preset: 'laugh',
        active: true,
        phase: 'afterglow',
      });
      expect(actor.cue({ ...cue, messageId: 'next', segmentId: 2 }, 4700)).toBe(true);
      actor.setState('blocked', 4800);
      expect(actor.sample(4800, 0)).toMatchObject({ preset: 'neutral', active: false, smile: 0 });
      expect(actor.cue({ ...cue, messageId: 'blocked', segmentId: 3 }, 4900)).toBe(false);
    }
  });

  it('keeps the same elapsed-time trajectory at 30, 60 and 120 FPS', () => {
    const frames = [30, 60, 120].map((fps) => {
      const actor = new ActingController();
      actor.setState('thinking', 0);
      actor.cue({ emotion: 'happy', gesture: 'explain' }, 0);
      return [advance(actor, 1700, fps), advance(actor, 6000, fps, 1700)];
    });
    for (const trajectory of frames.slice(1)) {
      for (let i = 0; i < trajectory.length; i++) {
        for (const key of [...motionKeys, 'offsetY', 'blink', 'breath', 'smile'] as const)
          expect(trajectory[i]![key]).toBeCloseTo(frames[0]![i]![key], 7);
      }
    }
  });

  it('breathes at idle with a shorter inhale, longer exhale and visible body rise', () => {
    const actor = new ActingController();
    const low = actor.sample(0, 0).breath;
    expect(low).toBeCloseTo(0.188);
    expect(actor.sample(0, 0).offsetY).toBeCloseTo(-0.002925);
    const inhaled = advance(actor, 2016);
    expect(inhaled.breath).toBeCloseTo(0.812);
    expect(inhaled.offsetY).toBeCloseTo(0.002925);
    // Even the largest 4x window should only move about four CSS pixels from center.
    expect((Math.abs(inhaled.offsetY) * 2720) / 2).toBeLessThanOrEqual(4);
    expect(advance(actor, 4800, 60, 2016).breath).toBeCloseTo(low);
    actor.preview('happy', 4800);
    const beforeReset = actor.sample(5000, 0).breath;
    actor.reset(5000);
    expect(actor.sample(5000, 0).breath).toBe(beforeReset);
    const peak = advance(actor, 7200, 60, 5000);
    expect(peak.bodyY).toBeGreaterThan(0.045);
    actor.configure({ intensity: 'normal', reducedMotion: true });
    expect(Math.abs(actor.sample(7200, 0).breath - 0.5)).toBeCloseTo(
      Math.abs(peak.breath - 0.5) * 0.18,
    );
    expect(actor.sample(7200, 0).offsetY).toBeCloseTo(peak.offsetY * 0.18);
    actor.setState('blocked', 7200);
    expect(actor.sample(7300, 0.1)).toMatchObject({ breath: 0.5, bodyY: 0, offsetY: 0 });
  });

  it('expires a cue with attack and release and returns to its ongoing state', () => {
    const actor = new ActingController();
    actor.setState('working', 0);
    actor.cue({ emotion: 'sad', gesture: 'none' }, 0);
    expect(actor.sample(0, 0).expressionWeight).toBe(0);
    const held = advance(actor, 1000);
    expect(held).toMatchObject({ preset: 'sad', active: true, expressionWeight: 1 });
    const releasing = advance(actor, 3800, 60, 1000);
    expect(releasing.expressionWeight).toBeGreaterThan(0);
    expect(releasing.expressionWeight).toBeLessThan(0.5);
    expect(advance(actor, 16200, 60, 3800)).toMatchObject({
      preset: 'working',
      active: false,
      expressionWeight: 0,
      emotion: 'neutral',
    });
    const resumed = advance(actor, 19000, 60, 16200);
    expect(resumed.gazeY).toBeLessThan(-0.1);
    expect(resumed.lean).toBeGreaterThan(0.08);
  });

  it('preserves message reactions through task changes and completion but resets at request/approval boundaries', () => {
    const actor = new ActingController();
    actor.setState('thinking', 0);
    actor.cue({ emotion: 'happy', gesture: 'wave' }, 0);
    advance(actor, 1000);
    actor.setState('idle', 1000);
    expect(actor.sample(1000, 0).preset).toBe('happy');
    actor.setState('working', 1000);
    expect(actor.sample(1000, 0).preset).toBe('happy');
    actor.reset(1000);
    actor.setState('thinking', 1000);
    expect(actor.sample(1000, 0)).toMatchObject({ preset: 'thinking', active: false });
    actor.preview('tease', 1000);
    advance(actor, 2000, 60, 1000);
    actor.setState('blocked', 2000);
    const blocked = actor.sample(2100, 0.1);
    expect(blocked).toMatchObject({ preset: 'neutral', active: false, blink: 1, smile: 0 });
    for (const key of motionKeys) expect(blocked[key]).toBe(0);
    expect(actor.cue({ emotion: 'happy', gesture: 'wave' }, 2200)).toBe(false);
    actor.preview('happy', 2200);
    expect(actor.sample(2300, 0.1).active).toBe(false);
    actor.reset(2300);
    expect(actor.sample(2300, 0)).toMatchObject({ preset: 'neutral', active: false, blink: 1 });
    expect(magnitude(actor.sample(2300, 0))).toBe(0);
  });

  it('gives a message the same pose over thinking/working transitions and resumes the latest task after release', () => {
    const actor = new ActingController(),
      reference = new ActingController();
    for (const a of [actor, reference]) {
      a.setState('thinking', 0);
      a.cue({ emotion: 'happy', gesture: 'explain' }, 0);
    }
    advance(actor, 1000);
    advance(reference, 1000);
    actor.setState('working', 1000);
    expect(advance(actor, 2000, 60, 1000)).toEqual(advance(reference, 2000, 60, 1000));
    actor.setState('thinking', 2000);
    expect(advance(actor, 4000, 60, 2000)).toEqual(advance(reference, 4000, 60, 2000));
    actor.setState('working', 4000);
    expect(advance(actor, 16200, 60, 4000)).toMatchObject({ preset: 'working', active: false });
    const resumed = advance(actor, 18500, 60, 16200);
    expect(resumed.gazeY).toBeLessThan(-0.1);
    expect(resumed.lean).toBeGreaterThan(0.08);
  });

  it('automatically ends thinking previews and lets reset stop a preview immediately', () => {
    const actor = new ActingController();
    actor.preview('thinking', 0);
    expect(advance(actor, 1000).preset).toBe('thinking');
    expect(advance(actor, 4200, 60, 1000)).toMatchObject({ preset: 'neutral', active: false });
    actor.preview('shy', 4200);
    advance(actor, 5000, 60, 4200);
    actor.preview('reset', 5000);
    expect(actor.sample(5000, 0)).toMatchObject({
      active: false,
      preset: 'neutral',
      emotion: 'neutral',
    });
    expect(magnitude(actor.sample(5000, 0))).toBe(0);
  });

  it('accepts neutral emotion plus attitude and gives attitude priority without losing emotion', () => {
    const actor = new ActingController();
    expect(actor.cue({ emotion: 'neutral', gesture: 'none', attitude: 'neutral' }, 0)).toBe(false);
    expect(actor.cue({ emotion: 'neutral', gesture: 'none', attitude: 'tease' }, 0)).toBe(true);
    const tease = advance(actor, 1300);
    expect(tease).toMatchObject({
      preset: 'tease',
      attitude: 'tease',
      emotion: 'neutral',
      active: true,
    });
    expect(tease.headZ).toBeLessThan(-0.15);
    expect(tease.smile).toBeGreaterThan(0.5);
    // Attitude changes are meaningful even when emotion and gesture stay the same.
    expect(actor.cue({ emotion: 'neutral', gesture: 'none', attitude: 'shy' }, 1300)).toBe(true);
    expect(advance(actor, 2500, 60, 1300).preset).toBe('shy');
    expect(actor.cue({ emotion: 'happy', gesture: 'wave', attitude: 'explain' }, 2500)).toBe(true);
    expect(advance(actor, 3700, 60, 2500)).toMatchObject({ preset: 'explain', emotion: 'happy' });
    expect(actor.cue({ emotion: 'concerned', gesture: 'none', attitude: 'reassure' }, 3700)).toBe(
      true,
    );
    const reassuring = advance(actor, 5000, 60, 3700);
    expect(reassuring).toMatchObject({ preset: 'reassure', emotion: 'concerned' });
    expect(reassuring.smile).toBeGreaterThan(0.25);
    expect(reassuring.smile).toBeLessThan(0.5);
  });

  it('does not extend a reaction or repeatedly restart high energy for repeated chunks', () => {
    const actor = new ActingController();
    const cue = { emotion: 'happy', gesture: 'wave' } as const;
    expect(actor.cue(cue, 0)).toBe(true);
    for (let now = 100; now <= 4100; now += 100) {
      expect(actor.cue(cue, now)).toBe(false);
      actor.sample(now, 0.1);
    }
    expect(actor.sample(4200, 0.1)).toMatchObject({ active: true, phase: 'afterglow' });
    expect(actor.cue(cue, 5000)).toBe(false);
    expect(actor.cue(cue, 6200)).toBe(true);
    expect(actor.cue({ emotion: 'surprised', gesture: 'none' }, 6300)).toBe(false);
    expect(actor.cue({ emotion: 'surprised', gesture: 'none' }, 7100)).toBe(true);
  });

  it('moves eyes before head and body, and gives distinct expressive poses', () => {
    const actor = new ActingController();
    actor.setState('thinking', 0);
    const early = advance(actor, 100);
    expect(early.gazeX).toBeGreaterThan(early.headX * 2);
    expect(early.headX).toBeGreaterThan(early.bodyX * 4);
    const poses = new Map<ActingPreset, ActingFrame>();
    for (const emotion of ['happy', 'sad', 'concerned', 'surprised', 'embarrassed'] as const) {
      const actor = new ActingController();
      actor.cue({ emotion, gesture: 'none' }, 0);
      const frame = advance(actor, 1300);
      poses.set(frame.preset, frame);
    }
    expect(poses.get('happy')!.smile).toBeGreaterThan(0.7);
    expect(poses.get('sad')!.headY).toBeLessThan(-0.15);
    expect(poses.get('concerned')!.headZ).toBeGreaterThan(0.1);
    expect(poses.get('surprised')!.lean).toBeLessThan(-0.15);
    expect(poses.get('shy')!.gazeX).toBeLessThan(-0.2);
    actor.preview('explain', 100);
    expect(advance(actor, 1500, 60, 100).lean).toBeGreaterThan(0.1);
    actor.preview('tease', 1500);
    expect(advance(actor, 2800, 60, 1500).headZ).toBeLessThan(-0.15);
  });

  it('uses deterministic irregular gaze and blink schedules rather than fixed cycles', () => {
    const actor = new ActingController();
    const twin = new ActingController();
    const starts: number[] = [];
    let previousBlink = 1;
    for (let i = 0; i <= 2400; i++) {
      const now = (i * 1000) / 120;
      const frame = actor.sample(now, i ? 1 / 120 : 0);
      expect(frame).toEqual(twin.sample(now, i ? 1 / 120 : 0));
      if (frame.blink < 0.99 && previousBlink >= 0.99) starts.push(now);
      previousBlink = frame.blink;
    }
    expect(starts.length).toBeGreaterThanOrEqual(3);
    expect(Math.abs(starts[2]! - starts[1]! - (starts[1]! - starts[0]!))).toBeGreaterThan(50);
  });

  it('bounds finite poses and limits movement with intensity and reduced motion', () => {
    const peaks: number[] = [];
    for (const [intensity, reducedMotion] of [
      ['expressive', false],
      ['normal', false],
      ['quiet', false],
      ['normal', true],
    ] as const) {
      const actor = new ActingController();
      actor.configure({ intensity, reducedMotion });
      actor.preview('tease', 0);
      let peak = 0;
      for (let i = 0; i <= 1200; i++) {
        const frame = actor.sample((i * 1000) / 120, i ? 1 / 120 : 0);
        peak = Math.max(peak, magnitude(frame));
        for (const key of motionKeys) {
          expect(Number.isFinite(frame[key])).toBe(true);
          expect(Math.abs(frame[key])).toBeLessThanOrEqual(1);
        }
        for (const key of ['blink', 'breath', 'smile', 'expressionWeight'] as const) {
          expect(frame[key]).toBeGreaterThanOrEqual(0);
          expect(frame[key]).toBeLessThanOrEqual(1);
        }
      }
      for (const key of motionKeys)
        expect(Number.isFinite(actor.sample(NaN, Infinity)[key])).toBe(true);
      peaks.push(peak);
    }
    expect(peaks[1]!).toBeCloseTo(peaks[0]! * 0.65, 7);
    expect(peaks[2]!).toBeCloseTo(peaks[0]! * 0.35, 7);
    expect(peaks[3]!).toBeCloseTo(peaks[1]! * 0.18, 7);
  });
});
