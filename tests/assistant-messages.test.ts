// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { AssistantMessageBubbles } from '../src/renderer/assistant-messages.js';
import { renderMessageText } from '../src/renderer/chat-markdown.js';
import type { TurnView } from '../src/shared/contracts.js';

const turn = (messages?: TurnView['messages']): TurnView => ({
  binding: {
    provider: 'hermes',
    connectionId: 'host',
    agentId: 'default',
    sessionId: 'one',
    continuity: 'unverified',
  },
  turnId: 'turn',
  requestId: 'request',
  state: 'streaming',
  text: 'legacy',
  messages,
});
function fixture() {
  const conversation = document.createElement('section');
  const bubbles = new AssistantMessageBubbles();
  const add = (text: string) => {
    const article = document.createElement('article');
    const content = document.createElement('div');
    renderMessageText(content, 'assistant', text);
    article.append(content);
    conversation.append(article);
    return content;
  };
  return { conversation, bubbles, add };
}

describe('FR-CHAT-001/002 assistant message bubbles', () => {
  it('retires legacy placeholders, streams separate bubbles and renders safe Markdown', () => {
    const { conversation, bubbles, add } = fixture();
    bubbles.update(turn(), add);
    const messages = [
      { messageId: 'progress', text: '**Working**', completed: true },
      { messageId: 'final', text: 'fi', completed: false },
    ];
    bubbles.update(turn(messages), add);
    const first = conversation.firstElementChild;
    const final = conversation.lastElementChild;
    messages[1] = { messageId: 'final', text: 'final <script>attack()</script>', completed: true };
    bubbles.update(turn(messages), add);
    expect(conversation.children).toHaveLength(2);
    expect(conversation.firstElementChild).toBe(first);
    expect(conversation.lastElementChild).toBe(final);
    expect(conversation.querySelector('strong')?.textContent).toBe('Working');
    expect(final?.textContent).toBe('final <script>attack()</script>');
    expect(conversation.querySelector('script')).toBeNull();
    bubbles.update(turn([]), add);
    expect(conversation.children).toHaveLength(0);
  });

  it('reuses restored identities, respects message order, and keeps other requests separate', () => {
    const { conversation, bubbles, add } = fixture();
    bubbles.remember('request', 'final', add('old final'));
    bubbles.remember('other', 'final', add('other request'));
    const messages = [
      { messageId: 'progress', text: 'progress', completed: true },
      { messageId: 'final', text: 'final', completed: true },
    ];
    bubbles.update(turn(messages), add);
    bubbles.update(turn(messages), add);
    expect([...conversation.children].map((article) => article.textContent)).toEqual([
      'progress',
      'final',
      'other request',
    ]);
    // A new selected session clears remembered identities before restoring its DOM.
    bubbles.clear();
    conversation.replaceChildren();
    bubbles.update(turn(messages), add);
    expect(conversation.children).toHaveLength(2);
  });
});
