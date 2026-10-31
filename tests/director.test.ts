import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CharacterDirector } from '../src/core/character-director.js';
import {
  EXPRESSION_PACING,
  type CompanionEvent,
  type ExpressionDecision,
  type ExpressionContext,
} from '../src/shared/contracts.js';
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const happy: ExpressionDecision = { emotion: 'happy', gesture: 'none', confidence: 0.9 };
const flush = () => vi.advanceTimersByTimeAsync(0);
describe('one decision per actual assistant message (FR-DIR-005)', () => {
  it('gives messages a local neutral beat without Jev, coalescing and invalidating as usual', async () => {
    const events: CompanionEvent[] = [];
    const d = new CharacterDirector({ onEvent: (e) => events.push(e) });
    d.begin('local');
    d.append('첫 메시지.', true, 'first');
    d.append('최신 메시지.', true, 'latest');
    await flush();
    expect(events).toMatchObject([
      {
        type: 'cue',
        cue: {
          requestId: 'local',
          messageId: 'latest',
          emotion: 'neutral',
          gesture: 'none',
          source: 'fallback',
        },
      },
    ]);
    d.append('추가 delta.', true, 'latest');
    d.append('재생하지 않을 메시지.', true, 'cancelled');
    d.invalidate();
    await flush();
    expect(events).toHaveLength(1);
  });
  it('keeps bounded current request context across progress messages and clears it at request boundaries', async () => {
    const judge = {
      judge: vi.fn(
        async (_text: string, _signal: AbortSignal, _context?: ExpressionContext) => happy,
      ),
    };
    const d = new CharacterDirector({ judge, onEvent: () => {} });
    const request = 'FIRST-REQUEST-' + 'x'.repeat(4000) + '-FINAL-CONSTRAINT';
    d.begin('first', request);
    d.append('중간 응답.', true, 'progress');
    await flush();
    d.append('최종 응답.', true, 'final');
    await flush();
    const first = judge.judge.mock.calls[0]![2]!.userRequest;
    expect(first).toHaveLength(EXPRESSION_PACING.maxRequestText);
    expect(first).toMatch(/^FIRST-REQUEST-/);
    expect(first).toMatch(/-FINAL-CONSTRAINT$/);
    expect(judge.judge.mock.calls[1]![2]).toEqual({ userRequest: first });
    d.begin('second', 'SECOND REQUEST');
    d.append('새 요청의 답변.', true, 'other');
    await flush();
    expect(judge.judge.mock.calls[2]![2]).toEqual({ userRequest: 'SECOND REQUEST' });
    d.begin('restored-without-original');
    d.append('원문 없는 복구 이후 메시지.', true, 'resumed');
    await flush();
    expect(judge.judge.mock.calls[3]![2]).toBeUndefined();
    d.invalidate();
  });
  it('ends the waiting pose when visible text streams and retains actual tool work as the fallback', () => {
    const events: CompanionEvent[] = [];
    const d = new CharacterDirector({ onEvent: (e) => events.push(e) });
    d.begin('r');
    d.updateState('accepted', false);
    d.updateState('streaming', false);
    d.updateState('streaming', true);
    d.updateState('streaming', false);
    d.updateState('completed', false);
    expect(events).toEqual([
      { type: 'character', state: 'thinking' },
      { type: 'character', state: 'idle' },
      { type: 'character', state: 'working' },
      { type: 'character', state: 'idle' },
    ]);
  });
  it('does not spend the call budget on superseded messages in the same incoming batch', async () => {
    const judge = { judge: vi.fn(async () => happy) },
      events: CompanionEvent[] = [];
    const d = new CharacterDirector({ judge, onEvent: (e) => events.push(e) });
    d.begin('r');
    for (let i = 0; i < 12; i++) d.append('새 메시지.', true, String(i));
    await flush();
    expect(judge.judge).toHaveBeenCalledTimes(1);
    expect(events).toMatchObject([{ cue: { messageId: '11' } }]);
    d.invalidate();
  });
  it('does not queue sentences or replay expressions after a completed long reply', async () => {
    const judge = { judge: vi.fn(async (_text: string, _signal: AbortSignal) => happy) },
      events: CompanionEvent[] = [];
    const d = new CharacterDirector({ judge, onEvent: (e) => events.push(e) });
    d.begin('r');
    d.append('첫 문장. 두 번째 문장. 마지막 문장.', true, 'one');
    await flush();
    d.append(' 더 많은 내용.', true, 'one');
    await vi.advanceTimersByTimeAsync(20000);
    expect(judge.judge).toHaveBeenCalledTimes(1);
    expect(events).toMatchObject([{ type: 'cue', cue: { messageId: 'one', segmentId: 1 } }]);
    d.invalidate();
  });
  it('starts a new message without waiting for the preceding animation and cancels stale decisions', async () => {
    let resolve!: (v: ExpressionDecision) => void;
    const judge = {
        judge: vi
          .fn()
          .mockReturnValueOnce(
            new Promise<ExpressionDecision>((r) => {
              resolve = r;
            }),
          )
          .mockResolvedValue(happy),
      },
      events: CompanionEvent[] = [];
    const d = new CharacterDirector({ judge, onEvent: (e) => events.push(e) });
    d.begin('r');
    d.append('진행 메시지.', true, 'progress');
    await flush();
    const signal = judge.judge.mock.calls[0]![1] as AbortSignal;
    d.append('최종 답변.', true, 'final');
    await flush();
    resolve(happy);
    await flush();
    expect(signal.aborted).toBe(true);
    expect(events).toMatchObject([{ cue: { messageId: 'final' } }]);
    expect(judge.judge).toHaveBeenCalledTimes(2);
    d.invalidate();
  });
  it('collects a short streamed prefix briefly and bounds the sole judgement to 800 characters', async () => {
    const judge = { judge: vi.fn(async (_text: string, _signal: AbortSignal) => happy) };
    const d = new CharacterDirector({ judge, onEvent: () => {} });
    d.begin('r');
    d.append('안녕', false, 'a');
    await vi.advanceTimersByTimeAsync(EXPRESSION_PACING.collectMs - 1);
    expect(judge.judge).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(judge.judge.mock.calls[0]![0]).toBe('안녕');
    d.append('x'.repeat(4000), true, 'b');
    await flush();
    expect(judge.judge.mock.calls[1]![0]).toHaveLength(800);
    d.invalidate();
  });
  it('caps calls across many progress messages and drops results after sleep or cancellation', async () => {
    const judge = { judge: vi.fn(async (_text: string, _signal: AbortSignal) => happy) };
    const budgetEvents: CompanionEvent[] = [];
    const d = new CharacterDirector({ judge, onEvent: (e) => budgetEvents.push(e) });
    d.begin('r');
    for (let i = 0; i < 20; i++) {
      d.append('진행 메시지.', true, String(i));
      await flush();
    }
    expect(judge.judge).toHaveBeenCalledTimes(EXPRESSION_PACING.maxJudgements);
    expect(budgetEvents).toHaveLength(20);
    expect(budgetEvents.slice(EXPRESSION_PACING.maxJudgements)).toEqual(
      Array.from({ length: 20 - EXPRESSION_PACING.maxJudgements }, (_, i) => ({
        type: 'cue',
        cue: {
          requestId: 'r',
          messageId: String(i + EXPRESSION_PACING.maxJudgements),
          segmentId: i + EXPRESSION_PACING.maxJudgements + 1,
          emotion: 'neutral',
          gesture: 'none',
          confidence: 0,
          source: 'fallback',
        },
      })),
    );
    d.invalidate();
    let resolve!: (v: ExpressionDecision) => void;
    const events: CompanionEvent[] = [];
    const sleeping = new CharacterDirector({
      judge: {
        judge: () =>
          new Promise((r) => {
            resolve = r;
          }),
      },
      onEvent: (e) => events.push(e),
    });
    sleeping.begin('r');
    sleeping.append('메시지.', true, 'm');
    await flush();
    vi.setSystemTime(Date.now() + EXPRESSION_PACING.maxAgeMs + 1);
    resolve(happy);
    await flush();
    expect(events).toHaveLength(0);
    sleeping.invalidate();
  });
});
