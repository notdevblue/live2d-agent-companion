/** Local animation composition. Values are applied to each frame's restored model baseline. */
export interface ExpressionParameter {
  index: number;
  value: number;
  blend: 'Add' | 'Multiply' | 'Overwrite';
}
export interface ExpressionLayer {
  name: string;
  parameters: readonly ExpressionParameter[];
  weight: number;
}
export interface ExpressionTarget {
  name: string;
  parameters: readonly ExpressionParameter[];
  weight?: number;
  afterglowWeight?: number;
  /** Optional accent deadline including its fade; other layers keep the cue lifetime. */
  durationMs?: number;
  fadeOutMs?: number;
}
export interface ExpressionTransition {
  afterglowMs?: number;
  afterglowWeight?: number;
}

/** Discrete eye artwork replaces the iris shape. Crossfading two drawings leaves
 * ghost irises, so hand ownership to one drawing at the midpoint; markings and
 * continuous face inputs retain their ordinary crossfade. Last target wins ties. */
export function selectEyeArtwork(
  layers: readonly ExpressionLayer[],
  eyeIndexes: ReadonlySet<number>,
): ExpressionLayer[] {
  const isArtwork = (layer: ExpressionLayer): boolean =>
    layer.name.endsWith(':eyes') &&
    layer.parameters.some((p) => eyeIndexes.has(p.index) && p.value > 0);
  let owner: ExpressionLayer | undefined;
  let weight = 0;
  for (const layer of layers)
    if (isArtwork(layer)) {
      weight += layer.weight;
      if (layer.weight >= (owner?.weight ?? 0)) owner = layer;
    }
  // A rapid third transition can split a full drawing among three snapshots,
  // none above .5. Gate their combined visibility, then choose one owner.
  if (weight < 0.5) owner = undefined;
  return layers.flatMap((layer) =>
    !isArtwork(layer) ? [layer] : layer === owner ? [{ ...layer, weight: 1 }] : [],
  );
}
const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));
const smooth = (value: number): number => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};

/** Verified on this rig: Param62 near 0 while Param60 is still extended reads as
 * the arm stuck out sideways. -0.9 lowers that same elbow toward the waist. */
const LOWERED_SHOULDER = -0.9;

/** Ease chest-arm joints from the last drawn pose to the authored exit.
 * Zero slope at both ends. The shoulder detours through the lowered waypoint
 * while the elbow straightens, then lands on the endpoint. Finish unfolding
 * before the shoulder recovers: the measured near-zero shoulder/partly bent
 * elbow combination otherwise sweeps the hand beyond the canvas late in return.
 * A greeting may lower its shoulder earlier in the return; other owners
 * retain the original path. Indexes absent from either map are omitted. */
export function chestArmReturn(
  progress: number,
  from: ReadonlyMap<number, number>,
  to: ReadonlyMap<number, number>,
  shoulderIndex: number,
  shoulderDetourBy = 1,
): Map<number, number> {
  if (!Number.isFinite(progress) || !(shoulderDetourBy > 0 && shoulderDetourBy <= 1))
    return new Map();
  const u = smooth(clamp(progress));
  const unfolded = smooth(clamp(progress / 0.75));
  const detour = smooth(clamp(progress / shoulderDetourBy));
  const hump = 16 * detour * detour * (1 - detour) * (1 - detour);
  const values = new Map<number, number>();
  for (const [index, start] of from) {
    const end = to.get(index);
    if (!Number.isFinite(start) || end === undefined || !Number.isFinite(end)) continue;
    const blend = start + (end - start) * (index === shoulderIndex ? u : unfolded);
    values.set(
      index,
      index === shoulderIndex ? blend * (1 - hump) + LOWERED_SHOULDER * hump : blend,
    );
  }
  return values;
}

export class ExpressionMixer {
  private from: ExpressionLayer[] = [];
  private targets: ExpressionTarget[] = [];
  private started = 0;
  private until = 0;
  private afterglowUntil = 0;
  private afterglowWeight = 0;
  private afterglowScale = 1;
  private readonly fade = 240;

  transition(
    name: string,
    parameters: readonly ExpressionParameter[],
    now: number,
    holdMs = 4200,
  ): void {
    this.transitionMany([{ name, parameters }], now, holdMs);
  }
  /** The caller selects exclusive eye art and supplies independent marking layers. */
  transitionMany(
    targets: readonly ExpressionTarget[],
    now: number,
    holdMs = 4200,
    options: ExpressionTransition = {},
  ): void {
    this.from = this.sample(now);
    this.targets = [
      ...new Map(
        targets.filter((target) => target.parameters.length).map((target) => [target.name, target]),
      ).values(),
    ];
    this.started = now;
    this.until = now + (Number.isFinite(holdMs) ? clamp(holdMs, 0, 12000) : 4200);
    const afterglowMs = Number.isFinite(options.afterglowMs)
      ? clamp(options.afterglowMs!, 0, 12000)
      : 0;
    this.afterglowUntil = this.until + afterglowMs;
    this.afterglowWeight = Number.isFinite(options.afterglowWeight)
      ? clamp(options.afterglowWeight!)
      : 0.4;
  }
  clear(now: number, immediate = false): void {
    this.from = immediate ? [] : this.sample(now);
    this.targets = [];
    this.started = now;
    this.until = 0;
    this.afterglowUntil = 0;
  }
  sample(now: number, afterglowScale = this.afterglowScale): ExpressionLayer[] {
    this.afterglowScale = Number.isFinite(afterglowScale) ? clamp(afterglowScale) : 0;
    const blend = smooth((now - this.started) / this.fade);
    const layers = new Map<string, ExpressionLayer>();
    // The same asset may have a different filtered parameter subset in a new cue.
    // Preserve both snapshots during the fade instead of replacing its old values.
    const key = (layer: Pick<ExpressionLayer, 'name' | 'parameters'>): string =>
      JSON.stringify([layer.name, layer.parameters]);
    for (const layer of this.from) {
      const weight = layer.weight * (1 - blend);
      if (weight > 0.0001) layers.set(key(layer), { ...layer, weight });
    }
    for (const target of this.targets) {
      const glow = this.afterglowUntil > this.until;
      const sustained = Number.isFinite(target.afterglowWeight)
        ? clamp(target.afterglowWeight!)
        : this.afterglowWeight;
      const until = Number.isFinite(target.durationMs)
        ? this.started + clamp(target.durationMs!, 0, this.until - this.started)
        : this.until;
      const fade = Number.isFinite(target.fadeOutMs) ? clamp(target.fadeOutMs!, 1, 1000) : 450;
      const accent = smooth((until - now) / fade);
      const remaining = glow
        ? (accent + sustained * (1 - accent) * this.afterglowScale) *
          smooth((this.afterglowUntil - now) / 1000)
        : accent;
      const targetWeight = Number.isFinite(target.weight) ? clamp(target.weight!) : 1;
      const identity = key(target);
      const previous = layers.get(identity)?.weight ?? 0;
      const weight = previous + blend * remaining * targetWeight;
      if (weight > 0.0001)
        layers.set(identity, { name: target.name, parameters: target.parameters, weight });
    }
    return [...layers.values()];
  }
}

/** Blend each expression against the same baseline so Add/Mult never accumulate across frames. */
export function expressionValues(
  layers: readonly ExpressionLayer[],
  baseline: (index: number) => number,
): Map<number, number> {
  const values = new Map<number, number>();
  for (const layer of layers) {
    for (const parameter of layer.parameters) {
      const base = baseline(parameter.index);
      const target =
        parameter.blend === 'Add'
          ? base + parameter.value
          : parameter.blend === 'Multiply'
            ? base * parameter.value
            : parameter.value;
      values.set(
        parameter.index,
        (values.get(parameter.index) ?? base) + (target - base) * layer.weight,
      );
    }
  }
  return values;
}

export interface ParameterRange {
  index: number;
  min: number;
  max: number;
  neutral: number;
}
/** Eyes multiply their rig neutral; other facial controls are normalized input amounts. */
export interface FaceFrame {
  eyeL: number;
  eyeR: number;
  eyeSmile: number;
  browY: number;
  browInner: number;
  pout: number;
  cheek: number;
  mouthOpen?: number;
}
export type ActingChannel =
  'headX' | 'headY' | 'headZ' | 'bodyX' | 'bodyY' | 'bodyZ' | 'lean' | 'gazeX' | 'gazeY' | 'smile';
const candidates: Record<ActingChannel, string[]> = {
  headX: ['AngleX', 'ParamAngleX'],
  headY: ['AngleY', 'ParamAngleY'],
  headZ: ['AngleZ', 'ParamAngleZ'],
  bodyX: ['PositionX', 'ParamBodyAngleX'],
  bodyY: ['PositionY', 'ParamBodyAngleY'],
  bodyZ: ['PositionZ', 'ParamBodyAngleZ'],
  lean: ['LeanInput'],
  gazeX: ['ParamEyeBallX'],
  gazeY: ['ParamEyeBallY'],
  smile: ['ParamMouthForm'],
};

/** Never drive a physics output: doing so loses acting or bypasses the model's authored physics. */
export function actingChannels(
  parameters: ReadonlyMap<string, ParameterRange>,
  physicsOutputs: ReadonlySet<string>,
): Partial<Record<ActingChannel, ParameterRange>> {
  const channels: Partial<Record<ActingChannel, ParameterRange>> = {};
  for (const [channel, ids] of Object.entries(candidates)) {
    const id = ids.find((id) => parameters.has(id) && !physicsOutputs.has(id));
    const parameter = id ? parameters.get(id) : undefined;
    if (parameter) channels[channel as ActingChannel] = parameter;
  }
  return channels;
}

/** Preserve the rig's neutral and asymmetric ranges. `amount` is a fraction of available range. */
export function parameterValue(range: ParameterRange, amount: number): number {
  const value = Number.isFinite(amount) ? clamp(amount, -1, 1) : 0;
  const neutral = clamp(range.neutral, range.min, range.max);
  return neutral + value * (value < 0 ? neutral - range.min : range.max - neutral);
}

/** Resolve only supported upstream inputs, preserving authored motion and independent eyelids. */
export function facialValues(
  frame: FaceFrame,
  parameters: ReadonlyMap<string, ParameterRange>,
  physicsOutputs: ReadonlySet<string>,
  authored: ReadonlySet<string> = new Set(),
): Map<number, number> {
  const values = new Map<number, number>();
  const available = (id: string): boolean =>
    parameters.has(id) && !physicsOutputs.has(id) && !authored.has(id);
  const write = (id: string, amount: number, eye = false): void => {
    if (!available(id)) return;
    const range = parameters.get(id)!;
    if (eye) {
      const ratio = Number.isFinite(amount) ? clamp(amount, 0, 1.5) : 1;
      values.set(
        range.index,
        clamp(clamp(range.neutral, range.min, range.max) * ratio, range.min, range.max),
      );
    } else values.set(range.index, parameterValue(range, amount));
  };
  const positive = (amount: number): number => (Number.isFinite(amount) ? clamp(amount) : 0);
  write('ParamEyeLOpen', frame.eyeL, true);
  write('ParamEyeROpen', frame.eyeR, true);
  for (const id of available('EyeSmile') ? ['EyeSmile'] : ['ParamEyeLSmile', 'ParamEyeRSmile'])
    write(id, positive(frame.eyeSmile));
  write('ParamBrowLY', frame.browY);
  write('ParamBrowRY', frame.browY);
  write('BrowInnerUp', positive(frame.browInner));
  write('Mouthpucker', positive(frame.pout));
  write('CheeckPuff', positive(frame.cheek));
  write('ParamMouthOpenY', positive(frame.mouthOpen ?? 0));
  return values;
}

/** Use only supported upstream facial controls; keep the model's ranges and physics intact. */
export function surprisedExpression(
  parameters: ReadonlyMap<string, ParameterRange>,
  physicsOutputs: ReadonlySet<string>,
): ExpressionParameter[] {
  return (
    [
      ['ParamBrowRY', 0.55],
      ['ParamBrowLY', 0.55],
      ['ParamEyeROpen', 0.75],
      ['ParamEyeLOpen', 0.75],
      ['ParamMouthOpenY', 0.18],
    ] as const
  ).flatMap<ExpressionParameter>(([id, amount]) => {
    const range = parameters.get(id);
    if (!range || physicsOutputs.has(id)) return [];
    const target = parameterValue(range, amount);
    if (id === 'ParamEyeROpen' || id === 'ParamEyeLOpen') {
      const neutral = clamp(range.neutral, range.min, range.max);
      return neutral > 0
        ? [{ index: range.index, value: target / neutral, blend: 'Multiply' as const }]
        : [];
    }
    return [{ index: range.index, value: target, blend: 'Overwrite' as const }];
  });
}

/** Anger uses verified upstream brows/cheek/pout controls, never angle outputs or unknown toggles. */
export function angryExpression(
  parameters: ReadonlyMap<string, ParameterRange>,
  physicsOutputs: ReadonlySet<string>,
  authored: ReadonlySet<string> = new Set(),
): ExpressionParameter[] {
  return (
    [
      ['ParamBrowLY', -0.55],
      ['ParamBrowRY', -0.55],
      ['Mouthpucker', 0.35],
      ['CheeckPuff', 0.2],
      // Verified rig: -.6 is still a flat/W mouth; near -1 creates a frown.
      ['ParamMouthForm', -1],
      ['ParamBrowLAngle', -0.45],
      ['ParamBrowRAngle', -0.45],
      ['ParamBrowLForm', -0.45],
      ['ParamBrowRForm', -0.45],
    ] as const
  ).flatMap<ExpressionParameter>(([id, amount]) => {
    const range = parameters.get(id);
    if (!range || physicsOutputs.has(id) || authored.has(id)) return [];
    return [{ index: range.index, value: parameterValue(range, amount), blend: 'Overwrite' }];
  });
}

export interface PoseDefinition {
  enter: string;
  exit: string;
  parameter: string;
  enterMs: number;
  exitMs: number;
}

/** A pose includes authored wrist/hand angles as well as the visibility/pose selector. */
export function motionEndpoints(
  curves: readonly { Target: string; Id: string; Segments?: readonly number[] }[],
): Map<string, number> {
  const targets = new Map<string, number>();
  for (const curve of curves) {
    const value = curve.Segments?.at(-1);
    if (
      curve.Target === 'Parameter' &&
      (curve.Segments?.length ?? 0) >= 2 &&
      Number.isFinite(value)
    )
      targets.set(curve.Id, value!);
  }
  return targets;
}
export interface PoseFrame {
  phase: 'none' | 'enter' | 'hold' | 'exit';
  definition?: PoseDefinition;
  timeMs?: number;
  /** Sample the authored entry backwards rather than seeking into its return. */
  reverseEntry?: boolean;
  /** Completed hold duration, allowing overlays to join an early return. */
  heldMs?: number;
}
export class PoseSequence {
  private definition?: PoseDefinition;
  private started = 0;
  private holdMs = 1500;
  private returning?: { at: number; duration: number; from: number; reverse: boolean };
  start(definition: PoseDefinition, now: number, holdMs = 1500): boolean {
    const active = this.sample(now);
    if (active.definition?.enter === definition.enter && active.phase !== 'exit') return false;
    this.definition = definition;
    this.returning = undefined;
    this.started = now;
    this.holdMs = Number.isFinite(holdMs) ? clamp(holdMs, 400, 16000) : 1500;
    return true;
  }
  clear(): void {
    this.definition = undefined;
    this.returning = undefined;
  }
  /** Bound a direct-input return without restarting it on duplicate release.
   * The caller supplies its last rendered frame: event time may be ahead of it. */
  release(now: number, budgetMs: number, rendered: PoseFrame): boolean {
    if (!this.definition || this.returning) return false;
    if (
      !Number.isFinite(now) ||
      !Number.isFinite(budgetMs) ||
      budgetMs <= 0 ||
      rendered.phase === 'none'
    ) {
      this.clear();
      return false;
    }
    const reverse = rendered.phase === 'enter' || !!rendered.reverseEntry;
    const end = reverse ? this.definition.enterMs : this.definition.exitMs;
    const time = Number.isFinite(rendered.timeMs) ? clamp(rendered.timeMs!, 0, end) : 0;
    const from = reverse || rendered.phase === 'exit' ? time : 0;
    const distance = reverse ? from : end - from;
    if (distance <= 0) {
      this.clear();
      return false;
    }
    this.returning = { at: now, duration: Math.min(distance, budgetMs, 1050), from, reverse };
    return true;
  }
  sample(now: number): PoseFrame {
    if (!this.definition) return { phase: 'none' };
    if (this.returning) {
      const { at, duration, from, reverse } = this.returning;
      const progress = clamp((now - at) / duration, 0, 1);
      if (progress >= 1) {
        this.clear();
        return { phase: 'none' };
      }
      return {
        phase: 'exit',
        definition: this.definition,
        timeMs: reverse ? from * (1 - progress) : from + (this.definition.exitMs - from) * progress,
        ...(reverse ? { reverseEntry: true } : {}),
      };
    }
    const elapsed = Math.max(0, now - this.started);
    const { enterMs, exitMs } = this.definition;
    if (elapsed < enterMs) return { phase: 'enter', definition: this.definition, timeMs: elapsed };
    if (elapsed < enterMs + this.holdMs)
      return { phase: 'hold', definition: this.definition, timeMs: elapsed - enterMs };
    if (elapsed < enterMs + this.holdMs + exitMs)
      return {
        phase: 'exit',
        definition: this.definition,
        timeMs: elapsed - enterMs - this.holdMs,
        heldMs: this.holdMs,
      };
    this.clear();
    return { phase: 'none' };
  }
}
