import { describe, expect, it } from 'vitest';
import { angryExpression } from '../src/renderer/performance.js';
import { modelAssetLabel } from '../src/renderer/model-labels.js';
import {
  ANGRY_EXPRESSION,
  applyModelMappings,
  localMapping,
} from '../src/shared/model-mappings.js';
import { DEFAULT_PRESENTATION, type ModelInventory } from '../src/shared/contracts.js';

describe('protected anger and optional local interaction controls', () => {
  it('uses supported upstream ranges and skips authored/physics outputs or missing controls', () => {
    const parameters = new Map([
      ['ParamBrowLY', { index: 1, min: -2, max: 1, neutral: 0 }],
      ['ParamBrowRY', { index: 2, min: -1, max: 3, neutral: 0 }],
      ['Mouthpucker', { index: 3, min: 0, max: 2, neutral: 0.2 }],
      ['CheeckPuff', { index: 4, min: 0, max: 1, neutral: 0 }],
      ['ParamBrowLAngle', { index: 5, min: -1, max: 1, neutral: 0 }],
      ['Emotion', { index: 6, min: 0, max: 1, neutral: 0 }],
      ['Angry', { index: 7, min: 0, max: 1, neutral: 0 }],
      ['ParamMouthForm', { index: 8, min: -2, max: 1, neutral: 0 }],
      ['ParamBrowLForm', { index: 9, min: -1, max: 1, neutral: 0 }],
    ]);
    const result = angryExpression(
      parameters,
      new Set(['ParamBrowRY', 'ParamBrowLAngle']),
      new Set(['CheeckPuff']),
    );
    expect(result).toEqual([
      { index: 1, value: -1.1, blend: 'Overwrite' },
      { index: 3, value: expect.closeTo(0.83, 8), blend: 'Overwrite' },
      { index: 8, value: -2, blend: 'Overwrite' },
      { index: 9, value: -0.45, blend: 'Overwrite' },
    ]);
    expect(angryExpression(new Map(), new Set())).toEqual([]);
  });
  it('never applies the angry mouth or brows over an authored clip or physics output', () => {
    const parameters = new Map([
      ['ParamMouthForm', { index: 0, min: -1, max: 1, neutral: 0 }],
      ['ParamBrowLAngle', { index: 1, min: -1, max: 1, neutral: 0 }],
      ['ParamBrowRForm', { index: 2, min: -1, max: 1, neutral: 0 }],
    ]);
    expect(
      angryExpression(
        parameters,
        new Set(['ParamBrowLAngle']),
        new Set(['ParamMouthForm', 'ParamBrowRForm']),
      ),
    ).toEqual([]);
  });

  it('recognizes the local angry mapping, honors saved empty/custom mappings and labels it in Korean', () => {
    const model = {
      expressions: ['custom'],
      motions: [],
      expressionMap: { angry: ANGRY_EXPRESSION },
      gestureMap: {},
    } as unknown as ModelInventory;
    expect(localMapping('expression', 'angry')).toBe(ANGRY_EXPRESSION);
    expect(modelAssetLabel(ANGRY_EXPRESSION, 'expression')).toBe('화남 (기본 표정)');
    applyModelMappings(model, { expressionMap: { angry: 'custom' } });
    expect(model.expressionMap.angry).toBe('custom');
    applyModelMappings(model, { expressionMap: { angry: ANGRY_EXPRESSION } });
    expect(model.expressionMap.angry).toBe(ANGRY_EXPRESSION);
    applyModelMappings(model, { expressionMap: { angry: '' } });
    expect(model.expressionMap.angry).toBeUndefined();
    expect(DEFAULT_PRESENTATION.pettingEnabled).toBe(false);
  });
});
