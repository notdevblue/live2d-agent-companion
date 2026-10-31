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

/** Presentation-only. No tool, audio, provider or OS execution surface. */
export class CharacterDirector {
  private generation = 0;
  private segmentId = 0;
  private requestId = '';
  private pending = '';
  private enabled = false;
  private controller?: AbortController;
  private messageId?: string;
  private judged = new Set<string>();
  private emitted = new Set<string>();
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

  begin(requestId: string): void {
    this.invalidate();
    this.requestId = requestId;
    this.segmentId = 0;
    this.judgements = 0;
    this.judged.clear();
    this.emitted.clear();
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
            : 'thinking';
    if (next !== this.state) {
      this.state = next;
      this.options.onEvent({ type: 'character', state: next });
    }
  }

  /** One representative decision per visible assistant message; never a sentence replay queue. */
  append(text: string, flush = false, messageId?: string): void {
    if (!this.enabled || !this.options.judge) return;
    const id = messageId ?? this.messageId ?? 'answer';
    if (this.emitted.has(id) || this.judged.has(id)) return;
    if (id !== this.messageId) {
      this.cancelPending();
      this.messageId = id;
      this.segmentId++;
    }
    this.pending = (this.pending + text).slice(0, EXPRESSION_PACING.maxText);
    if (!this.pending.trim()) return;
    if (flush || /[.!?。！？](?:\s|$)|\n/.test(this.pending) || this.pending.length >= 120)
      this.schedule();
    else if (!this.wake)
      this.wake = setTimeout(() => {
        this.wake = undefined;
        this.schedule();
      }, EXPRESSION_PACING.collectMs);
  }

  /** Snapshot/recovery text is displayed without replaying expression inference. */
  invalidate(): void {
    this.enabled = false;
    this.cancelPending();
  }

  replaceSnapshot(): void {
    const id = this.messageId;
    this.cancelPending();
    if (id && !this.emitted.has(id)) this.judged.delete(id);
  }

  private cancelPending(): void {
    this.generation++;
    this.controller?.abort();
    this.controller = undefined;
    clearTimeout(this.wake);
    this.wake = undefined;
    this.pending = '';
    this.messageId = undefined;
  }

  private schedule(): void {
    const judge = this.options.judge;
    const messageId = this.messageId;
    if (!this.enabled || !judge || !messageId || !this.pending.trim() || this.judged.has(messageId))
      return;
    if (this.judgements >= EXPRESSION_PACING.maxJudgements) return;
    clearTimeout(this.wake);
    this.wake = undefined;
    const text = this.pending.trim();
    this.judged.add(messageId);
    const generation = this.generation;
    const segmentId = this.segmentId;
    const requestId = this.requestId;
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
        if (controller.signal.aborted) return undefined;
        this.judgements++;
        return judge.judge(text, controller.signal);
      })
      .catch(() => undefined);
    void Promise.race([inference, deadline]).then((result) => {
      clearTimeout(timer);
      if (
        !this.enabled ||
        generation !== this.generation ||
        messageId !== this.messageId ||
        Date.now() - createdAt > EXPRESSION_PACING.maxAgeMs
      )
        return;
      this.controller = undefined;
      const valid = this.validDecision(result);
      const cue: CharacterCue = {
        ...(valid
          ? {
              emotion: result.emotion,
              gesture: result.gesture,
              confidence: result.confidence,
              ...(result.attitude !== undefined ? { attitude: result.attitude } : {}),
            }
          : { emotion: 'neutral' as const, gesture: 'none' as const, confidence: 0 }),
        requestId,
        messageId,
        segmentId,
        source: valid ? 'jev' : 'fallback',
      };
      this.emitted.add(messageId);
      this.options.onEvent({ type: 'cue', cue });
    });
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
