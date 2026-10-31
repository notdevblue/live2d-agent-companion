import type { OverlayInputRegion } from './contracts.js';

export const MAX_INPUT_RECTS = 4096;
const MAX_DIMENSION = 8192;

export function parseInputRegion(value: unknown): OverlayInputRegion | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const region = value as OverlayInputRegion;
  const dimension = (n: unknown): n is number =>
    Number.isInteger(n) && (n as number) > 0 && (n as number) <= MAX_DIMENSION;
  if (
    !dimension(region.width) ||
    !dimension(region.height) ||
    !Array.isArray(region.rects) ||
    region.rects.length > MAX_INPUT_RECTS
  )
    return undefined;
  for (const rect of region.rects) {
    if (
      !rect ||
      typeof rect !== 'object' ||
      !Number.isInteger(rect.x) ||
      !Number.isInteger(rect.y) ||
      rect.x < 0 ||
      rect.y < 0 ||
      !dimension(rect.width) ||
      !dimension(rect.height) ||
      rect.x + rect.width > region.width ||
      rect.y + rect.height > region.height
    )
      return undefined;
  }
  return {
    width: region.width,
    height: region.height,
    rects: region.rects.map(({ x, y, width, height }) => ({ x, y, width, height })),
  };
}

// RGBA comes only from our own just-rendered WebGL canvas (bottom row first).
// Any nonzero alpha marks a conservative CSS tile; halos improve hit reliability
// between the ten-Hz snapshots without ever clipping the rendered character.
export function alphaInputRegion(
  rgba: Uint8Array,
  pixelWidth: number,
  pixelHeight: number,
  width: number,
  height: number,
  tile = 8,
  halo = 6,
): OverlayInputRegion {
  const cols = Math.ceil(width / tile),
    rows = Math.ceil(height / tile);
  const occupied = new Uint8Array(cols * rows);
  for (let py = 0; py < pixelHeight; py++) {
    const row = Math.min(
      rows - 1,
      Math.floor(((pixelHeight - 1 - py) * height) / pixelHeight / tile),
    );
    for (let px = 0; px < pixelWidth; px++) {
      if (rgba[(py * pixelWidth + px) * 4 + 3]) {
        const col = Math.min(cols - 1, Math.floor((px * width) / pixelWidth / tile));
        occupied[row * cols + col] = 1;
      }
    }
  }
  const rects: OverlayInputRegion['rects'] = [];
  let previous = new Map<string, number>();
  for (let row = 0; row < rows; row++) {
    const next = new Map<string, number>();
    for (let col = 0; col < cols; col++) {
      if (!occupied[row * cols + col]) continue;
      const left = col;
      while (col + 1 < cols && occupied[row * cols + col + 1]) col++;
      const right = col + 1;
      const key = `${left}:${right}`;
      const existing = previous.get(key);
      if (existing !== undefined)
        rects[existing]!.height = Math.min(height, (row + 1) * tile) - rects[existing]!.y;
      else {
        rects.push({
          x: left * tile,
          y: row * tile,
          width: Math.min(width, right * tile) - left * tile,
          height: Math.min(tile, height - row * tile),
        });
      }
      next.set(key, existing ?? rects.length - 1);
    }
    previous = next;
  }
  // A pathological checkerboard must not create an unbounded IPC/native packet.
  // A full input rectangle is a safe, interactive fallback for that frame.
  if (rects.length > MAX_INPUT_RECTS)
    return { width, height, rects: [{ x: 0, y: 0, width, height }] };
  return {
    width,
    height,
    rects: rects.map((rect) => {
      const x = Math.max(0, rect.x - halo),
        y = Math.max(0, rect.y - halo);
      return {
        x,
        y,
        width: Math.min(width, rect.x + rect.width + halo) - x,
        height: Math.min(height, rect.y + rect.height + halo) - y,
      };
    }),
  };
}
