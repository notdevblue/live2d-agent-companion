import type { OverlayInputRegion } from '../shared/contracts.js';

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
  stroke(distance: number, now: number): void {
    if (
      !this.held ||
      !Number.isFinite(distance) ||
      distance < 0 ||
      distance > 80 ||
      now - this.began >= 12000
    )
      return;
    this.travel += distance;
    if (this.travel < 8) return;
    this.started ??= now;
    this.until = Math.min(this.began + 12000, now + 900);
  }
  end(now: number): void {
    const weight = this.sample(now);
    this.held = false;
    this.release = { at: now, until: Math.min(this.until, now + 450), weight };
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
      return until > at ? weight * smooth((until - now) / (until - at)) : 0;
    }
    return smooth((now - this.started) / 180) * smooth((this.until - now) / 650);
  }
}
