import {
  ATTITUDES,
  EMOTIONS,
  GESTURES,
  EXPRESSION_PACING,
  type CharacterCue,
  type CompanionEvent,
  type ExpressionDecision,
  type ExpressionJudge,
  type TurnState,
} from '../shared/contracts.js';

export interface DirectorOptions {
  judge?: ExpressionJudge;
  onEvent: (event: CompanionEvent) => void;
  judgeTimeoutMs?: number;
  confidenceThreshold?: number;
}
interface MessageReaction {
  id: string;
  text: string;
  completed: boolean;
  scheduled: boolean;
  called: boolean;
  delivery: boolean;
  semantic: boolean;
  closed: boolean;
  lastSegmentId?: number;
}
const neutral: ExpressionDecision = { emotion: 'neutral', gesture: 'none', confidence: 0 };
/** Keep the conclusion as well as the opening, without retaining the full message. */
function excerpt(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const head = Math.floor((limit - 3) / 2);
  return `${text.slice(0, head)}\n…\n${text.slice(-(limit - head - 3))}`;
}

/** Presentation-only. No tool, audio, provider or OS execution surface. */
export class CharacterDirector {
  private generation = 0;
  private segmentId = 0;
  private requestId = '';
  private userRequest?: string;
  private enabled = false;
  private allowSemantic = true;
  private controller?: AbortController;
  private message?: MessageReaction;
  private seen = new Set<string>();
  private wake?: ReturnType<typeof setTimeout>;
  private judgements = 0;
  private state: 'idle' | 'thinking' | 'working' | 'error' = 'idle';
  private readonly timeout: number;
  private readonly threshold: number;

  constructor(private readonly options: DirectorOptions) {
    this.timeout = options.judgeTimeoutMs ?? 1500;
    this.threshold = options.confidenceThreshold ?? 0.6;
    if (!Number.isFinite(this.timeout) || this.timeout < 1 || this.timeout > 60_000)
      throw new Error('표현 판단 제한 시간은 1~60000ms여야 합니다.');
    if (!Number.isFinite(this.threshold) || this.threshold < 0 || this.threshold > 1)
      throw new Error('표현 확신 기준은 0~1이어야 합니다.');
  }

  begin(requestId: string, userRequest?: string, allowSemantic = true): void {
    this.invalidate();
    this.requestId = requestId;
    this.userRequest = userRequest?.trim()
      ? excerpt(userRequest.trim(), EXPRESSION_PACING.maxRequestText)
      : undefined;
    this.allowSemantic = allowSemantic;
    this.segmentId = 0;
    this.judgements = 0;
    this.seen.clear();
    this.enabled = true;
  }

  updateState(state: TurnState, working: boolean): void {
    const next =
      state === 'failed'
        ? 'error'
        : ['completed', 'cancelled', 'interrupted'].includes(state)
          ? 'idle'
          : working
            ? 'working'
            : state === 'streaming'
              ? 'idle'
              : 'thinking';
    if (next !== this.state) {
      this.state = next;
      this.options.onEvent({ type: 'character', state: next });
    }
  }

  /** Streaming text gets only a local delivery beat; semantics require message completion. */
  append(text: string, flush = false, messageId?: string): void {
    const message = this.select(messageId);
    if (!message || message.closed || message.completed) return;
    message.text = excerpt(message.text + text, EXPRESSION_PACING.maxText);
    if (!message.text.trim()) return;
    this.scheduleDelivery(message);
    if (flush) this.finish(message);
  }

  /** The Coordinator compares full bodies, including edits outside the bounded excerpt. */
  complete(text: string, messageId: string, changed = false): void {
    const message = this.select(messageId);
    if (!message || message.closed) return;
    if (message.completed) {
      if (!changed) return;
      // Multiple completions in one synchronous batch can still share the sole call.
      if (message.called || message.semantic) {
        this.replaceSnapshot(messageId);
        return;
      }
    }
    message.text = excerpt(text, EXPRESSION_PACING.maxText);
    if (!message.text.trim()) {
      this.replaceSnapshot(messageId);
      return;
    }
    this.scheduleDelivery(message);
    this.finish(message);
  }

  /** Recovery never replays text or invents the missing original request context. */
  invalidate(): void {
    this.enabled = false;
    this.userRequest = undefined;
    this.cancelPending();
    this.message = undefined;
  }

  replaceSnapshot(messageId = this.message?.id): void {
    if (!messageId) return;
    this.seen.add(messageId);
    const message = this.message;
    if (!message || message.id !== messageId || message.closed) return;
    this.cancelPending();
    message.closed = true;
    message.text = '';
    if (message.lastSegmentId !== undefined)
      this.options.onEvent({
        type: 'cue.clear',
        requestId: this.requestId,
        messageId,
        segmentId: message.lastSegmentId,
      });
  }

  private select(messageId?: string): MessageReaction | undefined {
    if (!this.enabled) return undefined;
    const id = messageId ?? this.message?.id ?? 'answer';
    if (id === this.message?.id) return this.message;
    if (this.seen.has(id)) return undefined;
    // Cancel the old inference at the first new byte, not after its delivery timer.
    this.cancelPending();
    const previous = this.message;
    if (previous && !previous.closed && previous.lastSegmentId !== undefined)
      this.options.onEvent({
        type: 'cue.clear',
        requestId: this.requestId,
        messageId: previous.id,
        segmentId: previous.lastSegmentId,
      });
    this.seen.add(id);
    this.message = {
      id,
      text: '',
      completed: false,
      scheduled: false,
      called: false,
      delivery: false,
      semantic: false,
      closed: false,
    };
    return this.message;
  }

  private cancelPending(): void {
    this.generation++;
    this.controller?.abort();
    this.controller = undefined;
    clearTimeout(this.wake);
    this.wake = undefined;
  }

  private scheduleDelivery(message: MessageReaction): void {
    if (message.delivery || message.semantic || this.wake) return;
    const generation = this.generation;
    const createdAt = Date.now();
    this.wake = setTimeout(() => {
      this.wake = undefined;
      if (
        this.current(message, generation) &&
        !message.semantic &&
        Date.now() - createdAt <= EXPRESSION_PACING.maxAgeMs
      ) {
        message.delivery = true;
        this.emitCue(message, neutral, 'delivery', false);
      }
    }, EXPRESSION_PACING.collectMs);
  }

  private finish(message: MessageReaction): void {
    message.completed = true;
    if (message.scheduled) return;
    message.scheduled = true;
    const generation = this.generation;
    const createdAt = Date.now();
    const controller = new AbortController();
    this.controller = controller;
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(undefined);
      }, this.timeout);
      controller.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve(undefined);
        },
        { once: true },
      );
    });
    const inference = Promise.resolve()
      .then(() => {
        if (
          !this.current(message, generation) ||
          controller.signal.aborted ||
          !this.allowSemantic ||
          !this.options.judge ||
          this.judgements >= EXPRESSION_PACING.maxJudgements
        )
          return undefined;
        message.called = true;
        this.judgements++;
        return this.options.judge.judge(
          message.text.trim(),
          controller.signal,
          this.userRequest ? { userRequest: this.userRequest } : undefined,
        );
      })
      .catch(() => undefined);
    void Promise.race([inference, deadline]).then((result) => {
      clearTimeout(timer);
      if (!this.current(message, generation) || Date.now() - createdAt > EXPRESSION_PACING.maxAgeMs)
        return;
      this.controller = undefined;
      clearTimeout(this.wake);
      this.wake = undefined;
      message.semantic = true;
      const valid = this.validDecision(result);
      this.emitCue(message, valid ? result : neutral, 'semantic', valid);
    });
  }

  private current(message: MessageReaction, generation: number): boolean {
    return (
      this.enabled && this.message === message && !message.closed && generation === this.generation
    );
  }

  private emitCue(
    message: MessageReaction,
    decision: ExpressionDecision,
    stage: 'delivery' | 'semantic',
    valid: boolean,
  ): void {
    message.lastSegmentId = ++this.segmentId;
    const cue: CharacterCue = {
      ...decision,
      stage,
      requestId: this.requestId,
      messageId: message.id,
      segmentId: message.lastSegmentId,
      source: valid ? 'jev' : 'fallback',
    };
    this.options.onEvent({ type: 'cue', cue });
  }

  private validDecision(result: ExpressionDecision | undefined): result is ExpressionDecision {
    return (
      !!result &&
      EMOTIONS.includes(result.emotion) &&
      GESTURES.includes(result.gesture) &&
      (result.attitude === undefined || ATTITUDES.includes(result.attitude)) &&
      Number.isFinite(result.confidence) &&
      result.confidence >= this.threshold &&
      result.confidence <= 1
    );
  }
}
