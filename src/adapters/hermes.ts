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
import {
  boundedString,
  endpoint,
  object,
  request,
  requestJson,
  sseFrames,
  TransportError,
  type TransportOptions,
} from './transport.js';

interface PendingApproval {
  id: string;
  expiresAt: number;
  generation?: number;
  responding: boolean;
}
interface Run {
  ref: RequestRef;
  remoteId?: string;
  sink: EventSink;
  sequence: number;
  controller?: AbortController;
  terminal: boolean;
  text: string;
  approvals: Map<string, PendingApproval>;
}
/** Hermes /v1/runs adapter for API-owned sessions, not canonical Desktop/Bot Chat binding. */
export class HermesAdapter implements AgentAdapter {
  readonly provider = 'hermes' as const;
  private runs = new Map<string, Run>();
  private capabilities: Capabilities = unsupportedCapabilities();
  constructor(private readonly options: TransportOptions) {
    endpoint(options.endpoint);
  }
  async connect(): Promise<void> {
    await this.discover();
  }
  async discover(): Promise<Capabilities> {
    const body = await requestJson(this.options, '/v1/capabilities');
    const features = object(body.features);
    if (
      features.run_submission !== true ||
      features.run_status !== true ||
      features.run_events_sse !== true
    )
      throw new TransportError('capabilities', 'Hermes Runs API를 지원하는 서버가 필요합니다.');
    this.capabilities = {
      ...unsupportedCapabilities(),
      text: 'supported',
      streaming: 'supported',
      'request.reconcile': 'supported',
      'session.resume': 'experimental',
      cancel: features.run_stop === true ? 'supported' : 'unsupported',
      'tool.events': features.tool_progress_events === true ? 'supported' : 'unsupported',
      'tool.approvals':
        features.approval_events === true && features.run_approval_response === true
          ? 'supported'
          : 'unsupported',
    };
    return { ...this.capabilities };
  }
  async disconnect(): Promise<void> {
    for (const run of this.runs.values()) {
      if (!run.terminal)
        this.emit(run, 'turn.reconciling', {
          reason: '연결을 닫았습니다. 원격 실행은 계속될 수 있습니다.',
        });
      run.controller?.abort();
    }
  }
  async send(turn: UserTurn, sink: EventSink): Promise<void> {
    if (turn.attachments?.length)
      throw new Error('이 연결은 첨부를 지원하지 않습니다. Hermes SSH 연결을 사용하세요.');
    boundedString(turn.text, 32_000);
    this.validateRef(turn);
    if (this.runs.has(turn.requestId))
      throw new Error('이미 제출한 요청입니다. 상태 복구를 사용하세요.');
    if (this.runs.size >= 256) {
      for (const [id, run] of this.runs) if (run.terminal) this.runs.delete(id);
      if (this.runs.size >= 256)
        throw new Error('미확정 요청이 너무 많습니다. 기존 요청 상태를 확인하세요.');
    }
    const run: Run = {
      ref: structuredClone({
        binding: turn.binding,
        requestId: turn.requestId,
        turnId: turn.turnId,
      }),
      sink,
      sequence: -1,
      terminal: false,
      text: '',
      approvals: new Map(),
    };
    this.runs.set(turn.requestId, run);
    const submission = new AbortController();
    run.controller = submission;
    try {
      const accepted = await requestJson(
        this.options,
        '/v1/runs',
        {
          method: 'POST',
          headers: { 'Idempotency-Key': turn.requestId },
          body: JSON.stringify({ input: turn.text, session_id: turn.binding.sessionId }),
        },
        submission.signal,
      );
      run.remoteId = boundedString(accepted.run_id, 256);
      if (!run.remoteId)
        throw new TransportError('invalid_response', 'Hermes 실행 식별자가 없습니다.');
      this.emit(run, 'turn.accepted', { remoteRunId: run.remoteId });
      if (submission.signal.aborted)
        this.emit(run, 'turn.reconciling', {
          reason: '연결이 닫혔습니다. 원격 상태를 복구하세요.',
        });
      else this.subscribe(run);
    } catch (error) {
      if (
        error instanceof TransportError &&
        (['credentials', 'endpoint'].includes(error.code) ||
          [400, 401, 403, 404, 405, 413, 415, 422, 429].includes(error.status ?? 0))
      ) {
        this.emit(run, 'turn.failed', { code: 'submission_rejected', safeMessage: error.message });
      } else
        this.emit(run, 'turn.reconciling', {
          reason: '제출 결과를 확인할 수 없습니다. 같은 요청을 자동 재전송하지 않습니다.',
        });
    }
  }
  /** Persist remoteRunId from turn.accepted externally; restoration never submits a new run. */
  restore(requestRef: RequestRef, remoteRunId: string, sink: EventSink): void {
    this.validateRef(requestRef);
    boundedString(remoteRunId, 256);
    if (!remoteRunId || this.runs.has(requestRef.requestId))
      throw new Error('복구할 실행 식별자가 올바르지 않습니다.');
    this.runs.set(requestRef.requestId, {
      ref: structuredClone(requestRef),
      remoteId: remoteRunId,
      sink,
      sequence: -1,
      terminal: false,
      text: '',
      approvals: new Map(),
    });
  }
  async reconcile(ref: RequestRef, sink: EventSink): Promise<'resumed' | 'settled' | 'unknown'> {
    const run = this.boundRun(ref);
    if (!run?.remoteId) return 'unknown';
    run.controller?.abort();
    run.controller = undefined;
    run.sink = sink;
    try {
      const status = await this.status(run);
      if (run.terminal) return 'settled';
      if (
        !['running', 'queued', 'started', 'waiting_for_approval', 'stopping'].includes(
          String(status.status),
        )
      )
        return 'unknown';
      this.emit(run, 'turn.resumed', {
        state: status.status === 'stopping' ? 'cancel_requested' : 'accepted',
      });
      this.restoreApprovals(run, status);
      this.subscribe(run);
      return 'resumed';
    } catch {
      this.emit(run, 'turn.reconciling', { reason: 'Hermes 원격 상태를 확인할 수 없습니다.' });
      return 'unknown';
    }
  }
  async cancel(requestId: string): Promise<'confirmed' | 'requested' | 'unsupported'> {
    const run = this.runs.get(requestId);
    if (!run?.remoteId || this.capabilities.cancel === 'unsupported') return 'unsupported';
    try {
      const status = await requestJson(this.options, this.path(run, '/stop'), {
        method: 'POST',
        body: '{}',
      });
      this.validateStatus(run, status);
      this.terminal(run, status);
      return status.status === 'cancelled' ? 'confirmed' : 'requested';
    } catch {
      this.emit(run, 'turn.reconciling', { reason: '원격 중단 여부를 확인할 수 없습니다.' });
      return 'requested';
    }
  }
  async respondApproval(response: ApprovalResponse): Promise<'applied' | 'closed' | 'unknown'> {
    const run = this.boundRun(response);
    let approval = run?.approvals.get(response.approvalId);
    if (!run || run.terminal || !approval || approval.expiresAt <= Date.now()) return 'closed';
    if (approval.responding) return 'unknown';
    approval.responding = true;
    try {
      // Refresh authority generation and live prompt before applying any choice.
      const status = await this.status(run);
      this.restoreApprovals(run, status);
      approval = run.approvals.get(response.approvalId);
      if (run.terminal || !approval || approval.expiresAt <= Date.now()) return 'closed';
      const result = await requestJson(this.options, this.path(run, '/approval'), {
        method: 'POST',
        body: JSON.stringify({
          request_id: approval.id,
          choice: response.decision === 'allow_once' ? 'once' : 'deny',
          ...(approval.generation === undefined
            ? {}
            : { execution_generation: approval.generation }),
        }),
      });
      if (result.run_id !== run.remoteId) return 'unknown';
      if (result.status === 'already_resolved') {
        run.approvals.delete(response.approvalId);
        this.emit(run, 'approval.closed', {
          approvalId: response.approvalId,
          reason: '이미 처리된 원격 승인입니다.',
        });
        return 'closed';
      }
      if (!(
        (typeof result.resolved === 'number' && result.resolved > 0) ||
        (result.status === 'resolved' && result.prompt_id === response.approvalId)
      ))
        return 'unknown';
      run.approvals.delete(response.approvalId);
      this.emit(run, 'approval.resolved', {
        approvalId: response.approvalId,
        decision: response.decision,
      });
      return 'applied';
    } catch (error) {
      if (error instanceof TransportError && error.status === 409) {
        run.approvals.delete(response.approvalId);
        this.emit(run, 'approval.closed', {
          approvalId: response.approvalId,
          reason: '공급자가 승인을 종료했거나 세대가 변경되었습니다.',
        });
        return 'closed';
      }
      return 'unknown'; // Keep responding=true: uncertain decisions must never be blindly retransmitted.
    }
  }
  private validateRef(ref: RequestRef): void {
    if (
      ref.binding.provider !== this.provider ||
      !ref.binding.sessionId ||
      !ref.requestId ||
      !ref.turnId
    )
      throw new Error('Hermes 요청 바인딩이 올바르지 않습니다.');
    boundedString(ref.binding.sessionId, 256);
    boundedString(ref.requestId, 255);
    if (!/^[\x21-\x7e]+$/.test(ref.requestId)) throw new Error('요청 식별자가 올바르지 않습니다.');
  }
  private boundRun(ref: RequestRef): Run | undefined {
    const run = this.runs.get(ref.requestId);
    const a = run?.ref.binding;
    const b = ref.binding;
    return run &&
      run.ref.turnId === ref.turnId &&
      a?.provider === b.provider &&
      a.connectionId === b.connectionId &&
      a.agentId === b.agentId &&
      a.sessionId === b.sessionId
      ? run
      : undefined;
  }
  private path(run: Run, suffix = ''): string {
    return `/v1/runs/${encodeURIComponent(run.remoteId ?? '')}${suffix}`;
  }
  private emit<K extends keyof EventPayloads>(run: Run, type: K, payload: EventPayloads[K]): void {
    if (run.terminal) return;
    run.sink({ ...run.ref, schemaVersion: 1, eventId: randomUUID(), type, payload } as AgentEvent);
    if (['turn.completed', 'turn.failed', 'turn.cancelled', 'turn.interrupted'].includes(type)) {
      run.terminal = true;
      run.controller?.abort();
      run.approvals.clear();
    }
  }
  private validateStatus(run: Run, body: Record<string, unknown>): void {
    if (
      body.run_id !== run.remoteId ||
      typeof body.status !== 'string' ||
      (body.session_id !== undefined && body.session_id !== run.ref.binding.sessionId)
    )
      throw new TransportError(
        'binding',
        'Hermes 응답의 세션 또는 실행 식별자가 일치하지 않습니다.',
      );
  }
  private async status(run: Run): Promise<Record<string, unknown>> {
    const status = await requestJson(this.options, this.path(run));
    this.validateStatus(run, status);
    this.terminal(run, status);
    return status;
  }
  private terminal(run: Run, body: Record<string, unknown>): void {
    if (body.status === 'completed') {
      if (body.completed === false || body.partial === true || body.interrupted === true)
        throw new TransportError('invalid_terminal', 'Hermes 완료 상태가 일관되지 않습니다.');
      const text = boundedString(body.output);
      this.emit(run, 'message.complete', { text, messageId: run.remoteId! });
      this.emit(run, 'turn.completed', {});
    } else if (body.status === 'cancelled')
      this.emit(run, 'turn.cancelled', { remoteConfirmed: true });
    else if (body.status === 'interrupted')
      this.emit(run, 'turn.interrupted', { reason: 'Hermes 원격 실행이 중단되었습니다.' });
    else if (body.status === 'failed')
      this.emit(run, 'turn.failed', {
        code: 'remote_failed',
        safeMessage: 'Hermes 원격 실행이 실패했습니다.',
      });
  }
  private restoreApprovals(run: Run, status: Record<string, unknown>): void {
    const controls = Array.isArray(status.pending_controls)
      ? status.pending_controls.filter((item) => object(item).kind === 'approval')
      : status.approval
        ? [status.approval]
        : [];
    const alive = new Set<string>();
    for (const raw of controls) {
      const body = object(raw);
      const approval = this.approval(run, body, status.execution_generation);
      if (approval) alive.add(approval.id);
    }
    for (const [id] of run.approvals)
      if (!alive.has(id)) {
        run.approvals.delete(id);
        this.emit(run, 'approval.closed', {
          approvalId: id,
          reason: '공급자의 대기 승인 목록에서 종료되었습니다.',
        });
      }
  }
  private approval(
    run: Run,
    body: Record<string, unknown>,
    generation?: unknown,
  ): PendingApproval | undefined {
    const id = body.prompt_id ?? body.request_id;
    if (typeof id !== 'string' || !id || id.length > 256 || run.approvals.size >= 32) return;
    const existing = run.approvals.get(id);
    const value = body.execution_generation ?? generation;
    const approval: PendingApproval = {
      id,
      expiresAt: existing?.expiresAt ?? Date.now() + 60_000,
      responding: existing?.responding ?? false,
      ...(Number.isSafeInteger(value) ? { generation: value as number } : {}),
    };
    run.approvals.set(id, approval);
    if (!existing)
      this.emit(run, 'approval.requested', {
        approvalId: id,
        summary: `Hermes 원격 도구 승인: ${typeof body.description === 'string' && body.description ? body.description.slice(0, 2000) : typeof body.command === 'string' ? body.command.slice(0, 2000) : '작업 설명이 없습니다. 거절 후 원격에서 확인하세요.'}`,
        expiresAt: approval.expiresAt,
      });
    return approval;
  }
  private subscribe(run: Run): void {
    run.controller?.abort();
    const controller = new AbortController();
    run.controller = controller;
    void this.stream(run, controller).catch(() => {
      if (run.controller === controller && !run.terminal)
        this.emit(run, 'turn.reconciling', {
          reason: 'Hermes 이벤트 연결이 끊겼습니다. 원격 상태 복구가 필요합니다.',
        });
    });
  }
  private async stream(run: Run, controller: AbortController): Promise<void> {
    const { response, dispose } = await request(
      { ...this.options, timeoutMs: this.options.timeoutMs ?? 120_000 },
      this.path(run, '/events'),
      { headers: run.sequence >= 0 ? { 'Last-Event-ID': String(run.sequence) } : {} },
      controller.signal,
    );
    try {
      for await (const frame of sseFrames(response)) {
        if (run.controller !== controller || controller.signal.aborted || run.terminal) return;
        const body = object(JSON.parse(frame.data));
        if (body.run_id !== run.remoteId)
          throw new TransportError('binding', '이벤트 실행 식별자가 일치하지 않습니다.');
        if (body.event === 'replay.truncated')
          throw new TransportError(
            'replay_gap',
            '이벤트 재생 범위를 벗어났습니다. 원격 상태를 확인하세요.',
          );
        const sequence = body.seq ?? (frame.id === undefined ? undefined : Number(frame.id));
        if (!Number.isSafeInteger(sequence) || (sequence as number) < 0)
          throw new TransportError('sequence', '이벤트 순서 식별자가 올바르지 않습니다.');
        if ((sequence as number) <= run.sequence) continue;
        if (run.sequence >= 0 && sequence !== run.sequence + 1)
          throw new TransportError('sequence', '이벤트가 누락되어 상태 확인이 필요합니다.');
        run.sequence = sequence as number;
        if (body.event === 'message.delta') {
          const text = boundedString(body.delta, 64_000);
          run.text += text;
          if (run.text.length > 1_000_000)
            throw new TransportError('response_size', '응답 크기 제한을 초과했습니다.');
          this.emit(run, 'message.delta', { text, messageId: run.remoteId! });
        } else if (body.event === 'tool.started')
          this.emit(run, 'tool.started', {
            toolId: boundedString(body.tool_call_id ?? body.call_id ?? body.tool, 256),
            name: boundedString(body.tool, 256),
          });
        else if (body.event === 'tool.completed')
          this.emit(run, 'tool.completed', {
            toolId: boundedString(body.tool_call_id ?? body.call_id ?? body.tool, 256),
          });
        else if (body.event === 'approval.request') this.approval(run, body);
        else if (
          body.event === 'approval.closed' ||
          body.event === 'approval.settled' ||
          body.event === 'approval.responded'
        ) {
          const id = body.prompt_id ?? body.request_id;
          if (typeof id === 'string' && run.approvals.delete(id))
            this.emit(run, 'approval.closed', {
              approvalId: id,
              reason: '원격 승인 요청이 종료되었습니다.',
            });
        } else if (
          typeof body.event === 'string' &&
          /^run\.(completed|cancelled|failed|interrupted)$/.test(body.event)
        )
          this.terminal(run, { ...body, status: body.event.slice(4) });
      }
      if (!run.terminal && !controller.signal.aborted)
        throw new TransportError('sse_end', '완료 확인 전에 이벤트 연결이 종료되었습니다.');
    } finally {
      dispose();
    }
  }
}
