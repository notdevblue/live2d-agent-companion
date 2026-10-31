import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CharacterDirector } from '../src/core/character-director.js';
import {
  EXPRESSION_PACING,
  type CompanionEvent,
  type ExpressionDecision,
} from '../src/shared/contracts.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const happy: ExpressionDecision = { emotion: 'happy', gesture: 'none', confidence: 0.9 };
const flush = () => vi.advanceTimersByTimeAsync(0);

describe('bounded expression timeline (FR-DIR-005)', () => {
  it('coalesces a large burst into opening and latest beats without parallel calls', async () => {
    const judge = { judge: vi.fn(async (_text: string, _signal: AbortSignal) => happy) };
    const events: CompanionEvent[] = [];
    const director = new CharacterDirector({ judge, onEvent: (e) => events.push(e) });
    director.begin('one');
    director.append(Array.from({ length: 20 }, (_, i) => `문장-${i}.`).join(' '), true);
    await flush();
    await vi.advanceTimersByTimeAsync(EXPRESSION_PACING.holdMs * 5);
    expect(judge.judge.mock.calls.map((row) => row[0])).toEqual([
      '문장-0.',
      '문장-17.',
      '문장-18.',
      '문장-19.',
    ]);
    expect(events.filter((e) => e.type === 'cue').map((e) => e.cue.segmentId)).toEqual([
      1, 18, 19, 20,
    ]);
    director.invalidate();
  });
  it('caps actual judgement calls per response even during a long stream', async () => {
    const judge = { judge: vi.fn(async (_text: string, _signal: AbortSignal) => happy) };
    const director = new CharacterDirector({ judge, onEvent: () => {} });
    director.begin('one');
    for (let i = 0; i < 20; i++) {
      director.append(`문장 ${i}.`);
      await vi.advanceTimersByTimeAsync(EXPRESSION_PACING.holdMs);
    }
    expect(judge.judge).toHaveBeenCalledTimes(EXPRESSION_PACING.maxJudgements);
    director.invalidate();
  });
  it('does not replay queued text after sleep or apply a superseded generation', async () => {
    let resolve!: (decision: ExpressionDecision) => void;
    const pending = new Promise<ExpressionDecision>((r) => {
      resolve = r;
    });
    const judge = { judge: vi.fn().mockReturnValueOnce(pending).mockResolvedValue(happy) };
    const events: CompanionEvent[] = [];
    const director = new CharacterDirector({ judge, onEvent: (e) => events.push(e) });
    director.begin('old');
    director.append('첫 문장. 대기 문장.');
    await flush();
    vi.setSystemTime(Date.now() + EXPRESSION_PACING.maxAgeMs + 1);
    resolve(happy);
    await flush();
    expect(events).toHaveLength(0);
    expect(judge.judge).toHaveBeenCalledTimes(1);
    director.begin('new');
    director.append('새 문장.');
    await flush();
    expect(events).toMatchObject([
      { type: 'cue', cue: { requestId: 'new', segmentId: 1, emotion: 'happy' } },
    ]);
    director.invalidate();
  });
  it('cancels pending and scheduled work immediately for a new request', async () => {
    let resolve!: (decision: ExpressionDecision) => void;
    const judge = {
      judge: vi
        .fn()
        .mockReturnValueOnce(
          new Promise<ExpressionDecision>((r) => {
            resolve = r;
          }),
        )
        .mockResolvedValue(happy),
    };
    const events: CompanionEvent[] = [];
    const director = new CharacterDirector({ judge, onEvent: (e) => events.push(e) });
    director.begin('old');
    director.append('첫 문장. 오래된 문장.');
    await flush();
    const signal = judge.judge.mock.calls[0]![1] as AbortSignal;
    director.begin('new');
    director.append('새 문장.');
    await flush();
    expect(signal.aborted).toBe(true);
    resolve(happy);
    await vi.advanceTimersByTimeAsync(EXPRESSION_PACING.holdMs * 3);
    expect(events.filter((e) => e.type === 'cue')).toMatchObject([{ cue: { requestId: 'new' } }]);
    expect(judge.judge).toHaveBeenCalledTimes(2);
    director.invalidate();
  });
});
