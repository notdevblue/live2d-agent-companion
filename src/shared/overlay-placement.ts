interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function intersectsDisplay(bounds: Bounds, displays: Bounds[]): boolean {
  return displays.some(
    (area) =>
      bounds.x < area.x + area.width &&
      bounds.x + bounds.width > area.x &&
      bounds.y < area.y + area.height &&
      bounds.y + bounds.height > area.y,
  );
}

// Preserve intentional cropping when selecting a different monitor. Within an
// edge, preserve relative placement; beyond an edge, preserve the cropped amount.
export function transferOverlay(bounds: Bounds, source: Bounds, target: Bounds): Bounds {
  const axis = (
    position: number,
    size: number,
    from: number,
    extent: number,
    to: number,
    next: number,
  ): number => {
    if (position < from) return to + position - from;
    const overflow = position + size - from - extent;
    if (overflow > 0) return to + next - size + overflow;
    return (
      to + (extent > size ? (position - from) / (extent - size) : 0.5) * Math.max(0, next - size)
    );
  };
  const moved = {
    ...bounds,
    x: Math.round(axis(bounds.x, bounds.width, source.x, source.width, target.x, target.width)),
    y: Math.round(axis(bounds.y, bounds.height, source.y, source.height, target.y, target.height)),
  };
  // A much smaller target can otherwise hide the whole window.
  if (!intersectsDisplay(moved, [target])) return defaultOverlayPosition(bounds, target);
  return moved;
}

export function defaultOverlayPosition(
  size: Pick<Bounds, 'width' | 'height'>,
  area: Bounds,
): Bounds {
  return {
    ...size,
    x: area.x + Math.max(0, area.width - size.width - 24),
    y: area.y + Math.max(0, area.height - size.height),
  };
}
