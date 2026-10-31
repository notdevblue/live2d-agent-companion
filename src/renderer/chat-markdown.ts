import MarkdownIt from 'markdown-it';
import type { Token } from 'markdown-it';

// Parse Markdown, but never turn provider text into HTML. Links and images are
// deliberately inert: displaying a reply cannot navigate or fetch a resource.
const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false });
const tags = new Set([
  'p',
  'strong',
  'em',
  's',
  'blockquote',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
]);

function appendTokens(parent: Node, tokens: Token[], document: Document): void {
  const stack: Node[] = [parent];
  for (const token of tokens) {
    const current = stack[stack.length - 1]!;
    if (token.type === 'inline') {
      appendTokens(current, token.children ?? [], document);
    } else if (token.type === 'fence' || token.type === 'code_block') {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = token.content;
      pre.append(code);
      current.appendChild(pre);
    } else if (token.type === 'code_inline') {
      const code = document.createElement('code');
      code.textContent = token.content;
      current.appendChild(code);
    } else if (token.type === 'softbreak') {
      current.appendChild(document.createTextNode('\n'));
    } else if (token.type === 'hardbreak' || token.type === 'hr') {
      current.appendChild(document.createElement(token.type === 'hr' ? 'hr' : 'br'));
    } else if (token.type === 'image') {
      current.appendChild(document.createTextNode(token.content));
    } else if (token.nesting === 1) {
      // No token attributes are copied. In particular href/src/style/event
      // handlers from the response never become DOM attributes.
      const node = document.createElement(tags.has(token.tag) ? token.tag : 'span');
      if (token.tag === 'ol') {
        const start = Number(token.attrGet('start') ?? 1);
        if (Number.isSafeInteger(start) && start > 0 && start <= 999_999_999)
          node.setAttribute('start', String(start));
      }
      current.appendChild(node);
      stack.push(node);
    } else if (token.nesting === -1) {
      if (stack.length > 1) stack.pop();
    } else {
      current.appendChild(document.createTextNode(token.content));
    }
  }
}

/** Shared by restored history, streaming snapshots and completed replies. */
export function renderMessageText(
  content: HTMLElement,
  role: 'user' | 'assistant',
  text: string,
): void {
  if (role === 'user') {
    content.textContent = text;
    return;
  }
  const fragment = content.ownerDocument.createDocumentFragment();
  appendTokens(fragment, markdown.parse(text, {}), content.ownerDocument);
  content.replaceChildren(fragment);
}
