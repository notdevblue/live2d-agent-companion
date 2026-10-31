import { randomUUID } from 'node:crypto';
import {
  unsupportedCapabilities,
  type AgentAdapter,
  type AgentEvent,
  type ApprovalResponse,
  type Capabilities,
  type EventPayloads,
  type EventSink,
  type RequestRef,
  type UserTurn,
} from '../shared/contracts.js';

export interface MockAdapterOptions {
  mode?: 'normal' | 'disconnect' | 'approval';
  delayMs?: number;
  approvalTtlMs?: number;
}
interface MockRun {
  request: RequestRef;
  sink: EventSink;
  timer?: ReturnType<typeof setTimeout>;
  stage: 'running' | 'disconnected' | 'approval' | 'completed' | 'cancelled';
  approvalId?: string;
  approvalExpires?: number;
}
const RESPONSE =
  '안녕하세요! 이것은 외부 AI에 연결하지 않는 Mock 응답입니다. 캐릭터와 채팅 흐름을 확인할 수 있어요.';

/** Development fixture only; never claims Hermes/Grok identity or continuity. */
export class MockAdapter implements AgentAdapter {
  readonly provider = 'mock' as const;
  private readonly runs = new Map<string, MockRun>();
  constructor(private readonly options: MockAdapterOptions = {}) {}
  async connect(): Promise<void> {}
  async createSession(_agentId: string): Promise<{ id: string; label: string }> {
    return { id: `mock-${randomUUID()}`, label: 'Mock 테스트 세션' };
  }
  async discover(): Promise<Capabilities> {
    return {
      ...unsupportedCapabilities(),
      text: 'supported',
      streaming: 'supported',
      'attachments.image': 'supported',
      'attachments.file': 'supported',
      cancel: 'supported',
      'request.reconcile': 'supported',
      'tool.approvals': 'supported',
    };
  }
  async send(turn: UserTurn, sink: EventSink): Promise<void> {
    const mode =
      this.options.mode ??
      (turn.text.trim() === '/disconnect'
        ? 'disconnect'
        : turn.text.trim() === '/approval'
          ? 'approval'
          : 'normal');
    const run: MockRun = {
      request: {
        binding: structuredClone(turn.binding),
        turnId: turn.turnId,
        requestId: turn.requestId,
      },
      sink,
      stage: 'running',
    };
    this.runs.set(turn.requestId, run);
    this.emit(run, 'turn.accepted', { remoteRunId: `mock-${turn.requestId}` });
    if (mode === 'approval') {
      run.stage = 'approval';
      run.approvalId = randomUUID();
      run.approvalExpires = Date.now() + (this.options.approvalTtlMs ?? 30_000);
      this.emit(run, 'approval.requested', {
        approvalId: run.approvalId,
        summary: 'Mock 공급자 승인 테스트입니다. 실제 PC 작업은 수행하지 않습니다.',
        expiresAt: run.approvalExpires,
      });
      return;
    }
    this.emit(run, 'message.delta', { messageId: 'mock-answer', text: '안녕하세요! ' });
    if (mode === 'disconnect') {
      run.stage = 'disconnected';
      this.emit(run, 'turn.reconciling', { reason: 'mock_disconnect' });
      return;
    }
    run.timer = setTimeout(() => this.complete(run, false), this.options.delayMs ?? 350);
  }
  async cancel(requestId: string): Promise<'confirmed' | 'unsupported'> {
    const run = this.runs.get(requestId);
    if (!run) return 'unsupported';
    if (run.stage === 'completed') return 'unsupported';
    clearTimeout(run.timer);
    run.stage = 'cancelled';
    this.emit(run, 'turn.cancelled', { remoteConfirmed: true });
    return 'confirmed';
  }
  async respondApproval(response: ApprovalResponse): Promise<'applied' | 'closed'> {
    const run = this.runs.get(response.requestId);
    if (
      !run ||
      run.stage !== 'approval' ||
      run.approvalId !== response.approvalId ||
      run.request.turnId !== response.turnId ||
      !this.sameBinding(run.request, response)
    )
      return 'closed';
    if (!run.approvalExpires || run.approvalExpires <= Date.now()) {
      this.emit(run, 'approval.closed', { approvalId: response.approvalId, reason: 'expired' });
      return 'closed';
    }
    run.stage = 'running';
    this.emit(run, 'approval.resolved', {
      approvalId: response.approvalId,
      decision: response.decision,
    });
    if (response.decision === 'deny') {
      this.emit(run, 'message.complete', {
        messageId: 'mock-answer',
        text: 'Mock 승인이 거절되었습니다. 실제 PC 작업은 수행하지 않았습니다.',
      });
      run.stage = 'completed';
      this.emit(run, 'turn.completed', {});
    } else run.timer = setTimeout(() => this.complete(run, false), this.options.delayMs ?? 350);
    return 'applied';
  }
  async reconcile(
    request: RequestRef,
    sink: EventSink,
  ): Promise<'resumed' | 'settled' | 'unknown'> {
    const run = this.runs.get(request.requestId);
    if (!run || run.request.turnId !== request.turnId || !this.sameBinding(run.request, request))
      return 'unknown';
    run.sink = sink;
    if (run.stage === 'cancelled') {
      this.emit(run, 'turn.cancelled', { remoteConfirmed: true });
      return 'settled';
    }
    if (run.stage === 'completed' || run.stage === 'disconnected') {
      this.complete(run, true);
      return 'settled';
    }
    this.emit(run, 'turn.resumed', { state: 'accepted' });
    if (run.stage === 'approval' && run.approvalId && run.approvalExpires) {
      this.emit(
        run,
        run.approvalExpires <= Date.now() ? 'approval.closed' : 'approval.requested',
        run.approvalExpires <= Date.now()
          ? { approvalId: run.approvalId, reason: 'expired' }
          : {
              approvalId: run.approvalId,
              summary: 'Mock 공급자 승인 테스트입니다.',
              expiresAt: run.approvalExpires,
            },
      );
    }
    return 'resumed';
  }
  async disconnect(): Promise<void> {
    for (const run of this.runs.values()) {
      clearTimeout(run.timer);
      if (run.stage === 'running') run.stage = 'disconnected';
    }
  }
  private complete(run: MockRun, snapshot: boolean): void {
    if (run.stage === 'cancelled') return;
    clearTimeout(run.timer);
    run.stage = 'completed';
    if (snapshot) this.emit(run, 'message.snapshot', { messageId: 'mock-answer', text: RESPONSE });
    else this.emit(run, 'message.complete', { messageId: 'mock-answer', text: RESPONSE });
    this.emit(run, 'turn.completed', {});
  }
  private sameBinding(a: RequestRef, b: RequestRef): boolean {
    return (
      a.binding.provider === b.binding.provider &&
      a.binding.connectionId === b.binding.connectionId &&
      a.binding.agentId === b.binding.agentId &&
      a.binding.sessionId === b.binding.sessionId
    );
  }
  private emit<K extends keyof EventPayloads>(
    run: MockRun,
    type: K,
    payload: EventPayloads[K],
  ): void {
    run.sink({
      ...run.request,
      schemaVersion: 1,
      eventId: randomUUID(),
      type,
      payload,
    } as AgentEvent);
  }
}
