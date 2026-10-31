import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentAdapter,
  AgentBinding,
  AgentEvent,
  ApprovalResponse,
  CompanionEvent,
  EventPayloads,
  EventSink,
  ExpressionDecision,
  ExpressionJudge,
  RequestRef,
  UserTurn,
} from '../src/shared/contracts.js';
import { unsupportedCapabilities } from '../src/shared/contracts.js';
import { TurnCoordinator } from '../src/core/turn-coordinator.js';
import { MockAdapter } from '../src/adapters/mock.js';

const binding = (): AgentBinding => ({
  provider: 'mock',
  connectionId: randomUUID(),
  agentId: 'fixture',
  sessionId: randomUUID(),
  continuity: 'new-session',
});
class ControlledAdapter implements AgentAdapter {
  readonly provider = 'mock' as const;
  sent: UserTurn[] = [];
  responses: ApprovalResponse[] = [];
  sink?: EventSink;
  cancellation: 'confirmed' | 'requested' | 'unsupported' = 'unsupported';
  approvalResult: 'applied' | 'closed' | 'unknown' = 'applied';
  connect = async () => {};
  disconnect = async () => {};
  discover = async () => unsupportedCapabilities();
  async send(turn: UserTurn, sink: EventSink): Promise<void> {
    this.sent.push(turn);
    this.sink = sink;
  }
  async cancel(): Promise<'confirmed' | 'requested' | 'unsupported'> {
    return this.cancellation;
  }
  async respondApproval(response: ApprovalResponse): Promise<'applied' | 'closed' | 'unknown'> {
    this.responses.push(response);
    return this.approvalResult;
  }
  async reconcile(_request: RequestRef, sink: EventSink): Promise<'unknown'> {
    this.sink = sink;
    return 'unknown';
  }
  event<K extends keyof EventPayloads>(
    type: K,
    payload: EventPayloads[K],
    overrides: Record<string, unknown> = {},
  ): AgentEvent {
    const turn = this.sent[0]!;
    return {
      binding: turn.binding,
      turnId: turn.turnId,
      requestId: turn.requestId,
      schemaVersion: 1,
      eventId: randomUUID(),
      type,
      payload,
      ...overrides,
    } as AgentEvent;
  }
  emit<K extends keyof EventPayloads>(
    type: K,
    payload: EventPayloads[K],
    overrides: Record<string, unknown> = {},
  ): void {
    this.sink!(this.event(type, payload, overrides));
  }
}
const fixture = (
  extra: { judge?: ExpressionJudge; requestTimeoutMs?: number; judgeTimeoutMs?: number } = {},
) => {
  const adapter = new ControlledAdapter();
  const events: CompanionEvent[] = [];
  const selected = binding();
  const core = new TurnCoordinator({
    adapter,
    binding: selected,
    onEvent: (event) => events.push(event),
    ...extra,
  });
  return { adapter, events, core, binding: selected };
};
const cueEvents = (events: CompanionEvent[]) => events.filter((e) => e.type === 'cue');
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};
const happy: ExpressionDecision = { emotion: 'happy', gesture: 'wave', confidence: 0.9 };
const sad: ExpressionDecision = { emotion: 'sad', gesture: 'none', confidence: 0.9 };
const flush = async () => {
  await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('TurnCoordinator request boundary (FR-AG-003/004/010/012)', () => {
  it('validates event payload and full binding, deduplicates, and accepts a terminal once', async () => {
    const { core, adapter, events } = fixture();
    await core.send('fixture');
    adapter.emit('turn.accepted', {});
    const delta = adapter.event('message.delta', { text: '안녕', messageId: 'm' });
    adapter.sink!(delta);
    adapter.sink!(delta);
    adapter.emit(
      'message.delta',
      { text: 'wrong session', messageId: 'm' },
      { binding: { ...delta.binding, sessionId: 'other' } },
    );
    adapter.emit(
      'message.delta',
      { text: 'wrong request', messageId: 'm' },
      { requestId: 'other' },
    );
    adapter.sink!({
      ...delta,
      eventId: randomUUID(),
      payload: { text: 123, messageId: 'm' },
    } as unknown as AgentEvent);
    expect(core.current?.text).toBe('안녕');
    adapter.emit('turn.completed', {});
    adapter.emit('turn.completed', {});
    adapter.emit('message.delta', { text: 'late', messageId: 'm' });
    expect(events.filter((e) => e.type === 'turn' && e.turn.state === 'completed')).toHaveLength(1);
    expect(core.current?.text).toBe('안녕');
    await core.send('second');
    expect(adapter.sent[0]?.requestId).not.toBe(adapter.sent[1]?.requestId);
    expect(adapter.sent[0]?.turnId).not.toBe(adapter.sent[1]?.turnId);
    adapter.sink!(delta);
    expect(core.current?.text).toBe('');
    await core.dispose();
  });

  it('timeout retains lease, accepts original late completion and then allows submit', async () => {
    const { core, adapter } = fixture({ requestTimeoutMs: 20 });
    await core.send('fixture');
    adapter.emit('turn.accepted', {});
    await vi.advanceTimersByTimeAsync(21);
    expect(core.current?.state).toBe('reconciling');
    await expect(core.send('duplicate')).rejects.toThrow();
    await core.reconcile();
    expect(adapter.sent).toHaveLength(1);
    expect(core.current?.state).toBe('reconciling');
    adapter.emit('message.complete', { text: '늦은 응답', messageId: 'm' });
    adapter.emit('turn.completed', {});
    expect(core.current?.state).toBe('completed');
    await core.send('safe next');
    await core.dispose();
  });

  it('Mock disconnect/reconnect replaces response snapshot without extra judge calls', async () => {
    const events: CompanionEvent[] = [];
    const judge = { judge: vi.fn(async (_text: string, _signal: AbortSignal) => happy) };
    const core = new TurnCoordinator({
      adapter: new MockAdapter({ mode: 'disconnect' }),
      binding: binding(),
      judge,
      onEvent: (e) => events.push(e),
    });
    await core.send('fixture');
    expect(core.current?.state).toBe('reconciling');
    await expect(core.send('blocked')).rejects.toThrow();
    await flush();
    const calls = judge.judge.mock.calls.length;
    await core.reconcile();
    await flush();
    expect(core.current?.state).toBe('completed');
    expect(core.current?.text.match(/안녕하세요/g)).toHaveLength(1);
    expect(judge.judge).toHaveBeenCalledTimes(calls);
    expect(events.filter((e) => e.type === 'turn' && e.turn.state === 'completed')).toHaveLength(1);
    await core.dispose();
  });

  it('unsupported cancellation stops pending character effects but keeps lease until remote outcome', async () => {
    const pending = deferred<ExpressionDecision>();
    const judge = { judge: vi.fn((_text: string, _signal: AbortSignal) => pending.promise) };
    const { core, adapter, events } = fixture({ judge });
    await core.send('fixture');
    adapter.emit('message.delta', { text: '응답입니다. ', messageId: 'm' });
    await flush();
    await core.cancel();
    pending.resolve(happy);
    await flush();
    expect(cueEvents(events)).toHaveLength(0);
    expect(core.current?.state).toBe('cancel_requested');
    await expect(core.send('duplicate')).rejects.toThrow();
    adapter.emit('message.complete', { text: '계속 실행됨.', messageId: 'm' });
    adapter.emit('turn.completed', {});
    await flush();
    expect(judge.judge).toHaveBeenCalledTimes(1);
    expect(core.current?.state).toBe('completed');
    await core.dispose();
  });

  it('restores only metadata as reconciling, transfers lease and never resubmits', async () => {
    const { core, adapter, binding: selected } = fixture();
    await core.send('PRIVATE ORIGINAL PROMPT');
    adapter.emit('message.delta', { text: 'PRIVATE ANSWER', messageId: 'm' });
    adapter.emit('approval.requested', {
      approvalId: 'approval',
      summary: 'PRIVATE SUMMARY',
      expiresAt: Date.now() + 5000,
    });
    const snapshot = core.snapshot();
    expect(JSON.stringify(snapshot)).not.toMatch(/PRIVATE|text|summary|credential|token/i);
    const secondAdapter = new ControlledAdapter();
    const events: CompanionEvent[] = [];
    const restored = new TurnCoordinator({
      adapter: secondAdapter,
      binding: selected,
      onEvent: (e) => events.push(e),
    });
    await core.dispose();
    restored.restore(snapshot);
    expect(restored.current?.state).toBe('reconciling');
    expect(restored.current?.text).toBe('');
    await restored.reconcile();
    expect(secondAdapter.sent).toHaveLength(0);
    await expect(restored.send('blocked')).rejects.toThrow();
    const pending = snapshot.pending!;
    secondAdapter.sink!({
      schemaVersion: 1,
      eventId: randomUUID(),
      type: 'turn.completed',
      payload: {},
      binding: selected,
      turnId: pending.turnId,
      requestId: pending.requestId,
    });
    expect(restored.current?.state).toBe('completed');
    await restored.send('next');
    await restored.dispose();
  });

  it('separate sessions are independent while a disposed pending session remains blocked', async () => {
    const { core, binding: selected } = fixture();
    await core.send('fixture');
    await core.dispose();
    const replacement = new TurnCoordinator({
      adapter: new ControlledAdapter(),
      binding: selected,
      onEvent: () => {},
    });
    await expect(replacement.send('unsafe resend')).rejects.toThrow();
    const independent = new TurnCoordinator({
      adapter: new ControlledAdapter(),
      binding: { ...selected, sessionId: randomUUID() },
      onEvent: () => {},
    });
    await independent.send('independent');
    await replacement.dispose();
    await independent.dispose();
  });
});

describe('durable pre-submit barrier', () => {
  it('waits for metadata durability before submitting and exports no transcript', async () => {
    const persisted = deferred<void>();
    const adapter = new ControlledAdapter();
    const beforeSubmit = vi.fn(async (metadata) => {
      expect(JSON.stringify(metadata)).not.toContain('PRIVATE PROMPT');
      await persisted.promise;
    });
    const core = new TurnCoordinator({
      adapter,
      binding: binding(),
      onEvent: () => {},
      beforeSubmit,
    });
    const send = core.send('PRIVATE PROMPT');
    expect(beforeSubmit).toHaveBeenCalledTimes(1);
    expect(adapter.sent).toHaveLength(0);
    persisted.resolve();
    await send;
    expect(adapter.sent).toHaveLength(1);
    await core.dispose();
  });
  it('a persistence write failure prevents network submit and releases known-unsubmitted lease', async () => {
    const adapter = new ControlledAdapter();
    const core = new TurnCoordinator({
      adapter,
      binding: binding(),
      onEvent: () => {},
      beforeSubmit: async () => {
        throw new Error('SECRET DISK DETAIL');
      },
    });
    await core.send('fixture');
    expect(adapter.sent).toHaveLength(0);
    expect(core.current?.state).toBe('failed');
    expect(core.current?.error).not.toContain('SECRET');
    await expect(core.send('retry after storage repair')).resolves.toBeUndefined();
    expect(adapter.sent).toHaveLength(0);
    await core.dispose();
  });
  it.each(['cancel', 'dispose'] as const)(
    '%s during persistence cannot cause a late remote submission',
    async (action) => {
      const persisted = deferred<void>();
      const selected = binding();
      const adapter = new ControlledAdapter();
      const core = new TurnCoordinator({
        adapter,
        binding: selected,
        onEvent: () => {},
        beforeSubmit: () => persisted.promise,
      });
      const send = core.send('fixture');
      await core[action]();
      persisted.resolve();
      await send;
      expect(adapter.sent).toHaveLength(0);
      expect(core.current?.state).toBe('failed');
      const nextAdapter = new ControlledAdapter();
      const next = new TurnCoordinator({
        adapter: nextAdapter,
        binding: selected,
        onEvent: () => {},
      });
      await next.send('safe next');
      expect(nextAdapter.sent).toHaveLength(1);
      await core.dispose();
      await next.dispose();
    },
  );
});

describe('additional interruption races', () => {
  it('transport rejection preserves ambiguous request and prevents automatic resend', async () => {
    const { core, adapter } = fixture();
    adapter.send = async (turn, sink) => {
      adapter.sent.push(turn);
      adapter.sink = sink;
      throw new Error('sensitive transport detail');
    };
    await core.send('fixture');
    expect(core.current?.state).toBe('reconciling');
    expect(core.current?.error).not.toContain('sensitive');
    await expect(core.send('duplicate')).rejects.toThrow();
    expect(adapter.sent).toHaveLength(1);
    adapter.emit('turn.completed', {});
    expect(core.current?.state).toBe('completed');
    await core.dispose();
  });
  it('confirmed cancellation is terminal once and stale judge cannot override failure', async () => {
    const cancelled = fixture();
    cancelled.adapter.cancellation = 'confirmed';
    await cancelled.core.send('fixture');
    await cancelled.core.cancel();
    cancelled.adapter.emit('turn.cancelled', { remoteConfirmed: true });
    expect(
      cancelled.events.filter((e) => e.type === 'turn' && e.turn.state === 'cancelled'),
    ).toHaveLength(1);
    await cancelled.core.dispose();
    const pending = deferred<ExpressionDecision>();
    const failed = fixture({ judge: { judge: async () => pending.promise } });
    await failed.core.send('fixture');
    failed.adapter.emit('message.complete', { text: '표시용 답변.', messageId: 'm' });
    await flush();
    failed.adapter.emit('turn.failed', { code: 'remote_failure', safeMessage: '원격 실패' });
    pending.resolve(happy);
    await flush();
    expect(cueEvents(failed.events)).toHaveLength(0);
    expect(failed.events.at(-1)).toEqual({ type: 'character', state: 'error' });
    await failed.core.dispose();
  });
  it('duplicated approval request cannot reopen an unknown response without remote recovery', async () => {
    const { core, adapter } = fixture();
    adapter.approvalResult = 'unknown';
    await core.send('fixture');
    const approval = { approvalId: 'a', summary: 'fixture', expiresAt: Date.now() + 1000 };
    adapter.emit('approval.requested', approval);
    await core.approve('a', 'deny');
    adapter.emit('approval.requested', approval);
    await expect(core.approve('a', 'deny')).rejects.toThrow();
    expect(adapter.responses).toHaveLength(1);
    adapter.emit('turn.resumed', { state: 'accepted' });
    adapter.emit('approval.requested', approval);
    adapter.approvalResult = 'applied';
    await core.approve('a', 'deny');
    expect(adapter.responses).toHaveLength(2);
    await core.dispose();
  });
});

describe('provider approvals (FR-AG-013, E-015/016)', () => {
  it('delivers deny exactly once with original binding and never grants local PC permission', async () => {
    const { core, adapter } = fixture();
    await core.send('fixture');
    adapter.emit('approval.requested', {
      approvalId: 'a',
      summary: 'fixture',
      expiresAt: Date.now() + 1000,
    });
    await expect(core.approve('wrong', 'deny')).rejects.toThrow();
    await core.approve('a', 'deny');
    await expect(core.approve('a', 'allow_once')).rejects.toThrow();
    expect(adapter.responses).toEqual([
      {
        binding: adapter.sent[0]!.binding,
        turnId: adapter.sent[0]!.turnId,
        requestId: adapter.sent[0]!.requestId,
        approvalId: 'a',
        decision: 'deny',
      },
    ]);
    expect(core.current?.approval).toBeUndefined();
    expect(core.current?.state).toBe('submitting');
    await core.dispose();
  });
  it('expiry and withdrawal only close approval UI and retain request lease', async () => {
    const { core, adapter } = fixture();
    await core.send('fixture');
    adapter.emit('approval.requested', {
      approvalId: 'a',
      summary: 'fixture',
      expiresAt: Date.now() + 10,
    });
    await vi.advanceTimersByTimeAsync(11);
    expect(core.current?.approval).toBeUndefined();
    await expect(core.approve('a', 'deny')).rejects.toThrow();
    adapter.emit('approval.requested', {
      approvalId: 'b',
      summary: 'fixture',
      expiresAt: Date.now() + 1000,
    });
    adapter.emit('approval.closed', { approvalId: 'b', reason: 'withdrawn' });
    await expect(core.approve('b', 'allow_once')).rejects.toThrow();
    await expect(core.send('blocked')).rejects.toThrow();
    expect(adapter.responses).toHaveLength(0);
    await core.dispose();
  });
  it('acknowledgement loss becomes unknown and forbids automatic retry', async () => {
    const { core, adapter } = fixture();
    adapter.approvalResult = 'unknown';
    await core.send('fixture');
    adapter.emit('approval.requested', {
      approvalId: 'a',
      summary: 'fixture',
      expiresAt: Date.now() + 1000,
    });
    await core.approve('a', 'deny');
    expect(core.current?.state).toBe('reconciling');
    await expect(core.approve('a', 'deny')).rejects.toThrow();
    expect(adapter.responses).toHaveLength(1);
    await core.dispose();
  });
});

describe('asynchronous CharacterDirector (FR-DIR-001/002)', () => {
  it('publishes text immediately and judges each chat message only once', async () => {
    const first = deferred<ExpressionDecision>();
    const judge = { judge: vi.fn().mockReturnValue(first.promise) };
    const { core, adapter, events } = fixture({ judge });
    await core.send('fixture');
    adapter.emit('message.delta', { text: '첫 문장. ', messageId: 'm' });
    await flush();
    adapter.emit('message.delta', { text: '두 번째 문장. ', messageId: 'm' });
    adapter.emit('message.complete', {
      text: '첫 문장. 두 번째 문장. 마지막 문장.',
      messageId: 'm',
    });
    adapter.emit('turn.completed', {});
    first.resolve(happy);
    await flush();
    await vi.advanceTimersByTimeAsync(15000);
    expect(core.current?.text).toBe('첫 문장. 두 번째 문장. 마지막 문장.');
    expect(judge.judge).toHaveBeenCalledTimes(1);
    expect(cueEvents(events)).toMatchObject([{ cue: { messageId: 'm', emotion: 'happy' } }]);
    await core.dispose();
  });
  it('shows genuine progress and final messages independently before settling the request', async () => {
    const judge = { judge: vi.fn(async (text: string) => (text.includes('최종') ? sad : happy)) };
    const { core, adapter, events } = fixture({ judge });
    await core.send('fixture');
    adapter.emit('turn.accepted', {});
    adapter.emit('message.complete', { text: '파일을 확인하고 있어요.', messageId: 'progress' });
    await flush();
    expect(core.current?.state).not.toBe('completed');
    adapter.emit('tool.started', { toolId: 't', name: 'read_file' });
    adapter.emit('tool.completed', { toolId: 't' });
    adapter.emit('message.complete', { text: '최종 결과입니다.', messageId: 'final' });
    await flush();
    expect(core.current?.messages).toEqual([
      { messageId: 'progress', text: '파일을 확인하고 있어요.', completed: true },
      { messageId: 'final', text: '최종 결과입니다.', completed: true },
    ]);
    expect(cueEvents(events).map((e) => e.cue.messageId)).toEqual(['progress', 'final']);
    adapter.emit('turn.completed', {});
    await flush();
    expect(core.current?.state).toBe('completed');
    expect(judge.judge).toHaveBeenCalledTimes(2);
    await core.dispose();
  });
  it('drops pending expressions on approval and judges a new message after it closes', async () => {
    const judge = { judge: vi.fn(async (_text: string, _signal: AbortSignal) => happy) };
    const { core, adapter, events } = fixture({ judge });
    await core.send('fixture');
    adapter.emit('message.delta', { text: '첫 문장. 다음 문장. 마지막 문장.', messageId: 'm' });
    await flush();
    adapter.emit('approval.requested', {
      approvalId: 'a',
      summary: 'fixture',
      expiresAt: Date.now() + 10000,
    });
    adapter.emit('message.delta', { text: '승인 대기 문장.', messageId: 'm' });
    await vi.advanceTimersByTimeAsync(3000);
    expect(judge.judge).toHaveBeenCalledTimes(1);
    expect(cueEvents(events)).toHaveLength(1);
    adapter.emit('approval.closed', { approvalId: 'a', reason: 'withdrawn' });
    adapter.emit('message.delta', { text: '새 문장.', messageId: 'after-approval' });
    await flush();
    expect(judge.judge).toHaveBeenCalledTimes(2);
    expect(judge.judge.mock.calls[1]?.[0]).toBe('새 문장.');
    await core.dispose();
  });
  it('cancels an unapplied draft decision when the final message replaces its text', async () => {
    const pending = deferred<ExpressionDecision>();
    const judge = { judge: vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(happy) };
    const { core, adapter, events } = fixture({ judge });
    await core.send('fixture');
    adapter.emit('message.delta', { text: '초안 문장.', messageId: 'm' });
    await flush();
    adapter.emit('message.complete', { text: '수정된 최종 문장.', messageId: 'm' });
    await flush();
    pending.resolve(sad);
    await flush();
    expect(cueEvents(events)).toMatchObject([{ cue: { emotion: 'happy', messageId: 'm' } }]);
    expect(judge.judge.mock.calls.map((row) => row[0])).toEqual([
      '초안 문장.',
      '수정된 최종 문장.',
    ]);
    await core.dispose();
  });
  it('deadlines/low confidence/invalid decisions fall back neutral and bound input length', async () => {
    const judge = {
      judge: vi.fn(
        (_text: string, _signal: AbortSignal) => new Promise<ExpressionDecision>(() => {}),
      ),
    };
    const { core, adapter, events } = fixture({ judge, judgeTimeoutMs: 10 });
    await core.send('fixture');
    adapter.emit('message.delta', { text: 'x'.repeat(900), messageId: 'm' });
    await flush();
    expect(judge.judge.mock.calls[0]?.[0]).toHaveLength(800);
    await vi.advanceTimersByTimeAsync(11);
    expect(cueEvents(events)[0]).toMatchObject({
      cue: { emotion: 'neutral', gesture: 'none', source: 'fallback' },
    });
    await core.dispose();
    for (const result of [
      { emotion: 'happy', gesture: 'wave', confidence: 0.1 },
      { emotion: 'execute', gesture: 'shell', confidence: 1 },
      { emotion: 'happy', gesture: 'wave', confidence: 0.9, attitude: 'execute' },
    ]) {
      const f = fixture({ judge: { judge: async () => result as ExpressionDecision } });
      await f.core.send('fixture');
      f.adapter.emit('message.complete', { text: '문장.', messageId: 'm' });
      await flush();
      expect(cueEvents(f.events)[0]).toMatchObject({
        cue: { emotion: 'neutral', source: 'fallback' },
      });
      await f.core.dispose();
    }
  });
  it('snapshot invalidates inference without rejudging recovered text, fresh delta is allowed', async () => {
    const pending = deferred<ExpressionDecision>();
    const judge = { judge: vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(happy) };
    const { core, adapter, events } = fixture({ judge });
    await core.send('fixture');
    adapter.emit('message.delta', { text: '이전 문장. ', messageId: 'm' });
    await flush();
    adapter.emit('message.snapshot', { text: '복구된 문장.', messageId: 'm' });
    pending.resolve(sad);
    await flush();
    expect(judge.judge).toHaveBeenCalledTimes(1);
    expect(cueEvents(events)).toHaveLength(0);
    adapter.emit('message.delta', { text: ' 새 문장. ', messageId: 'm' });
    await flush();
    expect(judge.judge).toHaveBeenCalledTimes(2);
    expect(core.current?.text).toBe('복구된 문장. 새 문장. ');
    await core.dispose();
  });
  it('switch/dispose drops all old character decisions and tool data never goes to judge', async () => {
    const pending = deferred<ExpressionDecision>();
    const judge = { judge: vi.fn((_text: string, _signal: AbortSignal) => pending.promise) };
    const { core, adapter, events } = fixture({ judge });
    await core.send('fixture');
    adapter.emit('tool.started', { toolId: 't', name: 'PRIVATE TOOL DATA' });
    expect(events.at(-1)).toEqual({ type: 'character', state: 'working' });
    adapter.emit('tool.completed', { toolId: 't' });
    expect(events.at(-1)).toEqual({ type: 'character', state: 'thinking' });
    adapter.emit('message.complete', { text: '표시용 답변.', messageId: 'm' });
    await flush();
    await core.dispose();
    pending.resolve(happy);
    await flush();
    expect(cueEvents(events)).toHaveLength(0);
    expect(judge.judge.mock.calls[0]?.[0]).toBe('표시용 답변.');
  });
});
