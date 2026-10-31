/** Bounded network helpers. Errors deliberately never include response bodies or URLs. */
export interface TransportOptions {
  endpoint: string;
  token: () => Promise<string>;
  fetch?: typeof fetch;
  timeoutMs?: number;
}
export class TransportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TransportError('invalid_response', '공급자 응답 형식이 올바르지 않습니다.');
  return value as Record<string, unknown>;
}
export function boundedString(value: unknown, max = 1_000_000): string {
  if (typeof value !== 'string' || value.length > max)
    throw new TransportError('invalid_response', '공급자 응답 형식이 올바르지 않습니다.');
  return value;
}
export function endpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TransportError('endpoint', '연결 주소가 올바르지 않습니다.');
  }
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  ) {
    throw new TransportError('endpoint', 'HTTPS 또는 로컬 SSH 터널 주소를 사용하세요.');
  }
  return url.href.replace(/\/$/, '');
}
export async function jsonBody(response: Response, limit = 1_000_000): Promise<unknown> {
  if (!response.body) throw new TransportError('empty_response', '공급자 응답이 비어 있습니다.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit)
        throw new TransportError('response_size', '공급자 응답 크기 제한을 초과했습니다.');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof TransportError) throw error;
    throw new TransportError('invalid_response', '공급자 응답을 읽을 수 없습니다.');
  } finally {
    reader.releaseLock();
  }
}
export async function request(
  options: TransportOptions,
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<{ response: Response; dispose: () => void }> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, options.timeoutMs ?? 30_000);
  const dispose = () => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  };
  try {
    const token = await options.token();
    if (!token || /[\r\n]/.test(token))
      throw new TransportError('credentials', '공급자 인증 키를 설정하세요.');
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    if (init.body) headers.set('Content-Type', 'application/json');
    const response = await (options.fetch ?? fetch)(`${endpoint(options.endpoint)}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new TransportError(
        'http_error',
        `공급자가 HTTP ${response.status} 오류를 반환했습니다.`,
        response.status,
      );
    }
    return { response, dispose };
  } catch (error) {
    dispose();
    if (error instanceof TransportError) throw error;
    throw new TransportError('network', '연결이 끊겼거나 대기 시간이 초과되었습니다.');
  }
}
export async function requestJson(
  options: TransportOptions,
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const { response, dispose } = await request(options, path, init, signal);
  try {
    return object(await jsonBody(response));
  } finally {
    dispose();
  }
}
export interface SseFrame {
  id?: string;
  event?: string;
  data: string;
}
/** Streaming UTF-8 parser: handles fragmented CRLF and multiline data, caps each frame. */
export async function* sseFrames(response: Response): AsyncGenerator<SseFrame> {
  if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body)
    throw new TransportError('sse_type', '이벤트 스트림 형식이 올바르지 않습니다.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '';
  let frame: SseFrame = { data: '' };
  let frameSize = 0;
  const line = (text: string): SseFrame | undefined => {
    if (text === '') {
      const ready = frame.data ? { ...frame, data: frame.data.slice(0, -1) } : undefined;
      frame = { data: '' };
      frameSize = 0;
      return ready;
    }
    if (text.startsWith(':')) return;
    frameSize += text.length;
    if (frameSize > 1_000_000)
      throw new TransportError('response_size', '이벤트 크기 제한을 초과했습니다.');
    const separator = text.indexOf(':');
    const key = separator < 0 ? text : text.slice(0, separator);
    const value = separator < 0 ? '' : text.slice(separator + 1).replace(/^ /, '');
    if (key === 'data') frame.data += `${value}\n`;
    else if (key === 'id' && !value.includes('\0')) frame.id = value;
    else if (key === 'event') frame.event = value;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (pending.length > 1_000_000)
        throw new TransportError('response_size', '이벤트 크기 제한을 초과했습니다.');
      let index: number;
      while ((index = pending.indexOf('\n')) >= 0) {
        const ready = line(pending.slice(0, index).replace(/\r$/, ''));
        pending = pending.slice(index + 1);
        if (ready) yield ready;
      }
      if (done) break;
    }
    // Incomplete frames are intentionally discarded, per EventSource semantics.
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
