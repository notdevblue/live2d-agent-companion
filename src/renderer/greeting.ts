import { chestArmReturn, type ParameterRange, type PoseFrame } from './performance.js';

/** A folded elbow keeps the verified open palm beside the face. Only the four
 * upstream arm inputs change; the paired clip retains selectors and lights. */
const raised = new Map([
  ['Param62', -0.55],
  ['Param59', 0.34098039],
  ['Param60', 0.72],
  ['Param61', 0.11307809],
]);
const amplitudes = new Map([
  ['Param62', 0.025],
  ['Param60', 0.015],
  ['Param61', 0.14],
]);
const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));
const smooth = (value: number): number => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};

function attentionOffset(age: number, greeting: boolean, scale: number): number {
  const relax = smooth((age - 2500) / 1000);
  const beat = (start: number): number =>
    smooth((age - start) / 400) * smooth((start + 1650 - age) / 600);
  const point = smooth((age - 2250) / 180) * smooth((2900 - age) / 300);
  return (
    ((greeting ? -0.2 : -0.12) * relax +
      (greeting ? 0 : 0.1) * point +
      (greeting ? 0.1 : 0.075) * beat(5100) +
      (greeting ? 0.085 : 0.06) * beat(9600)) *
    scale
  );
}

function greetingHold(age: number, enterMs: number, scale: number): Map<string, number> {
  const elapsed = age - enterMs;
  // Two wrist-led sweeps after raising the hand, then a quiet palm. Both
  // endpoints ease to rest; the pose's existing clock also owns long holds.
  const sweep =
    elapsed >= 0 && elapsed < 1200
      ? Math.sin((elapsed / 600) * Math.PI * 2) *
        smooth(elapsed / 150) *
        smooth((1200 - elapsed) / 250) *
        (1 - 0.25 * smooth(elapsed / 1200)) *
        scale
      : 0;
  const attention = attentionOffset(age, true, scale);
  return new Map(
    [...raised].map(([id, value]) => [
      id,
      value + (amplitudes.get(id) ?? 0) * sweep + (id === 'Param62' ? attention : 0),
    ]),
  );
}

/** One owner for verified greeting entry, wrist sweeps, hold and return.
 * Reverse the existing calibrated arm-return path to raise the palm close to
 * the body, then use that path to lower it back to the evaluated authored exit.
 * Custom/changed pairs and unavailable/physics-owned inputs stay authored. */
export function greetingValues(
  pose: PoseFrame,
  parameters: ReadonlyMap<string, ParameterRange>,
  physicsOutputs: ReadonlySet<string>,
  current: (index: number) => number,
  intensity = 1,
  exitValues?: ReadonlyMap<string, number>,
): Map<number, number> {
  const definition = pose.definition;
  const time = pose.timeMs;
  if (
    !definition ||
    definition.enter !== '默认手切举手' ||
    definition.exit !== '举手切默认手' ||
    definition.parameter !== 'Movement2' ||
    !Number.isFinite(definition.enterMs) ||
    !Number.isFinite(definition.exitMs) ||
    Math.abs(definition.enterMs - 1133) > 0.01 ||
    Math.abs(definition.exitMs - 1017) > 0.01 ||
    !Number.isFinite(time) ||
    time! < 0 ||
    pose.phase === 'none' ||
    pose.reverseEntry
  )
    return new Map();
  for (const id of ['Movement2', ...raised.keys()]) {
    const range = parameters.get(id);
    const target = id === 'Movement2' ? 1 : raised.get(id)!;
    if (
      !range ||
      physicsOutputs.has(id) ||
      ![range.min, range.max, range.neutral].every(Number.isFinite) ||
      range.min > range.max ||
      target < range.min ||
      target > range.max ||
      (id === 'Param62' && range.min > -0.9)
    )
      return new Map();
  }
  const scale = Number.isFinite(intensity) ? clamp(intensity) : 0;
  const indices = (values: ReadonlyMap<string, number>): Map<number, number> =>
    new Map([...values].map(([id, value]) => [parameters.get(id)!.index, value]));
  const neutral = new Map([...raised.keys()].map((id) => [id, parameters.get(id)!.neutral]));
  const shoulder = parameters.get('Param62')!.index;
  let values: Map<number, number>;
  if (pose.phase === 'enter')
    values = chestArmReturn(
      1 - time! / definition.enterMs,
      indices(raised),
      indices(neutral),
      shoulder,
    );
  else if (pose.phase === 'hold')
    values = indices(greetingHold(definition.enterMs + time!, definition.enterMs, scale));
  else {
    const heldAge = Number.isFinite(pose.heldMs)
      ? definition.enterMs + Math.max(0, pose.heldMs!)
      : Infinity;
    const authored = new Map<number, number>();
    for (const id of raised.keys()) {
      const index = parameters.get(id)!.index;
      const value = exitValues ? exitValues.get(id) : current(index);
      if (value === undefined || !Number.isFinite(value)) return new Map();
      authored.set(index, value);
    }
    values = chestArmReturn(
      time! / definition.exitMs,
      indices(greetingHold(heldAge, definition.enterMs, scale)),
      authored,
      shoulder,
    );
  }
  for (const id of raised.keys()) {
    const range = parameters.get(id)!;
    values.set(range.index, clamp(values.get(range.index)!, range.min, range.max));
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
  greetingOwned = false,
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
  if ((!greeting && !explaining) || (greeting && greetingOwned)) return new Map();
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
  // Join the actual last held overlay, even when a short preview returns in
  // the middle of its relaxation/point. Older callers without timing retain
  // the fully relaxed return baseline.
  const age =
    pose.phase === 'hold'
      ? definition.enterMs + pose.timeMs!
      : Number.isFinite(pose.heldMs)
        ? definition.enterMs + Math.max(0, pose.heldMs!)
        : Infinity;
  const returning = pose.phase === 'exit' ? 1 - smooth(pose.timeMs! / 300) : 1;
  const offset = attentionOffset(age, greeting, scale) * returning;
  if (Math.abs(offset) < 1e-8) return new Map();
  const range = parameters.get(greeting ? 'Param62' : 'Param41')!;
  const base = current(range.index);
  if (!Number.isFinite(base)) return new Map();
  return new Map([[range.index, clamp(base + offset, range.min, range.max)]]);
}
