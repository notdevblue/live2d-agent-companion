import { describe, expect, it } from 'vitest';
import { ActingController, type ActingFrame, type ActingPreset } from '../src/renderer/acting.js';
import { ATTITUDES, EMOTIONS, GESTURES } from '../src/shared/contracts.js';

const motionKeys = ['headX', 'headY', 'headZ', 'bodyX', 'bodyY', 'lean', 'gazeX', 'gazeY'] as const;
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
    expect(advance(actor, 5500, 30, 1100)).toMatchObject({ active: false, preset: 'neutral' });
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
        values.push(frame[axis] - baseline[axis]);
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
    const next = advance(actor, 7900, 60, 7200);
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
      expect(advance(actor, 4600, fps, 1100)).toMatchObject({ preset: 'neutral', active: false });
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
    expect(advance(actor, 4200, 60, 3800)).toMatchObject({
      preset: 'working',
      active: false,
      expressionWeight: 0,
      emotion: 'neutral',
    });
    const resumed = advance(actor, 7000, 60, 4200);
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
    expect(advance(actor, 4200, 60, 4000)).toMatchObject({ preset: 'working', active: false });
    const resumed = advance(actor, 6500, 60, 4200);
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
    expect(actor.sample(4200, 0.1).active).toBe(false);
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
