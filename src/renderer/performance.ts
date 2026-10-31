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
const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));
const smooth = (value: number): number => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};

export class ExpressionMixer {
  private from: ExpressionLayer[] = [];
  private target?: Omit<ExpressionLayer, 'weight'>;
  private started = 0;
  private until = 0;
  private fade = 240;

  transition(
    name: string,
    parameters: readonly ExpressionParameter[],
    now: number,
    holdMs = 4200,
  ): void {
    this.from = this.sample(now);
    this.target = parameters.length ? { name, parameters } : undefined;
    this.started = now;
    this.until = now + Math.max(0, holdMs);
    this.fade = 240;
  }
  clear(now: number, immediate = false): void {
    this.from = immediate ? [] : this.sample(now);
    this.target = undefined;
    this.started = now;
    this.until = 0;
  }
  sample(now: number): ExpressionLayer[] {
    const blend = smooth((now - this.started) / this.fade);
    const remaining = this.target ? smooth((this.until - now) / 450) : 1;
    const layers = new Map<string, ExpressionLayer>();
    for (const layer of this.from) {
      const weight = layer.weight * (1 - blend) * remaining;
      if (weight > 0.0001) layers.set(layer.name, { ...layer, weight });
    }
    if (this.target) {
      const previous = layers.get(this.target.name)?.weight ?? 0;
      const weight = previous + blend * remaining;
      if (weight > 0.0001) layers.set(this.target.name, { ...this.target, weight });
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
    this.holdMs = clamp(holdMs, 400, 2400);
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
