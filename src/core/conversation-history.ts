import type { ConversationMessage, TurnView } from '../shared/contracts.js';

/** Display cache only. The provider owns durable history; no transcript is written locally. */
export class ConversationHistory {
  private messages: ConversationMessage[] = [];
  private loading?: Promise<void>;
  private loaded = false;
  restoredRequestId?: string;

  async load(loader?: () => Promise<ConversationMessage[]>): Promise<void> {
    if (this.loading) return this.loading;
    if (this.loaded) return;
    if (!this.loading) {
      this.loading = (async () => {
        const messages = (await loader?.()) ?? [];
        // An in-flight restore can publish status while its provider history is loading.
        this.messages = structuredClone(messages);
        this.loaded = true;
      })().finally(() => {
        this.loading = undefined;
      });
    }
    await this.loading;
  }

  submitted(requestId: string, text: string): void {
    this.upsert({ id: `user:${requestId}`, role: 'user', text, requestId });
  }

  update(turn: TurnView): void {
    if (turn.requestId === this.restoredRequestId) return;
    if (turn.messages === undefined) {
      if (turn.text)
        this.upsert({
          id: `assistant:${turn.requestId}`,
          role: 'assistant',
          text: turn.text,
          requestId: turn.requestId,
        });
      return;
    }
    // Message snapshots are authoritative for this request. Retire the legacy
    // aggregate row and preserve the provider's message order, including inserts.
    const first = this.messages.findIndex(
      (row) => row.role === 'assistant' && row.requestId === turn.requestId,
    );
    const replies = new Map<string, ConversationMessage>();
    for (const message of turn.messages) {
      if (!message.text) continue;
      const existing = this.messages.find(
        (row) =>
          row.role === 'assistant' &&
          row.requestId === turn.requestId &&
          row.messageId === message.messageId,
      );
      replies.set(message.messageId, {
        id: existing?.id ?? `assistant:${JSON.stringify([turn.requestId, message.messageId])}`,
        role: 'assistant',
        text: message.text,
        requestId: turn.requestId,
        messageId: message.messageId,
      });
    }
    this.messages = this.messages.filter(
      (row) => row.role !== 'assistant' || row.requestId !== turn.requestId,
    );
    this.messages.splice(first < 0 ? this.messages.length : first, 0, ...replies.values());
  }

  async refresh(loader: () => Promise<ConversationMessage[]>): Promise<void> {
    if (this.loading) await this.loading;
    this.loaded = false;
    await this.load(loader);
  }

  snapshot(): ConversationMessage[] {
    return structuredClone(this.messages);
  }

  private upsert(message: ConversationMessage): void {
    const existing = this.messages.find(
      (row) =>
        row.role === message.role &&
        row.requestId === message.requestId &&
        row.messageId === message.messageId,
    );
    if (existing) existing.text = message.text;
    else this.messages.push(message);
  }
}
