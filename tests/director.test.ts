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
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ type: 'cue.clear', messageId: 'latest', segmentId: 1 });
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
    d.begin('restored-without-original', undefined, false);
    d.append('원문 없는 복구 이후 메시지.', true, 'resumed');
    await flush();
    expect(judge.judge).toHaveBeenCalledTimes(3);
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
  it('keeps streamed delivery neutral and judges only the completed head and conclusion', async () => {
    const judge = { judge: vi.fn(async (_text: string) => happy) };
    const events: CompanionEvent[] = [];
    const d = new CharacterDirector({ judge, onEvent: (e) => events.push(e) });
    d.begin('r');
    d.append('성공! ' + 'x'.repeat(1000), false, 'm');
    await vi.advanceTimersByTimeAsync(EXPRESSION_PACING.collectMs);
    expect(judge.judge).not.toHaveBeenCalled();
    expect(events).toMatchObject([{ cue: { stage: 'delivery', emotion: 'neutral' } }]);
    d.complete('성공! ' + 'x'.repeat(1000) + ' 그러나 최종 확인은 실패.', 'm');
    await flush();
    expect(judge.judge.mock.calls[0]![0]).toHaveLength(800);
    expect(judge.judge.mock.calls[0]![0]).toMatch(/^성공!/);
    expect(judge.judge.mock.calls[0]![0]).toContain('\n…\n');
    expect(judge.judge.mock.calls[0]![0]).toMatch(/최종 확인은 실패\.$/);
    expect(events).toMatchObject([
      { cue: { stage: 'delivery', segmentId: 1 } },
      { cue: { stage: 'semantic', segmentId: 2 } },
    ]);
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
    const cues = budgetEvents.filter((event) => event.type === 'cue');
    expect(cues).toHaveLength(20);
    expect(budgetEvents.filter((event) => event.type === 'cue.clear')).toHaveLength(19);
    expect(cues.slice(EXPRESSION_PACING.maxJudgements)).toEqual(
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
          stage: 'semantic',
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
  it('withdraws an applied residue at the first byte of a newer message before delivery or inference', async () => {
    const events: CompanionEvent[] = [];
    const judge = { judge: vi.fn(async () => happy) };
    const director = new CharacterDirector({ judge, onEvent: (event) => events.push(event) });
    director.begin('r');
    director.complete('기쁜 답변.', 'first');
    await flush();
    await vi.advanceTimersByTimeAsync(8000);
    expect(events).toHaveLength(1);
    director.append('다', false, 'next');
    expect(events[1]).toEqual({
      type: 'cue.clear',
      requestId: 'r',
      messageId: 'first',
      segmentId: 1,
    });
    expect(judge.judge).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(EXPRESSION_PACING.collectMs);
    expect(events[2]).toMatchObject({ type: 'cue', cue: { messageId: 'next', stage: 'delivery' } });
    director.complete('다음 답변.', 'next');
    await flush();
    expect(judge.judge).toHaveBeenCalledTimes(2);
    director.invalidate();
  });
  it('shows delivery if completed-message inference is slow, but cancels it after a fast result', async () => {
    let resolve!: (v: ExpressionDecision) => void;
    const events: CompanionEvent[] = [];
    const d = new CharacterDirector({
      judge: {
        judge: () =>
          new Promise((r) => {
            resolve = r;
          }),
      },
      onEvent: (e) => events.push(e),
    });
    d.begin('r');
    d.complete('완료 본문.', 'm');
    await vi.advanceTimersByTimeAsync(350);
    expect(events).toMatchObject([{ cue: { stage: 'delivery' } }]);
    resolve(happy);
    await flush();
    expect(events).toHaveLength(2);
    d.invalidate();
    const fastEvents: CompanionEvent[] = [];
    const fast = new CharacterDirector({
      judge: { judge: async () => happy },
      onEvent: (e) => fastEvents.push(e),
    });
    fast.begin('r');
    fast.complete('빠른 완료.', 'm');
    await vi.advanceTimersByTimeAsync(1000);
    expect(fastEvents).toMatchObject([{ cue: { stage: 'semantic' } }]);
    fast.invalidate();
  });
  it('cancels an older judgement on the first new byte and ignores older snapshots/completions', async () => {
    let resolve!: (v: ExpressionDecision) => void;
    let signal!: AbortSignal;
    const judge = {
      judge: vi.fn((_text: string, s: AbortSignal) => {
        signal = s;
        return new Promise<ExpressionDecision>((r) => {
          resolve = r;
        });
      }),
    };
    const events: CompanionEvent[] = [];
    const d = new CharacterDirector({ judge, onEvent: (e) => events.push(e) });
    d.begin('r');
    d.complete('처음 완료.', 'old');
    await flush();
    d.append('새', false, 'new');
    expect(signal.aborted).toBe(true);
    d.replaceSnapshot('old');
    d.complete('정정된 과거 본문.', 'old', true);
    resolve(happy);
    await vi.advanceTimersByTimeAsync(350);
    expect(events).toMatchObject([{ cue: { messageId: 'new', stage: 'delivery' } }]);
    d.invalidate();
  });
  it('uses the latest complete before a call starts, but clears a correction after calling without rejudging', async () => {
    let resolve!: (v: ExpressionDecision) => void;
    const judge = {
      judge: vi.fn(
        (_text: string) =>
          new Promise<ExpressionDecision>((r) => {
            resolve = r;
          }),
      ),
    };
    const events: CompanionEvent[] = [];
    const d = new CharacterDirector({ judge, onEvent: (e) => events.push(e) });
    d.begin('r');
    d.complete('초기 완료.', 'm');
    d.complete('호출 전 정정.', 'm', true);
    await vi.advanceTimersByTimeAsync(350);
    expect(judge.judge.mock.calls[0]![0]).toBe('호출 전 정정.');
    d.complete('호출 후 정정.', 'm', true);
    resolve(happy);
    await flush();
    expect(judge.judge).toHaveBeenCalledOnce();
    expect(events).toMatchObject([
      { cue: { stage: 'delivery', segmentId: 1 } },
      { type: 'cue.clear', requestId: 'r', messageId: 'm', segmentId: 1 },
    ]);
    d.invalidate();
  });
});
