import { randomUUID } from 'node:crypto';
import {
  unsupportedCapabilities,
  type AgentAdapter,
  type Capabilities,
  type EventSink,
  type RequestRef,
  type UserTurn,
} from '../shared/contracts.js';
import {
  boundedString,
  endpoint,
  request,
  TransportError,
  type TransportOptions,
} from './transport.js';

/** Existing Grok Bot Routine webhook trigger; external answer callbacks remain unsupported. */
export class GrokBotAdapter implements AgentAdapter {
  readonly provider = 'grok_bot' as const;
  private controllers = new Set<AbortController>();
  constructor(private readonly options: TransportOptions) {
    endpoint(options.endpoint);
  }
  async connect(): Promise<void> {
    endpoint(this.options.endpoint);
  }
  async disconnect(): Promise<void> {
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
  }
  async discover(): Promise<Capabilities> {
    return { ...unsupportedCapabilities(), text: 'experimental' };
  }
  async send(turn: UserTurn, sink: EventSink): Promise<void> {
    if (turn.attachments?.length)
      throw new Error('이 연결은 첨부를 지원하지 않습니다. Hermes SSH 연결을 사용하세요.');
    boundedString(turn.text, 32_000);
    if (turn.binding.provider !== this.provider)
      throw new Error('공급자 바인딩이 일치하지 않습니다.');
    const controller = new AbortController();
    this.controllers.add(controller);
    const emit = (
      type: 'turn.accepted' | 'turn.awaiting_result' | 'turn.reconciling' | 'turn.failed',
      payload: object,
    ) =>
      sink({
        binding: turn.binding,
        requestId: turn.requestId,
        turnId: turn.turnId,
        schemaVersion: 1,
        eventId: randomUUID(),
        type,
        payload,
      } as Parameters<EventSink>[0]);
    try {
      const { response, dispose } = await request(
        this.options,
        '',
        {
          method: 'POST',
          body: JSON.stringify({
            schema_version: 1,
            request_id: turn.requestId,
            turn_id: turn.turnId,
            message: turn.text,
          }),
        },
        controller.signal,
      );
      try {
        // The documented webhook acceptance code is exactly 200, never an answer.
        if (response.status !== 200) {
          emit('turn.reconciling', { reason: '웹훅 실행 접수 여부를 확인할 수 없습니다.' });
          return;
        }
        emit('turn.accepted', {});
        emit('turn.awaiting_result', {});
      } finally {
        await response.body?.cancel().catch(() => undefined);
        dispose();
      }
    } catch (error) {
      if (
        error instanceof TransportError &&
        [400, 401, 403, 404, 405, 413, 415, 422, 429].includes(error.status ?? 0)
      )
        emit('turn.failed', { code: 'webhook_rejected', safeMessage: error.message });
      else
        emit('turn.reconciling', {
          reason: '웹훅 실행 상태가 불명확합니다. 자동 재전송하지 않습니다.',
        });
    } finally {
      this.controllers.delete(controller);
    }
  }
  async reconcile(_request: RequestRef, _sink: EventSink): Promise<'unknown'> {
    return 'unknown';
  }
}
