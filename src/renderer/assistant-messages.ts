import type { TurnView } from '../shared/contracts.js';
import { renderMessageText } from './chat-markdown.js';

const key = (requestId: string, messageId?: string) => JSON.stringify([requestId, messageId]);

/** Tracks only the selected conversation's assistant bubbles. */
export class AssistantMessageBubbles {
  private bubbles = new Map<string, { requestId: string; content: HTMLElement }>();

  clear(): void {
    this.bubbles.clear();
  }

  remember(requestId: string, messageId: string | undefined, content: HTMLElement): void {
    this.bubbles.set(key(requestId, messageId), { requestId, content });
  }

  update(turn: TurnView, add: (text: string) => HTMLElement): void {
    const messages =
      turn.messages ??
      (turn.text || this.bubbles.has(key(turn.requestId))
        ? [{ messageId: undefined, text: turn.text }]
        : []);
    const wanted = new Set(
      messages
        .filter((message) => message.text)
        .map((message) => key(turn.requestId, message.messageId)),
    );
    const previous = [...this.bubbles.values()]
      .filter((bubble) => bubble.requestId === turn.requestId)
      .sort((a, b) =>
        a.content.compareDocumentPosition(b.content) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
      );
    // Keep this request before later history rows when a snapshot inserts messages.
    const boundary = previous.at(-1)?.content.parentElement?.nextSibling ?? null;
    for (const [id, bubble] of this.bubbles) {
      if (bubble.requestId === turn.requestId && !wanted.has(id)) {
        bubble.content.parentElement?.remove();
        this.bubbles.delete(id);
      }
    }
    for (const message of messages) {
      if (!message.text) continue;
      const id = key(turn.requestId, message.messageId);
      let bubble = this.bubbles.get(id);
      if (!bubble) {
        bubble = { requestId: turn.requestId, content: add(message.text) };
        this.bubbles.set(id, bubble);
      } else renderMessageText(bubble.content, 'assistant', message.text);
      const article = bubble.content.parentElement;
      if (article?.parentElement) article.parentElement.insertBefore(article, boundary);
    }
  }
}
