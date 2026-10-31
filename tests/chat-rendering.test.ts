// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMessageText } from '../src/renderer/chat-markdown.js';
import { isConversationAtBottom, scrollConversationToBottom } from '../src/renderer/chat-scroll.js';

function render(text: string, role: 'user' | 'assistant' = 'assistant'): HTMLElement {
  const content = document.createElement('div');
  renderMessageText(content, role, text);
  return content;
}

describe('FR-CHAT-002 safe assistant Markdown', () => {
  it('renders paragraphs, emphasis, nested lists, fenced code and GFM tables', () => {
    const content = render(
      [
        '첫 문단 **강조**와 `inline()`.',
        '',
        '둘째 문단.',
        '',
        '- 하나',
        '  - 둘',
        '',
        '3. 셋',
        '4. 넷',
        '',
        '```html',
        '<img src="https://example.test/x" onerror="alert(1)">',
        '```',
        '',
        '| 이름 | 값 |',
        '| --- | --- |',
        '| 모델 | **기본** |',
      ].join('\n'),
    );
    expect(content.querySelectorAll(':scope > p')).toHaveLength(2);
    expect(content.querySelector('strong')?.textContent).toBe('강조');
    expect(content.querySelector('p code')?.textContent).toBe('inline()');
    expect(content.querySelector('ul ul li')?.textContent?.trim()).toBe('둘');
    expect(content.querySelector('ol')?.start).toBe(3);
    expect(content.querySelector('pre code')?.textContent).toBe(
      '<img src="https://example.test/x" onerror="alert(1)">\n',
    );
    expect(content.querySelectorAll('thead th')).toHaveLength(2);
    expect(content.querySelector('tbody td strong')?.textContent).toBe('기본');
    expect(content.querySelector('img')).toBeNull();
  });

  it('keeps user messages literal, including Markdown and raw markup', () => {
    const text = '**강조 아님**\n<script>alert(1)</script>\n![x](https://example.test/x)';
    const content = render(text, 'user');
    expect(content.textContent).toBe(text);
    expect(content.children).toHaveLength(0);
  });

  it('never creates executable markup, navigation or resource attributes', () => {
    const payload = [
      '<script>alert(1)</script>',
      '<img src="https://example.test/track" onerror="alert(1)">',
      '<iframe src="file:///etc/passwd"></iframe>',
      '<svg onload="alert(1)"></svg>',
      '[normal](https://example.test/path)',
      '[js](javascript:alert%281%29)',
      '[encoded](jav&#x61;script:alert%281%29)',
      '[data](data:text/html,attack)',
      '[local](file:///etc/passwd)',
      '[app](app://runtime/private)',
      '![remote](https://example.test/track)',
      '![svg](data:image/svg+xml,attack)',
      '<style>body{background:url(https://example.test/track)}</style>',
      '| A | B |',
      '| :--- | ---: |',
      '| x | y |',
    ].join('\n\n');
    const content = render(payload);
    expect(
      content.querySelector('script, img, iframe, svg, style, a, link, object, embed'),
    ).toBeNull();
    for (const element of content.querySelectorAll('*'))
      for (const attribute of element.attributes) expect(['start']).toContain(attribute.name);
    expect(content.textContent).toContain('<script>alert(1)</script>');
    expect(content.textContent).toContain('remote');
    expect(content.textContent).toContain('normal');
  });

  it('replaces streaming snapshots without duplicate content and tolerates partial fences', () => {
    const content = render('**시작');
    renderMessageText(content, 'assistant', '**시작**\n\n```ts\nconst value = 1;');
    expect(content.querySelectorAll('strong')).toHaveLength(1);
    expect(content.querySelector('strong')?.textContent).toBe('시작');
    expect(content.querySelector('pre code')?.textContent).toBe('const value = 1;');
    renderMessageText(content, 'assistant', '완료');
    expect(content.textContent).toBe('완료');
    expect(content.querySelector('pre')).toBeNull();
  });
});

describe('FR-UI-002 conversation scroll policy', () => {
  it('follows a growing reply when already near the bottom', () => {
    const conversation = { scrollTop: 700, scrollHeight: 1000, clientHeight: 300 };
    const follow = isConversationAtBottom(conversation);
    conversation.scrollHeight += 500;
    if (follow) scrollConversationToBottom(conversation);
    expect(conversation.scrollTop).toBe(1500);
    expect(isConversationAtBottom({ ...conversation, scrollTop: 1170 })).toBe(true);
  });

  it('preserves older-message reading position and own send explicitly jumps down', () => {
    const conversation = { scrollTop: 100, scrollHeight: 1000, clientHeight: 300 };
    const follow = isConversationAtBottom(conversation);
    conversation.scrollHeight += 500;
    if (follow) scrollConversationToBottom(conversation);
    expect(conversation.scrollTop).toBe(100);
    scrollConversationToBottom(conversation);
    expect(conversation.scrollTop).toBe(1500);
  });
});
