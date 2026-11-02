import type { OverlayInputRegion } from '../shared/contracts.js';
import type { ActingFrame } from './acting.js';

const smooth = (value: number): number => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};
export interface PettingBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A local upper-silhouette zone, not anatomical recognition or a screen capture. */
export function pettingBounds(region: OverlayInputRegion): PettingBounds | undefined {
  if (!region.rects.length) return undefined;
  const left = Math.min(...region.rects.map((r) => r.x));
  const top = Math.min(...region.rects.map((r) => r.y));
  const right = Math.max(...region.rects.map((r) => r.x + r.width));
  const bottom = Math.max(...region.rects.map((r) => r.y + r.height));
  return { x: left, y: top, width: right - left, height: (bottom - top) * 0.4 };
}

/** Local direct-input overlay. Never changes window position or the underlying cue clock. */
export function applyPetting(
  frame: ActingFrame,
  weight: number,
  focus: { x: number; y: number } = { x: 0, y: 0 },
): ActingFrame {
  const amount = Number.isFinite(weight) ? Math.max(0, Math.min(1, weight)) : 0;
  if (amount === 0) return frame;
  const x = Number.isFinite(focus.x) ? Math.max(-1, Math.min(1, focus.x)) : 0;
  const y = Number.isFinite(focus.y) ? Math.max(-1, Math.min(1, focus.y)) : 0;
  const bounded = (value: number): number => Math.max(-1, Math.min(1, value));
  // Direct contact owns its intent while active; attenuate the independent
  // idle/cue direction instead of adding a competing displacement to it.
  const toward = (base: number, target: number): number => bounded(base + (target - base) * amount);
  return {
    ...frame,
    smile: toward(frame.smile, Math.max(frame.smile, 0.85)),
    eyeSmile: toward(frame.eyeSmile, Math.max(frame.eyeSmile, 0.9)),
    eyeL: frame.eyeL * Math.max(0.08, 1 - amount * 1.25),
    eyeR: frame.eyeR * Math.max(0.08, 1 - amount * 1.25),
    headZ: Math.min(1, frame.headZ + 0.35 * amount),
    headX: toward(frame.headX, x * 0.9),
    headY: toward(frame.headY, y * 0.22),
    bodyX: toward(frame.bodyX, x * 0.3),
    gazeX: toward(frame.gazeX, x * 0.95),
    gazeY: toward(frame.gazeY, y * 0.45 - 0.25),
  };
}

/** Direct, bounded strokes. No provider calls, pointer polling or global input. */
export class PettingController {
  private held = false;
  private travel = 0;
  private began = 0;
  private started?: number;
  private until = 0;
  private release?: { at: number; until: number; weight: number };

  begin(now: number): void {
    this.clear();
    this.held = true;
    this.began = now;
  }
  stroke(distance: number, now: number): boolean {
    if (
      !this.held ||
      !Number.isFinite(distance) ||
      distance < 0 ||
      distance > 80 ||
      now - this.began >= 12000
    )
      return false;
    this.travel += distance;
    if (this.travel < 8) return true;
    this.started ??= now;
    this.until = Math.min(this.began + 12000, now + 900);
    return true;
  }
  end(now: number): void {
    if (!this.held) return;
    const weight = this.sample(now);
    this.held = false;
    this.release = { at: now, until: Math.min(this.began + 12000, now + 1050), weight };
  }
  clear(): void {
    this.held = false;
    this.travel = 0;
    this.started = undefined;
    this.until = 0;
    this.release = undefined;
  }
  sample(now: number): number {
    if (this.started === undefined) return 0;
    if (this.release) {
      const { at, until, weight } = this.release;
      // Reserve the fade first when the original twelve-second cap truncates
      // release. Keeping almost the whole short budget as hold caused a 1ms snap.
      const hold = Math.min(300, Math.max(0, until - at - 750));
      return until > at ? weight * (1 - smooth((now - at - hold) / (until - at - hold))) : 0;
    }
    return smooth((now - this.started) / 180) * smooth((this.until - now) / 650);
  }
}
