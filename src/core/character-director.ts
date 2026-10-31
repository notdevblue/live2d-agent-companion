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

// A short presentation timeline, not an unbounded replay of every sentence.
interface Segment {
  id: number;
  text: string;
  createdAt: number;
}

/** Presentation-only. No tool, audio, provider or OS execution surface. */
export class CharacterDirector {
  private generation = 0;
  private segmentId = 0;
  private requestId = '';
  private pending = '';
  private enabled = false;
  private controller?: AbortController;
  private queue: Segment[] = [];
  private busy = false;
  private wake?: ReturnType<typeof setTimeout>;
  private nextAt = 0;
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

  append(text: string, flush = false): void {
    if (!this.enabled || !this.options.judge) return;
    this.pending += text;
    // Bound each request independently of provider token/chunk boundaries.
    while (this.pending.length > 0) {
      const boundary = /[.!?。！？](?:\s|$)|\n/.exec(this.pending);
      let length = boundary ? boundary.index + boundary[0].length : 0;
      if (length === 0 && this.pending.length >= 800) length = 800;
      if (length === 0 && flush) length = this.pending.length;
      if (length === 0) break;
      length = Math.min(length, 800);
      const segment = this.pending.slice(0, length).trim();
      this.pending = this.pending.slice(length);
      if (segment && this.judgements < EXPRESSION_PACING.maxJudgements) {
        this.queue.push({ id: ++this.segmentId, text: segment, createdAt: Date.now() });
        // Keep the opening beat and the latest context when a whole reply arrives at once.
        if (this.queue.length > EXPRESSION_PACING.maxQueued) this.queue.splice(1, 1);
      }
    }
    this.pump();
  }

  /** Snapshot/recovery text is displayed without replaying expression inference. */
  invalidate(): void {
    this.generation++;
    this.enabled = false;
    this.pending = '';
    this.queue = [];
    this.controller?.abort();
    this.controller = undefined;
    this.busy = false;
    clearTimeout(this.wake);
    this.wake = undefined;
    this.nextAt = 0;
  }

  replaceSnapshot(): void {
    const enabled = this.enabled;
    const nextAt = this.nextAt;
    this.invalidate();
    this.enabled = enabled;
    this.nextAt = nextAt;
  }

  private pump(): void {
    if (!this.enabled || this.busy || this.wake || !this.queue.length) return;
    if (this.judgements >= EXPRESSION_PACING.maxJudgements) {
      this.queue = [];
      return;
    }
    if (Date.now() < this.nextAt) {
      this.wake = setTimeout(() => {
        this.wake = undefined;
        this.pump();
      }, this.nextAt - Date.now());
      return;
    }
    const segment = this.queue.shift()!;
    if (Date.now() - segment.createdAt > EXPRESSION_PACING.maxAgeMs) {
      this.pump();
      return;
    }
    const judge = this.options.judge;
    if (!judge) return;
    const generation = this.generation;
    const segmentId = segment.id;
    const requestId = this.requestId;
    const controller = new AbortController();
    this.controller = controller;
    this.busy = true;
    this.judgements++;
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
      .then(() =>
        controller.signal.aborted ? undefined : judge.judge(segment.text, controller.signal),
      )
      .catch(() => undefined);
    void Promise.race([inference, deadline]).then((result) => {
      clearTimeout(timer);
      if (!this.enabled || generation !== this.generation) return;
      this.controller = undefined;
      this.busy = false;
      if (Date.now() - segment.createdAt > EXPRESSION_PACING.maxAgeMs) {
        this.pump();
        return;
      }
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
        segmentId,
        source: valid ? 'jev' : 'fallback',
      };
      this.options.onEvent({ type: 'cue', cue });
      if (!this.enabled || generation !== this.generation) return;
      this.nextAt = Date.now() + EXPRESSION_PACING.holdMs;
      this.pump();
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
