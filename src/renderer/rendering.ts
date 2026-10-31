// Cubism Framework 5-r.5 packs 36 groups into one texture, or 32 per
// texture when multiple buffers are used (cubismclippingmanager.ts).
export function maskBufferCountForGroups(groups: number): number {
  return groups <= 36 ? 1 : Math.ceil(groups / 32);
}

export function canGenerateMipmaps(width: number, height: number): boolean {
  const powerOfTwo = (value: number): boolean => value > 0 && (value & (value - 1)) === 0;
  return powerOfTwo(width) && powerOfTwo(height);
}

// Keep larger overlays within the same framebuffer/readback budget at high DPI.
export function canvasDimensions(
  width: number,
  height: number,
  devicePixelRatio: number,
  gpuLimit = 8192,
): { width: number; height: number } {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const limit = Math.max(1, Math.min(8192, Number.isFinite(gpuLimit) ? gpuLimit : 8192));
  const ratio = Math.min(
    Number.isFinite(devicePixelRatio) ? Math.max(1, devicePixelRatio) : 1,
    2,
    limit / w,
    limit / h,
    Math.sqrt(16_777_216 / (w * h)),
  );
  return { width: Math.max(1, Math.floor(w * ratio)), height: Math.max(1, Math.floor(h * ratio)) };
}
