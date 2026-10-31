import { settingsSchema } from './validation.js';

interface Point {
  x: number;
  y: number;
}
interface Bounds extends Point {
  width: number;
  height: number;
}

export class OverlayInputState {
  private hit = true;
  dragging = false;

  acceptHit(hit: boolean): void {
    if (!this.dragging) this.hit = hit;
  }

  setDragging(active: boolean): void {
    this.dragging = active;
    this.hit = active;
  }

  resize(
    scale: number,
    deltaY: number,
    cursor: Point,
    bounds: Bounds,
  ): { scale: number; bounds: Bounds } | undefined {
    if (!this.dragging) return undefined;
    const limit = settingsSchema.in.shape.scale;
    const next = limit.parse(
      Math.max(limit.minValue!, Math.min(limit.maxValue!, scale * Math.exp(-deltaY * 0.001))),
    );
    const width = Math.round(440 * next);
    const height = Math.round(680 * next);
    // Preserve the grabbed point, including when the user intentionally crops
    // the character at a monitor edge. Display edges are not movement limits.
    const anchorX = Math.max(0, Math.min(1, (cursor.x - bounds.x) / bounds.width));
    const anchorY = Math.max(0, Math.min(1, (cursor.y - bounds.y) / bounds.height));
    return {
      scale: next,
      bounds: {
        width,
        height,
        x: Math.round(bounds.x + anchorX * (bounds.width - width)),
        y: Math.round(bounds.y + anchorY * (bounds.height - height)),
      },
    };
  }

  shouldIgnore(enabled: boolean): boolean {
    return enabled && !this.dragging && !this.hit;
  }
}
