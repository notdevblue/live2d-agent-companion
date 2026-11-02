import type { AppSettings, ModelInventory } from './contracts.js';

/** Local actor choices are not files in the model's manifest. */
export const THINKING_MOTION = '@companion/thinking';
export const SURPRISED_EXPRESSION = '@companion/surprised';
export const ANGRY_EXPRESSION = '@companion/angry';

export function localMapping(kind: 'expression' | 'motion', key: string): string | undefined {
  if (kind === 'expression' && key === 'surprised') return SURPRISED_EXPRESSION;
  if (kind === 'expression' && key === 'angry') return ANGRY_EXPRESSION;
  if (kind === 'motion' && key === 'thinking') return THINKING_MOTION;
  return undefined;
}

/** Restore valid user overrides, retaining deliberate empty choices and model defaults. */
export function applyModelMappings(
  model: ModelInventory,
  settings: Pick<AppSettings, 'expressionMap' | 'gestureMap'>,
): void {
  for (const [kind, saved, available, mapping] of [
    ['expression', settings.expressionMap, model.expressions, model.expressionMap],
    ['motion', settings.gestureMap, model.motions, model.gestureMap],
  ] as const) {
    const target = mapping as Record<string, string>;
    for (const [key, value] of Object.entries(saved ?? {})) {
      if (!value) delete target[key];
      else if (available.includes(value) || localMapping(kind, key) === value) target[key] = value;
    }
  }
}
