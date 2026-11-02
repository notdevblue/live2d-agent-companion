import type { ParameterRange, PoseFrame } from './performance.js';

/** The verified open-palm point at 0.5s of the local paired entry clip.
 * Its final endpoint is a hand-to-chest pose, so it is unsuitable for greeting hold.
 * These are upstream animation inputs, not the LArm/LWrist physics outputs. */
const raised = new Map([
  ['Param62', 0.02451229],
  ['Param59', 0.34098039],
  ['Param60', 0.52561809],
  ['Param61', 0.11307809],
]);
const amplitudes = new Map([
  ['Param62', 0.09],
  ['Param60', 0.06],
  ['Param61', 0.2],
]);
const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));
const smooth = (value: number): number => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};

/** Correct only the verified local greeting mapping. Custom clips remain entirely authored.
 * Apply after motion evaluation and before physics. The original first 500ms and the
 * authored return after its first 300ms remain owned by the paired clips. */
export function greetingValues(
  pose: PoseFrame,
  parameters: ReadonlyMap<string, ParameterRange>,
  physicsOutputs: ReadonlySet<string>,
  current: (index: number) => number,
  intensity = 1,
): Map<number, number> {
  const values = new Map<number, number>();
  const definition = pose.definition;
  const time = pose.timeMs;
  if (
    !definition ||
    definition.enter !== '默认手切举手' ||
    definition.exit !== '举手切默认手' ||
    definition.parameter !== 'Movement2' ||
    !Number.isFinite(definition.enterMs) ||
    !Number.isFinite(definition.exitMs) ||
    definition.enterMs < 500 ||
    definition.exitMs < 550 ||
    !Number.isFinite(time) ||
    time! < 0 ||
    pose.phase === 'none' ||
    (pose.phase === 'enter' && time! < 500) ||
    (pose.phase === 'exit' && time! >= 300)
  )
    return values;
  for (const id of ['Movement2', ...raised.keys()]) {
    const range = parameters.get(id);
    const target = id === 'Movement2' ? 1 : raised.get(id)!;
    if (
      !range ||
      physicsOutputs.has(id) ||
      ![range.min, range.max, range.neutral].every(Number.isFinite) ||
      target < range.min ||
      target > range.max
    )
      return values;
  }
  const scale = Number.isFinite(intensity) ? clamp(intensity) : 0;
  const age = pose.phase === 'hold' ? definition.enterMs + time! : time!;
  const elapsed = Math.max(0, age - 500);
  // Three complete sweeps, with quiet endpoints; no repeated full entry clip.
  const sweep =
    elapsed < 2100
      ? Math.sin((elapsed / 700) * Math.PI * 2) *
        smooth(elapsed / 180) *
        smooth((2100 - elapsed) / 300) *
        scale
      : 0;
  const returning = pose.phase === 'exit' ? smooth(time! / 300) : 0;
  for (const [id, held] of raised) {
    const range = parameters.get(id)!;
    const target =
      pose.phase === 'exit' ? current(range.index) : held + (amplitudes.get(id) ?? 0) * sweep;
    if (!Number.isFinite(target)) return new Map();
    values.set(
      range.index,
      clamp(
        pose.phase === 'exit' ? held + (target - held) * returning : target,
        range.min,
        range.max,
      ),
    );
  }
  return values;
}

/** Relax the verified raised hand after its accent, then briefly lift twice.
 * Apply after greetingValues against the frame's authored baseline, before physics.
 * One proven arm input changes; selectors, seams, wrist and fingers stay authored. */
export function handAttentionValues(
  pose: PoseFrame,
  parameters: ReadonlyMap<string, ParameterRange>,
  physicsOutputs: ReadonlySet<string>,
  current: (index: number) => number,
  intensity = 1,
): Map<number, number> {
  const definition = pose.definition;
  if (
    (pose.phase !== 'hold' && pose.phase !== 'exit') ||
    !definition ||
    !Number.isFinite(pose.timeMs) ||
    pose.timeMs! < 0 ||
    !Number.isFinite(definition.enterMs) ||
    definition.enterMs < 500 ||
    definition.enterMs > 2500 ||
    !Number.isFinite(definition.exitMs) ||
    definition.exitMs < 300
  )
    return new Map();
  const greeting =
    definition.enter === '默认手切举手' &&
    definition.exit === '举手切默认手' &&
    definition.parameter === 'Movement2';
  const explaining =
    definition.enter === '竖手指切出来动画' &&
    definition.exit === '竖手指切回默认' &&
    definition.parameter === 'Movement3';
  if (!greeting && !explaining) return new Map();
  const required = greeting
    ? ['Movement2', 'Param62', 'Param59', 'Param60', 'Param61']
    : ['Movement3', 'Param36', 'Param41', 'Param42'];
  for (const id of required) {
    const range = parameters.get(id);
    if (
      !range ||
      physicsOutputs.has(id) ||
      ![range.min, range.max].every(Number.isFinite) ||
      range.min > range.max
    )
      return new Map();
  }
  const scale = Number.isFinite(intensity) ? clamp(intensity) : 0;
  const age = definition.enterMs + pose.timeMs!;
  const relax =
    pose.phase === 'hold' ? smooth((age - 2500) / 1000) : 1 - smooth(pose.timeMs! / 300);
  const beat = (start: number): number =>
    pose.phase === 'hold' ? smooth((age - start) / 400) * smooth((start + 1650 - age) / 600) : 0;
  const offset =
    ((greeting ? -0.2 : -0.12) * relax +
      (greeting ? 0.1 : 0.075) * beat(5100) +
      (greeting ? 0.085 : 0.06) * beat(9600)) *
    scale;
  if (Math.abs(offset) < 1e-8) return new Map();
  const range = parameters.get(greeting ? 'Param62' : 'Param41')!;
  const base = current(range.index);
  if (!Number.isFinite(base)) return new Map();
  return new Map([[range.index, clamp(base + offset, range.min, range.max)]]);
}
