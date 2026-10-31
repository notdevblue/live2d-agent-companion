import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  AgentAdapter,
  AgentBinding,
  AgentEvent,
  ApprovalResponse,
  CompanionEvent,
  ExpressionJudge,
  RequestRef,
  TurnState,
  TurnView,
} from '../shared/contracts.js';
import { bindingSchema, validateAgentEvent } from '../shared/validation.js';
import { CharacterDirector } from './character-director.js';

const terminalStates = new Set<TurnState>(['completed', 'failed', 'cancelled', 'interrupted']);
const metadataSchema = z
  .object({
    version: z.literal(1),
    binding: bindingSchema,
    pending: z
      .object({
        turnId: z.string().min(1).max(512),
        requestId: z.string().min(1).max(512),
        state: z.enum([
          'submitting',
          'accepted',
          'streaming',
          'awaiting_result',
          'cancel_requested',
          'reconciling',
        ]),
        remoteRunId: z.string().max(512).optional(),
        eventIds: z.array(z.string().max(512)).max(4096),
        effectsCancelled: z.boolean(),
        approval: z
          .object({
            approvalId: z.string().min(1).max(512),
            expiresAt: z.number().finite(),
            status: z.enum(['pending', 'sending', 'unknown']),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type CoordinatorMetadata = z.infer<typeof metadataSchema>;

interface Lease {
  requestId: string;
  owner: symbol;
}
// A switch creates a new coordinator; pending leases intentionally survive disposal.
const leases = new Map<string, Lease>();
export function bindingKey(binding: AgentBinding): string {
  return JSON.stringify([
    binding.provider,
    binding.connectionId,
    binding.agentId,
    binding.sessionId,
  ]);
}
interface Approval {
  approvalId: string;
  expiresAt: number;
  summary: string;
  status: 'pending' | 'sending' | 'unknown';
}
export interface CoordinatorOptions {
  adapter: AgentAdapter;
  binding: AgentBinding;
  judge?: ExpressionJudge;
  onEvent: (event: CompanionEvent) => void;
  requestTimeoutMs?: number;
  judgeTimeoutMs?: number;
  confidenceThreshold?: number;
  beforeSubmit?: (metadata: CoordinatorMetadata) => Promise<void>;
}

export class TurnCoordinator {
  private readonly binding: AgentBinding;
  private readonly owner = Symbol('coordinator');
  private readonly director: CharacterDirector;
  private view?: TurnView;
  private readonly messages = new Map<string, string>();
  private readonly seen = new Set<string>();
  private readonly tools = new Set<string>();
  private readonly closedApprovals = new Set<string>();
  private approval?: Approval;
  private remoteRunId?: string;
  private timeout?: ReturnType<typeof setTimeout>;
  private approvalTimeout?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private effectsCancelled = false;
  private submissionStarted = false;
  private reconciling = false;
  private approvalRefreshAllowed = false;

  constructor(private readonly options: CoordinatorOptions) {
    this.binding = bindingSchema.parse(options.binding);
    if (options.adapter.provider !== this.binding.provider)
      throw new Error('공급자와 세션 바인딩이 일치하지 않습니다.');
    if (
      options.requestTimeoutMs !== undefined &&
      (!Number.isFinite(options.requestTimeoutMs) ||
        options.requestTimeoutMs < 1 ||
        options.requestTimeoutMs > 2_147_483_647)
    )
      throw new Error('유효하지 않은 응답 제한 시간입니다.');
    this.director = new CharacterDirector(options);
  }

  get current(): TurnView | undefined {
    return this.view ? structuredClone(this.view) : undefined;
  }

  async send(text: string): Promise<void> {
    this.assertActive();
    if (typeof text !== 'string' || !text.trim() || text.length > 32_000)
      throw new Error('메시지는 1~32000자여야 합니다.');
    if (leases.has(bindingKey(this.binding)) || (this.view && !terminalStates.has(this.view.state)))
      throw new Error('이 세션의 이전 요청 상태를 먼저 확인해야 합니다.');
    const request: RequestRef = {
      binding: { ...this.binding },
      turnId: randomUUID(),
      requestId: randomUUID(),
    };
    leases.set(bindingKey(this.binding), { requestId: request.requestId, owner: this.owner });
    this.view = { ...request, state: 'submitting', text: '' };
    this.messages.clear();
    this.seen.clear();
    this.tools.clear();
    this.closedApprovals.clear();
    this.approval = undefined;
    this.remoteRunId = undefined;
    this.effectsCancelled = false;
    this.submissionStarted = false;
    this.director.begin(request.requestId);
    this.publish();
    try {
      await this.options.beforeSubmit?.(this.snapshot());
    } catch {
      if (this.owns(request.requestId) && !this.isTerminal())
        this.finish(
          'failed',
          '요청 상태를 안전하게 저장하지 못해 원격 요청을 전송하지 않았습니다.',
        );
      return;
    }
    if (!this.owns(request.requestId) || this.isTerminal() || this.effectsCancelled) return;
    this.submissionStarted = true;
    this.armTimeout();
    try {
      await this.options.adapter.send({ ...request, text }, (event) => this.receive(event));
    } catch {
      // Transport failure cannot prove that a remote submission was not accepted.
      if (this.owns(request.requestId) && !this.isTerminal())
        this.markReconciling('연결이 끊겨 원격 실행 상태를 확인해야 합니다.');
    }
  }

  async cancel(): Promise<void> {
    this.assertActive();
    if (!this.view || this.isTerminal()) return;
    if (!this.owns(this.view.requestId)) throw new Error('현재 요청 소유권이 없습니다.');
    const requestId = this.view.requestId;
    this.effectsCancelled = true;
    if (!this.submissionStarted) {
      this.director.invalidate();
      this.finish('failed', '전송 전에 요청을 중단하여 원격 실행을 시작하지 않았습니다.');
      return;
    }
    this.director.invalidate();
    this.view.state = 'cancel_requested';
    this.publish();
    try {
      const result = (await this.options.adapter.cancel?.(requestId)) ?? 'unsupported';
      if (!this.owns(requestId) || this.isTerminal()) return;
      if (result === 'confirmed') this.finish('cancelled');
      else {
        this.view.error =
          result === 'unsupported'
            ? '원격 중단 미지원: 로컬 표현만 중단했으며 원격 종료는 확인되지 않았습니다.'
            : '원격 중단 확인을 기다리고 있습니다.';
        this.publish();
        this.armTimeout();
      }
    } catch {
      if (this.owns(requestId) && !this.isTerminal())
        this.markReconciling('원격 중단 적용 여부를 확인할 수 없습니다.');
    }
  }

  async reconcile(): Promise<void> {
    this.assertActive();
    if (!this.view || this.isTerminal() || this.reconciling) return;
    if (!this.owns(this.view.requestId)) throw new Error('현재 요청 소유권이 없습니다.');
    const request = this.requestRef();
    this.markReconciling('기존 요청의 원격 상태를 확인하고 있습니다.');
    this.reconciling = true;
    try {
      await this.options.adapter.reconcile?.(request, (event) => this.receive(event));
      // Only a correlated event can confirm progress/termination, never this return value.
    } catch {
      if (this.owns(request.requestId) && !this.isTerminal())
        this.markReconciling('원격 상태 확인에 실패했습니다. 새 요청은 전송하지 않았습니다.');
    } finally {
      this.reconciling = false;
    }
  }

  async approve(approvalId: string, decision: ApprovalResponse['decision']): Promise<void> {
    this.assertActive();
    if (decision !== 'allow_once' && decision !== 'deny')
      throw new Error('유효하지 않은 승인 응답입니다.');
    if (
      !this.view ||
      !this.owns(this.view.requestId) ||
      this.isTerminal() ||
      !this.approval ||
      this.approval.approvalId !== approvalId ||
      this.approval.status !== 'pending'
    )
      throw new Error('응답할 수 없는 공급자 승인입니다.');
    if (this.approval.expiresAt <= Date.now()) {
      this.closeApproval(approvalId);
      throw new Error('승인이 만료되었습니다.');
    }
    if (!this.options.adapter.respondApproval)
      throw new Error('이 공급자는 승인 응답을 지원하지 않습니다.');
    const request = this.requestRef();
    this.approval.status = 'sending';
    try {
      const result = await this.options.adapter.respondApproval({
        ...request,
        approvalId,
        decision,
      });
      if (
        !this.owns(request.requestId) ||
        !this.approval ||
        this.approval.approvalId !== approvalId
      )
        return;
      if (result === 'applied' || result === 'closed') this.closeApproval(approvalId);
      else {
        this.approval.status = 'unknown';
        this.markReconciling('승인 응답 적용 여부가 불명확합니다. 자동 재전송하지 않습니다.');
      }
    } catch {
      if (this.owns(request.requestId) && this.approval?.approvalId === approvalId) {
        this.approval.status = 'unknown';
        this.markReconciling('승인 응답 적용 여부가 불명확합니다. 자동 재전송하지 않습니다.');
      }
    }
  }

  snapshot(): CoordinatorMetadata {
    const metadata: CoordinatorMetadata = { version: 1, binding: { ...this.binding } };
    if (this.view && !this.isTerminal()) {
      metadata.pending = {
        turnId: this.view.turnId,
        requestId: this.view.requestId,
        state: this.view.state as NonNullable<CoordinatorMetadata['pending']>['state'],
        eventIds: [...this.seen],
        effectsCancelled: this.effectsCancelled,
      };
      if (this.remoteRunId) metadata.pending.remoteRunId = this.remoteRunId;
      if (this.approval)
        metadata.pending.approval = {
          approvalId: this.approval.approvalId,
          expiresAt: this.approval.expiresAt,
          status: this.approval.status,
        };
    }
    return metadata;
  }

  restore(input: CoordinatorMetadata): void {
    this.assertActive();
    if (this.view) throw new Error('이미 요청이 있는 coordinator에는 복원할 수 없습니다.');
    const metadata = metadataSchema.parse(input);
    if (bindingKey(metadata.binding) !== bindingKey(this.binding))
      throw new Error('다른 세션의 요청을 복원할 수 없습니다.');
    const pending = metadata.pending;
    if (!pending) return;
    const lease = leases.get(bindingKey(this.binding));
    if (lease && lease.requestId !== pending.requestId)
      throw new Error('이 세션에 다른 미종결 요청이 있습니다.');
    leases.set(bindingKey(this.binding), { requestId: pending.requestId, owner: this.owner });
    this.view = {
      binding: { ...this.binding },
      turnId: pending.turnId,
      requestId: pending.requestId,
      state: 'reconciling',
      text: '',
      error: '재시작 전에 진행 중이던 요청입니다. 원격 상태 확인이 필요합니다.',
    };
    this.remoteRunId = pending.remoteRunId;
    this.submissionStarted = true;
    this.effectsCancelled = pending.effectsCancelled;
    for (const id of pending.eventIds) this.seen.add(id);
    this.director.begin(pending.requestId);
    if (this.effectsCancelled) this.director.invalidate();
    if (pending.approval && pending.approval.expiresAt > Date.now()) {
      this.approval = {
        ...pending.approval,
        summary: '복원된 공급자 승인: 원격 상태를 확인하세요.',
        status: 'unknown',
      };
      this.view.approval = {
        approvalId: this.approval.approvalId,
        expiresAt: this.approval.expiresAt,
        summary: this.approval.summary,
      };
      this.armApprovalExpiry();
    }
    this.publish();
  }

  async dispose(): Promise<void> {
    if (
      !this.submissionStarted &&
      this.view &&
      !this.isTerminal() &&
      this.owns(this.view.requestId)
    ) {
      this.director.invalidate();
      this.finish('failed', '전송 전에 연결을 닫아 원격 실행을 시작하지 않았습니다.');
    }
    this.disposed = true;
    clearTimeout(this.timeout);
    clearTimeout(this.approvalTimeout);
    this.director.invalidate();
    // Persist snapshot before dispose. Disconnect is not a remote cancellation.
    await this.options.adapter.disconnect();
  }

  private receive(input: unknown): void {
    const event = validateAgentEvent(input);
    if (
      !event ||
      !this.view ||
      !this.owns(event.requestId) ||
      event.turnId !== this.view.turnId ||
      bindingKey(event.binding) !== bindingKey(this.binding) ||
      this.isTerminal() ||
      this.seen.has(event.eventId)
    )
      return;
    if (
      this.seen.size >= 4096 &&
      !['turn.completed', 'turn.failed', 'turn.cancelled', 'turn.interrupted'].includes(event.type)
    ) {
      if (this.view.state !== 'reconciling')
        this.markReconciling('이벤트 추적 한도에 도달했습니다. 원격 종료 확인이 필요합니다.');
      return;
    }
    if (this.seen.size < 4096) this.seen.add(event.eventId);
    this.apply(event);
  }

  private apply(event: AgentEvent): void {
    const view = this.view!;
    switch (event.type) {
      case 'turn.accepted':
        this.remoteRunId = event.payload.remoteRunId;
        if (view.state === 'submitting') view.state = 'accepted';
        break;
      case 'turn.awaiting_result':
        if (view.state !== 'cancel_requested') view.state = 'awaiting_result';
        break;
      case 'turn.reconciling':
        this.markReconciling('연결이 끊겨 원격 실행 상태를 확인해야 합니다.');
        return;
      case 'turn.resumed':
        this.approvalRefreshAllowed = true;
        view.state = this.effectsCancelled ? 'cancel_requested' : event.payload.state;
        delete view.error;
        break;
      case 'message.delta': {
        const old = this.messages.get(event.payload.messageId) ?? '';
        if (old.length + event.payload.text.length > 1_000_000) {
          this.markReconciling('응답 크기 제한에 도달했습니다. 원격 상태를 확인하세요.');
          return;
        }
        this.messages.set(event.payload.messageId, old + event.payload.text);
        if (view.state !== 'cancel_requested') view.state = 'streaming';
        this.syncText();
        this.publish();
        this.director.append(event.payload.text);
        this.armTimeout();
        return;
      }
      case 'message.snapshot':
        this.messages.set(event.payload.messageId, event.payload.text);
        this.syncText();
        this.director.replaceSnapshot();
        break;
      case 'message.complete': {
        const old = this.messages.get(event.payload.messageId) ?? '';
        this.messages.set(event.payload.messageId, event.payload.text);
        this.syncText();
        this.publish();
        this.director.append(
          event.payload.text.startsWith(old)
            ? event.payload.text.slice(old.length)
            : event.payload.text,
          true,
        );
        this.armTimeout();
        return;
      }
      case 'tool.started':
        this.tools.add(event.payload.toolId);
        break;
      case 'tool.completed':
        this.tools.delete(event.payload.toolId);
        break;
      case 'approval.requested':
        if (
          this.closedApprovals.has(event.payload.approvalId) ||
          event.payload.expiresAt <= Date.now()
        )
          return;
        if (
          this.approval?.approvalId === event.payload.approvalId &&
          !(this.approvalRefreshAllowed && this.approval.status === 'unknown')
        )
          return;
        this.approvalRefreshAllowed = false;
        this.approval = { ...event.payload, status: 'pending' };
        view.approval = { ...event.payload };
        this.armApprovalExpiry();
        break;
      case 'approval.resolved':
      case 'approval.closed':
        this.closeApproval(event.payload.approvalId);
        return;
      case 'turn.completed':
        this.director.append('', true);
        this.finish('completed');
        return;
      case 'turn.failed':
        this.finish('failed', event.payload.safeMessage);
        return;
      case 'turn.cancelled':
        this.effectsCancelled = true;
        this.director.invalidate();
        this.finish('cancelled');
        return;
      case 'turn.interrupted':
        this.effectsCancelled = true;
        this.director.invalidate();
        this.finish('interrupted');
        return;
    }
    this.publish();
    this.armTimeout();
  }

  private closeApproval(approvalId: string): void {
    this.closedApprovals.add(approvalId);
    if (!this.approval || this.approval.approvalId !== approvalId || !this.view) return;
    this.approval = undefined;
    delete this.view.approval;
    clearTimeout(this.approvalTimeout);
    this.publish();
  }
  private armApprovalExpiry(): void {
    clearTimeout(this.approvalTimeout);
    if (this.approval)
      this.approvalTimeout = setTimeout(
        () => {
          if (!this.approval) return;
          if (this.approval.expiresAt > Date.now()) this.armApprovalExpiry();
          else this.closeApproval(this.approval.approvalId);
        },
        Math.min(2_147_483_647, Math.max(0, this.approval.expiresAt - Date.now())),
      );
  }
  private syncText(): void {
    this.view!.text = [...this.messages.values()].join('\n\n');
  }
  private isTerminal(): boolean {
    return !!this.view && terminalStates.has(this.view.state);
  }
  private owns(requestId: string): boolean {
    const lease = leases.get(bindingKey(this.binding));
    return (
      !this.disposed &&
      !!this.view &&
      this.view.requestId === requestId &&
      lease?.requestId === requestId &&
      lease.owner === this.owner
    );
  }
  private finish(state: TurnState, error?: string): void {
    if (!this.view || this.isTerminal()) return;
    clearTimeout(this.timeout);
    clearTimeout(this.approvalTimeout);
    this.view.state = state;
    if (state === 'failed') this.director.invalidate();
    if (error) this.view.error = error;
    else delete this.view.error;
    this.approval = undefined;
    delete this.view.approval;
    this.tools.clear();
    const lease = leases.get(bindingKey(this.binding));
    if (lease?.owner === this.owner) leases.delete(bindingKey(this.binding));
    this.publish();
  }
  private markReconciling(error: string): void {
    if (!this.view || this.isTerminal()) return;
    clearTimeout(this.timeout);
    this.view.state = 'reconciling';
    this.view.error = error;
    this.director.replaceSnapshot();
    this.publish();
  }
  private armTimeout(): void {
    clearTimeout(this.timeout);
    if (this.disposed || !this.view || this.isTerminal() || this.view.state === 'reconciling')
      return;
    this.timeout = setTimeout(
      () =>
        this.markReconciling(
          '응답 대기 시간이 초과되었습니다. 원격 실행은 종료 확인되지 않았습니다.',
        ),
      this.options.requestTimeoutMs ?? 30_000,
    );
  }
  private requestRef(): RequestRef {
    return {
      binding: { ...this.binding },
      turnId: this.view!.turnId,
      requestId: this.view!.requestId,
    };
  }
  private publish(): void {
    if (this.disposed || !this.view) return;
    this.options.onEvent({ type: 'turn', turn: structuredClone(this.view) });
    this.director.updateState(this.view.state, this.tools.size > 0);
  }
  private assertActive(): void {
    if (this.disposed) throw new Error('종료된 coordinator입니다.');
  }
}
