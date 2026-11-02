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
}
export interface ExpressionTransition {
  afterglowMs?: number;
  afterglowWeight?: number;
}
const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));
const smooth = (value: number): number => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};

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
      const accent = smooth((this.until - now) / 450);
      const remaining = glow
        ? (accent + sustained * (1 - accent) * this.afterglowScale) *
          smooth((this.afterglowUntil - now) / 1000)
        : smooth((this.until - now) / 450);
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
  'headX' | 'headY' | 'headZ' | 'bodyX' | 'bodyY' | 'lean' | 'gazeX' | 'gazeY' | 'smile';
const candidates: Record<ActingChannel, string[]> = {
  headX: ['AngleX', 'ParamAngleX'],
  headY: ['AngleY', 'ParamAngleY'],
  headZ: ['AngleZ', 'ParamAngleZ'],
  bodyX: ['PositionX', 'ParamBodyAngleX'],
  bodyY: ['PositionY', 'ParamBodyAngleY'],
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
}
export class PoseSequence {
  private definition?: PoseDefinition;
  private started = 0;
  private holdMs = 1500;
  start(definition: PoseDefinition, now: number, holdMs = 1500): boolean {
    const active = this.sample(now);
    if (active.definition?.enter === definition.enter && active.phase !== 'exit') return false;
    this.definition = definition;
    this.started = now;
    this.holdMs = Number.isFinite(holdMs) ? clamp(holdMs, 400, 16000) : 1500;
    return true;
  }
  clear(): void {
    this.definition = undefined;
  }
  sample(now: number): PoseFrame {
    if (!this.definition) return { phase: 'none' };
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
      };
    this.clear();
    return { phase: 'none' };
  }
}
