// Cubism Framework 5-r.5 packs 36 groups into one texture, or 32 per
// texture when multiple buffers are used (cubismclippingmanager.ts).
export function maskBufferCountForGroups(groups: number): number {
  return groups <= 36 ? 1 : Math.ceil(groups / 32);
}

export function canGenerateMipmaps(width: number, height: number): boolean {
  const powerOfTwo = (value: number): boolean => value > 0 && (value & (value - 1)) === 0;
  return powerOfTwo(width) && powerOfTwo(height);
}
