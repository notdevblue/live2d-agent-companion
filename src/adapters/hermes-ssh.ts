import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFile } from 'node:fs/promises';
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
import { boundedString, object, TransportError } from './transport.js';
import { parseSshTarget } from '../shared/validation.js';

export interface NativeBridge {
  profileId?: string;
  start(): Promise<void>;
  close(): Promise<void>;
  request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
  onEvent: (frame: Record<string, unknown>) => void;
  onDisconnect: () => void;
}
export interface HermesSshOptions {
  endpoint: string;
  profile?: string;
  bridgePath?: string;
  timeoutMs?: number;
  bridge?: NativeBridge;
}
export function sshTarget(value: string): string {
  return parseSshTarget(value);
}
/** Fixed SSH command; all profile, session and prompt values travel exclusively over JSON stdin. */
export class SshNativeBridge implements NativeBridge {
  profileId?: string;
  onEvent: (frame: Record<string, unknown>) => void = () => undefined;
  onDisconnect: () => void = () => undefined;
  private process?: ChildProcessWithoutNullStreams;
  private waiting = new Map<
    number,
    {
      resolve(value: Record<string, unknown>): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private nextId = 0;
  private startPromise?: Promise<void>;
  constructor(private readonly options: HermesSshOptions) {
    sshTarget(options.endpoint);
  }
  async start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.launch().catch((error) => {
      this.startPromise = undefined;
      throw error;
    });
    return this.startPromise;
  }
  private async launch(): Promise<void> {
    const profile = this.options.profile ?? 'default';
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(profile))
      throw new Error('Hermes 프로필 이름이 올바르지 않습니다.');
    const script = await readFile(
      this.options.bridgePath ?? new URL('../../scripts/hermes-bridge.py', import.meta.url),
      'utf8',
    );
    // SSH invokes the fixed remote command through a login shell. Only repository code is shell-quoted.
    const command = `python3 -u -c '${script.replaceAll("'", "'\\''")}'`;
    const child = spawn(
      'ssh',
      [
        '-T',
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=10',
        '-o',
        'ServerAliveInterval=15',
        '-o',
        'ServerAliveCountMax=2',
        '--',
        sshTarget(this.options.endpoint),
        command,
      ],
      { stdio: 'pipe' },
    );
    this.process = child;
    let pending = '';
    let ready = false;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('Hermes SSH 연결 대기 시간이 초과되었습니다.'));
      }, this.options.timeoutMs ?? 20_000);
      const fail = () => {
        clearTimeout(timeout);
        if (!ready)
          reject(
            new Error('Hermes SSH 연결에 실패했습니다. SSH 키와 원격 게이트웨이를 확인하세요.'),
          );
        if (this.process === child) {
          this.process = undefined;
          this.startPromise = undefined;
          this.failPending();
          this.onDisconnect();
        }
      };
      child.on('error', fail);
      child.on('close', fail);
      child.stderr.resume();
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        pending += chunk;
        if (pending.length > 1_100_000) {
          child.kill();
          return;
        }
        let boundary: number;
        while ((boundary = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, boundary);
          pending = pending.slice(boundary + 1);
          try {
            const message = object(JSON.parse(line));
            if (message.kind === 'ready') {
              if (message.profile !== profile || message.protocol !== 'hermes-gateway-v1') {
                child.kill();
                return;
              }
              this.profileId = boundedString(message.profileId, 4096);
              ready = true;
              clearTimeout(timeout);
              resolve();
            } else if (message.kind === 'response' && typeof message.id === 'number') {
              const entry = this.waiting.get(message.id);
              if (!entry) continue;
              this.waiting.delete(message.id);
              clearTimeout(entry.timer);
              if (message.error) {
                const reason = object(message.error).reason;
                entry.reject(
                  new TransportError(
                    [
                      'invalid_params',
                      'permission_denied',
                      'profile_mismatch',
                      'not_found',
                    ].includes(String(reason))
                      ? 'native_rejected'
                      : 'native_rpc_refused',
                    'Hermes가 요청을 거절했습니다.',
                  ),
                );
              } else entry.resolve(object(message.result));
            } else if (message.kind === 'event') this.onEvent(object(message.frame));
            else if (message.kind === 'error') child.kill();
          } catch {
            child.kill();
            return;
          }
        }
      });
      child.stdin.write(JSON.stringify({ profile }) + '\n');
    });
  }
  async request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.start();
    const child = this.process;
    if (!child || this.waiting.size >= 32) throw new Error('Hermes 연결을 사용할 수 없습니다.');
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(
          new TransportError(
            'native_timeout',
            'Hermes 응답 대기 시간이 초과되었습니다. 원격 실행은 계속될 수 있습니다.',
          ),
        );
      }, this.options.timeoutMs ?? 30_000);
      this.waiting.set(id, { resolve, reject, timer });
      const body = JSON.stringify({ id, method, params });
      if (body.length > 100_000) {
        clearTimeout(timer);
        this.waiting.delete(id);
        reject(new Error('요청 크기 제한을 초과했습니다.'));
        return;
      }
      child.stdin.write(body + '\n', (error) => {
        if (error) {
          clearTimeout(timer);
          this.waiting.delete(id);
          reject(new Error('Hermes 연결이 끊겼습니다.'));
        }
      });
    });
  }
  async close(): Promise<void> {
    this.process?.stdin.end();
    this.failPending();
    this.startPromise = undefined;
  }
  private failPending(): void {
    for (const entry of this.waiting.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Hermes 연결이 끊겼습니다. 원격 상태 복구가 필요합니다.'));
    }
    this.waiting.clear();
  }
}
interface NativeRun {
  ref: RequestRef;
  sink: EventSink;
  admissionId?: string;
  generation?: number;
  terminal: boolean;
  sequence: number;
  epoch?: string;
  text: string;
  recovering?: boolean;
  verifying?: boolean;
  beforeAck: Record<string, unknown>[];
  approvals: Map<string, { generation: number; expiresAt: number; responding: boolean }>;
}
/** Attaches a selected existing session to its running Hermes owner; never creates a new Bot. */
export class HermesSshAdapter implements AgentAdapter {
  readonly provider = 'hermes' as const;
  private bridge: NativeBridge;
  private runs = new Map<string, NativeRun>();
  private profile: string;
  constructor(options: HermesSshOptions) {
    sshTarget(options.endpoint);
    this.profile = options.profile ?? 'default';
    this.bridge = options.bridge ?? new SshNativeBridge(options);
    this.bridge.onEvent = (frame) => this.event(frame);
    this.bridge.onDisconnect = () => {
      for (const run of this.runs.values())
        if (!run.terminal)
          this.emit(run, 'turn.reconciling', {
            reason: 'SSH 연결이 끊겼습니다. 원격 실행 상태를 복구하세요.',
          });
    };
  }
  async connect(): Promise<void> {
    await this.bridge.start();
    const capabilities = await this.bridge.request('gateway.capabilities', {});
    if (capabilities.per_session_exclusive_submit !== true)
      throw new Error('요청 격리를 지원하는 Hermes 게이트웨이가 필요합니다.');
  }
  async disconnect(): Promise<void> {
    await this.bridge.close();
  }
  async discover(): Promise<Capabilities> {
    await this.connect();
    return {
      ...unsupportedCapabilities(),
      text: 'supported',
      streaming: 'supported',
      'session.list': 'supported',
      'session.resume': 'supported',
      'request.reconcile': 'supported',
      cancel: 'supported',
      'tool.events': 'supported',
      'tool.approvals': 'supported',
    };
  }
  async listSessions(agentId: string): Promise<Array<{ id: string; label: string }>> {
    if (agentId !== this.profile)
      throw new Error('연결된 Hermes 프로필과 요청한 프로필이 다릅니다.');
    const results = await Promise.all([
      this.bridge.request('session.list', { scope: 'stored', limit: 200, include_hidden: true }),
      this.bridge.request('session.list', { title: 'Bot Chat' }),
      this.bridge.request('session.list', { title: 'Live2D Companion Integration Test' }),
    ]);
    const sessions = new Map<string, { id: string; label: string }>();
    // Exact titled lookup also reaches hidden chats and ones outside the bounded picker page.
    for (const result of [results[1]!, results[2]!, results[0]!]) {
      if (!Array.isArray(result.sessions))
        throw new Error('Hermes 세션 목록 형식이 올바르지 않습니다.');
      for (const raw of result.sessions) {
        const row = object(raw);
        const id = boundedString(row.session_id ?? row.id, 256);
        if (!sessions.has(id))
          sessions.set(id, {
            id,
            label: boundedString(row.title || row.session_id || row.id, 512),
          });
      }
    }
    return [...sessions.values()];
  }
  async createSession(agentId: string): Promise<{ id: string; label: string }> {
    if (agentId !== this.profile)
      throw new Error('연결된 Hermes 프로필과 요청한 프로필이 다릅니다.');
    const label = 'Live2D Companion Integration Test';
    const snapshot = await this.bridge.request('session.create', {
      request_id: randomUUID(),
      source: 'gui',
      title: label,
      toolsets: [],
      follow_profile_config: true,
    });
    const id = boundedString(snapshot.session_id, 256);
    if (!id) throw new Error('Hermes 테스트 세션 식별자가 없습니다.');
    return { id, label };
  }
  async send(turn: UserTurn, sink: EventSink): Promise<void> {
    this.validate(turn);
    boundedString(turn.text, 32_000);
    if (this.runs.has(turn.requestId))
      throw new Error('이미 제출한 요청입니다. 상태 복구를 사용하세요.');
    if (this.runs.size >= 256) {
      for (const [id, previous] of this.runs) if (previous.terminal) this.runs.delete(id);
      if (this.runs.size >= 256)
        throw new Error('미확정 Hermes 요청이 너무 많습니다. 기존 요청 상태를 확인하세요.');
    }
    if (
      [...this.runs.values()].some(
        (run) => !run.terminal && run.ref.binding.sessionId === turn.binding.sessionId,
      )
    )
      throw new Error('이 세션의 이전 요청 상태를 먼저 확인하세요.');
    const run: NativeRun = {
      ref: structuredClone({
        binding: turn.binding,
        requestId: turn.requestId,
        turnId: turn.turnId,
      }),
      sink,
      terminal: false,
      sequence: -1,
      text: '',
      beforeAck: [],
      approvals: new Map(),
    };
    this.runs.set(turn.requestId, run);
    let submitting = false;
    try {
      const snapshot = await this.attach(run);
      if (Array.isArray(snapshot.pending) && snapshot.pending.length > 0) {
        this.emit(run, 'turn.failed', {
          code: 'session_busy',
          safeMessage: '선택한 Hermes 세션에서 다른 요청이 진행 중입니다. 완료 후 다시 보내세요.',
        });
        return;
      }
      submitting = true;
      const receipt = await this.bridge.request('prompt.submit', {
        session_id: turn.binding.sessionId,
        submission_id: turn.requestId,
        text: turn.text,
      });
      this.receiptBinding(run, receipt);
      run.admissionId = boundedString(receipt.admission_id, 256);
      if (!run.admissionId) throw new Error('Hermes 실행 식별자가 없습니다.');
      this.generation(run, receipt.execution_generation);
      this.emit(run, 'turn.accepted', { remoteRunId: run.admissionId });
      for (const event of run.beforeAck) this.applyEvent(run, event);
      run.beforeAck = [];
      if (receipt.status === 'terminal') await this.settleReceipt(run);
      else if (receipt.status === 'unknown')
        this.emit(run, 'turn.reconciling', { reason: 'Hermes 원격 실행 결과가 불명확합니다.' });
    } catch (error) {
      if (!submitting || (error instanceof TransportError && error.code === 'native_rejected'))
        this.emit(run, 'turn.failed', {
          code: 'native_rejected',
          safeMessage: 'Hermes가 기존 세션 연결 또는 제출을 거절했습니다.',
        });
      else
        this.emit(run, 'turn.reconciling', {
          reason: '제출 결과를 확인할 수 없습니다. 자동 재전송하지 않습니다.',
        });
    }
  }
  restore(ref: RequestRef, admissionId: string, sink: EventSink): void {
    this.validate(ref);
    boundedString(admissionId, 256);
    if (this.runs.has(ref.requestId) || !admissionId)
      throw new Error('복구할 요청 식별자가 올바르지 않습니다.');
    this.runs.set(ref.requestId, {
      ref: structuredClone(ref),
      sink,
      admissionId,
      terminal: false,
      sequence: -1,
      text: '',
      beforeAck: [],
      approvals: new Map(),
    });
  }
  async reconcile(ref: RequestRef, sink: EventSink): Promise<'resumed' | 'settled' | 'unknown'> {
    const run = this.bound(ref);
    if (!run?.admissionId) return 'unknown';
    run.sink = sink;
    const previousSequence = run.sequence;
    const previousEpoch = run.epoch;
    run.recovering = true;
    run.beforeAck = [];
    try {
      const snapshot = await this.attach(run);
      const receipt = await this.settleReceipt(run);
      if (run.terminal) return 'settled';
      if (!['started', 'queued'].includes(String(receipt.status))) return 'unknown';
      const replay = await this.bridge.request('session.events.since', {
        session_id: run.ref.binding.sessionId,
        replay_epoch: previousEpoch ?? run.epoch,
        last_sequence: Math.max(0, previousSequence),
      });
      if (
        replay.truncated === true ||
        replay.snapshot_required === true ||
        !Array.isArray(replay.events)
      ) {
        this.emit(run, 'turn.reconciling', {
          reason: '복구 이벤트가 보존 범위를 벗어났습니다. 원격 완료 확인을 기다립니다.',
        });
        return 'unknown';
      }
      if (replay.replay_epoch !== run.epoch)
        throw new Error('Hermes 복구 이벤트 세대가 일치하지 않습니다.');
      run.sequence = Math.max(0, previousSequence);
      this.emit(run, 'turn.resumed', { state: 'accepted' });
      this.prompts(run, snapshot.prompts);
      for (const raw of replay.events) {
        const frame = object(raw);
        this.applyEvent(run, object(frame.params ?? frame), true);
      }
      if (!run.terminal && run.text)
        this.emit(run, 'message.snapshot', { text: run.text, messageId: run.admissionId });
      if (typeof replay.last_sequence === 'number')
        run.sequence = Math.max(run.sequence, replay.last_sequence);
      return run.terminal ? 'settled' : 'resumed';
    } catch {
      this.emit(run, 'turn.reconciling', { reason: '기존 Hermes 실행 상태를 확인할 수 없습니다.' });
      return 'unknown';
    } finally {
      run.recovering = false;
      const queued = run.beforeAck;
      run.beforeAck = [];
      for (const params of queued) {
        try {
          this.applyEvent(run, params);
        } catch {
          this.emit(run, 'turn.reconciling', {
            reason: 'Hermes 복구 후 이벤트 확인이 필요합니다.',
          });
        }
      }
    }
  }
  async cancel(requestId: string): Promise<'confirmed' | 'requested' | 'unsupported'> {
    const run = this.runs.get(requestId);
    if (!run?.admissionId) return 'unsupported';
    try {
      const receipt = await this.settleReceipt(run);
      if (run.terminal)
        return receipt.outcome === 'interrupted' || receipt.outcome === 'cancelled'
          ? 'confirmed'
          : 'requested';
      if (receipt.status === 'queued')
        await this.bridge.request('prompt.cancel', {
          session_id: run.ref.binding.sessionId,
          admission_id: run.admissionId,
        });
      else if (receipt.status === 'started' && run.generation !== undefined)
        await this.bridge.request('session.interrupt', {
          session_id: run.ref.binding.sessionId,
          execution_generation: run.generation,
        });
      const after = await this.settleReceipt(run);
      return run.terminal && ['interrupted', 'cancelled'].includes(String(after.outcome))
        ? 'confirmed'
        : 'requested';
    } catch {
      this.emit(run, 'turn.reconciling', { reason: 'Hermes 원격 중단 결과를 확인할 수 없습니다.' });
      return 'requested';
    }
  }
  async respondApproval(response: ApprovalResponse): Promise<'applied' | 'closed' | 'unknown'> {
    const run = this.bound(response);
    const approval = run?.approvals.get(response.approvalId);
    if (!run || run.terminal || !approval || approval.expiresAt <= Date.now()) return 'closed';
    if (approval.responding) return 'unknown';
    approval.responding = true;
    try {
      const result = await this.bridge.request('approval.respond', {
        session_id: run.ref.binding.sessionId,
        execution_generation: approval.generation,
        prompt_id: response.approvalId,
        choice: response.decision === 'allow_once' ? 'once' : 'deny',
      });
      if (result.prompt_id !== response.approvalId) return 'unknown';
      if (result.status === 'already_resolved') {
        run.approvals.delete(response.approvalId);
        this.emit(run, 'approval.closed', {
          approvalId: response.approvalId,
          reason: '이미 처리된 승인입니다.',
        });
        return 'closed';
      }
      if (result.status !== 'resolved') return 'unknown';
      run.approvals.delete(response.approvalId);
      this.emit(run, 'approval.resolved', {
        approvalId: response.approvalId,
        decision: response.decision,
      });
      return 'applied';
    } catch {
      return 'unknown';
    }
  }
  private validate(ref: RequestRef): void {
    if (
      ref.binding.provider !== 'hermes' ||
      ref.binding.agentId !== this.profile ||
      !ref.binding.sessionId ||
      !ref.requestId ||
      !ref.turnId
    )
      throw new Error('기존 Hermes 프로필 및 세션 바인딩이 올바르지 않습니다.');
    boundedString(ref.binding.sessionId, 256);
    boundedString(ref.requestId, 256);
  }
  private bound(ref: RequestRef): NativeRun | undefined {
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
  private generation(run: NativeRun, value: unknown): void {
    if (Number.isSafeInteger(value) && (value as number) >= 0) run.generation = value as number;
  }
  private async attach(run: NativeRun): Promise<Record<string, unknown>> {
    const snapshot = await this.bridge.request('session.resume', {
      session_id: run.ref.binding.sessionId,
      omit_messages: true,
    });
    if (snapshot.session_id !== run.ref.binding.sessionId)
      throw new Error('Hermes가 선택한 세션과 다른 세션을 반환했습니다.');
    run.epoch = boundedString(snapshot.replay_epoch, 256);
    if (!Number.isSafeInteger(snapshot.last_sequence))
      throw new Error('Hermes 이벤트 순서가 올바르지 않습니다.');
    run.sequence = snapshot.last_sequence as number;
    this.generation(run, snapshot.execution_generation);
    return snapshot;
  }
  private receiptBinding(run: NativeRun, receipt: Record<string, unknown>): void {
    const ref = object(receipt.ref);
    if (
      ref.session_id !== run.ref.binding.sessionId ||
      !this.bridge.profileId ||
      ref.profile_id !== this.bridge.profileId
    )
      throw new Error('Hermes 실행 바인딩이 일치하지 않습니다.');
    if (run.admissionId && receipt.admission_id !== run.admissionId)
      throw new Error('Hermes 실행 식별자가 일치하지 않습니다.');
  }
  private async settleReceipt(run: NativeRun): Promise<Record<string, unknown>> {
    const receipt = await this.bridge.request('prompt.receipt', {
      session_id: run.ref.binding.sessionId,
      admission_id: run.admissionId,
      include_result: true,
    });
    this.receiptBinding(run, receipt);
    this.generation(run, receipt.execution_generation);
    if (receipt.status === 'terminal') {
      const result = receipt.result ? object(receipt.result) : {};
      if (
        receipt.outcome === 'completed' &&
        result.completed !== false &&
        result.partial !== true &&
        result.failed !== true &&
        result.interrupted !== true &&
        typeof result.final_response === 'string'
      ) {
        this.emit(run, 'message.complete', {
          text: boundedString(result.final_response),
          messageId: run.admissionId!,
        });
        this.emit(run, 'turn.completed', {});
      } else if (['interrupted', 'cancelled'].includes(String(receipt.outcome)))
        this.emit(run, 'turn.cancelled', { remoteConfirmed: true });
      else
        this.emit(run, 'turn.failed', {
          code: 'remote_failed',
          safeMessage: 'Hermes 원격 요청이 완료되지 못했습니다.',
        });
    }
    return receipt;
  }
  private event(frame: Record<string, unknown>): void {
    try {
      const params = object(frame.params);
      const sessionId = params.session_id;
      for (const run of this.runs.values()) {
        if (run.terminal || sessionId !== run.ref.binding.sessionId) continue;
        if (!run.admissionId || run.recovering) {
          if (run.beforeAck.length < 128) run.beforeAck.push(params);
          else
            this.emit(run, 'turn.reconciling', { reason: '접수 이전 이벤트 한도를 초과했습니다.' });
        } else this.applyEvent(run, params);
      }
    } catch {
      for (const run of this.runs.values())
        if (!run.terminal)
          this.emit(run, 'turn.reconciling', { reason: 'Hermes 이벤트 형식이 올바르지 않습니다.' });
    }
  }
  private applyEvent(run: NativeRun, params: Record<string, unknown>, snapshotOnly = false): void {
    if (run.terminal) return;
    const payload = object(params.payload ?? {});
    if (params.type === 'session.replay_gap') {
      this.emit(run, 'turn.reconciling', {
        reason: 'Hermes 이벤트가 누락되었습니다. 원격 상태를 복구하세요.',
      });
      return;
    }
    if (params.replay_epoch !== run.epoch || !Number.isSafeInteger(params.seq)) {
      this.emit(run, 'turn.reconciling', {
        reason: 'Hermes 이벤트 세대 또는 순서가 변경되었습니다.',
      });
      return;
    }
    const sequence = params.seq as number;
    if (sequence <= run.sequence) return;
    run.sequence = sequence;
    // Never merge another viewer's or queued turn's response into this request.
    if ((params.admission_id ?? payload.admission_id) !== run.admissionId) return;
    this.generation(run, params.execution_generation ?? payload.execution_generation);
    if (params.type === 'message.delta' && typeof payload.text === 'string') {
      const text = boundedString(payload.text, 64_000);
      run.text += text;
      if (run.text.length > 1_000_000) throw new Error('응답 크기 제한');
      if (!snapshotOnly) this.emit(run, 'message.delta', { text, messageId: run.admissionId! });
    } else if (params.type === 'message.complete') {
      if (!run.verifying) {
        run.verifying = true;
        void this.settleReceipt(run)
          .catch(() =>
            this.emit(run, 'turn.reconciling', {
              reason: 'Hermes 완료 이벤트의 원격 결과 확인이 필요합니다.',
            }),
          )
          .finally(() => {
            run.verifying = false;
          });
      }
    } else if (params.type === 'approval.request')
      this.prompts(run, [
        {
          ...payload,
          execution_generation: payload.execution_generation ?? params.execution_generation,
        },
      ]);
    else if (params.type === 'approval.settled' && typeof payload.prompt_id === 'string') {
      run.approvals.delete(payload.prompt_id);
      this.emit(run, 'approval.closed', {
        approvalId: payload.prompt_id,
        reason: '원격 승인 요청이 종료되었습니다.',
      });
    } else if (params.type === 'tool.start' || params.type === 'tool.started')
      this.emit(run, 'tool.started', {
        toolId: boundedString(
          payload.tool_call_id ??
            payload.call_id ??
            payload.tool_id ??
            payload.name ??
            payload.tool_name ??
            payload.tool,
          256,
        ),
        name: boundedString(payload.name ?? payload.tool_name ?? payload.tool, 256),
      });
    else if (params.type === 'tool.complete' || params.type === 'tool.completed')
      this.emit(run, 'tool.completed', {
        toolId: boundedString(
          payload.tool_call_id ??
            payload.call_id ??
            payload.tool_id ??
            payload.name ??
            payload.tool_name ??
            payload.tool,
          256,
        ),
      });
  }
  private prompts(run: NativeRun, raw: unknown): void {
    if (!Array.isArray(raw)) return;
    for (const value of raw) {
      const prompt = object(value);
      if (prompt.kind && prompt.kind !== 'approval') continue;
      if (
        run.approvals.size >= 32 ||
        typeof prompt.prompt_id !== 'string' ||
        prompt.prompt_id.length > 256 ||
        !Number.isSafeInteger(prompt.execution_generation) ||
        (run.generation !== undefined && prompt.execution_generation !== run.generation) ||
        run.approvals.has(prompt.prompt_id)
      )
        continue;
      const expiresAt = Date.now() + 60_000;
      run.approvals.set(prompt.prompt_id, {
        generation: prompt.execution_generation as number,
        expiresAt,
        responding: false,
      });
      this.emit(run, 'approval.requested', {
        approvalId: prompt.prompt_id,
        summary: `Hermes 원격 도구 승인: ${typeof prompt.description === 'string' && prompt.description ? prompt.description.slice(0, 2000) : typeof prompt.command === 'string' ? prompt.command.slice(0, 2000) : '작업 설명 없음: 원격에서 확인하세요.'}`,
        expiresAt,
      });
    }
  }
  private emit<K extends keyof EventPayloads>(
    run: NativeRun,
    type: K,
    payload: EventPayloads[K],
  ): void {
    if (run.terminal) return;
    run.sink({ ...run.ref, schemaVersion: 1, eventId: randomUUID(), type, payload } as AgentEvent);
    if (['turn.completed', 'turn.failed', 'turn.cancelled', 'turn.interrupted'].includes(type)) {
      run.terminal = true;
      run.approvals.clear();
    }
  }
}
