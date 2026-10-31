// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PRESENTATION,
  unsupportedCapabilities,
  type Bootstrap,
  type CompanionBridge,
  type CompanionEvent,
  type TurnView,
} from '../src/shared/contracts.js';

const markup = readFileSync('src/renderer/index.html', 'utf8');
const snapshot = (selectionId = 'one', revision = 1): Bootstrap => ({
  selectionId,
  revision,
  settings: {
    provider: { provider: 'mock', endpoint: '', agentId: 'default', sessionId: selectionId },
    jevEnabled: false,
    jevModel: 'jev-1.14.0',
    modelPath: '',
    scale: 1,
    alwaysOnTop: true,
    clickThrough: true,
    presentation: { ...DEFAULT_PRESENTATION },
  },
  history: [{ id: `${selectionId}:1`, role: 'assistant', text: `${selectionId} history` }],
  credentials: { hermes: false, grok_bot: false, jev: false },
  storageSecure: false,
  overlayInput: 'forward',
  capabilities: unsupportedCapabilities(),
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
let emit: (event: CompanionEvent) => void;
async function start(mode = 'chat', initial = snapshot()) {
  window.history.replaceState(null, '', `/?view=${mode}`);
  const bridge = {
    bootstrap: vi.fn(async () => structuredClone(initial)),
    onEvent: vi.fn((listener: typeof emit) => {
      emit = listener;
      return () => {};
    }),
    openSettings: vi.fn(async () => {}),
    displays: vi.fn(async () => []),
    saveSettings: vi.fn(async () => structuredClone(initial)),
    testConnection: vi.fn(async () => structuredClone(initial)),
    sessions: vi.fn(async () => []),
    createSession: vi.fn(async () => structuredClone(initial)),
    storeCredential: vi.fn(async () => {}),
  };
  window.companion = bridge as unknown as CompanionBridge;
  await import('../src/renderer/index.js');
  await vi.waitFor(() => expect(window.__uiReady).toBe(true));
  return bridge;
}
beforeEach(() => {
  vi.resetModules();
  document.documentElement.innerHTML = markup.slice(markup.indexOf('<head>'));
  window.__uiReady = false;
});

describe('FR-UI-002 independent settings view', () => {
  it('opens a separate settings window without hiding chat, transcript or draft', async () => {
    const bridge = await start();
    const chat = document.getElementById('chat')!;
    const draft = document.getElementById('message') as HTMLTextAreaElement;
    draft.value = '작성 중';
    document.getElementById('settings-toggle')!.click();
    expect(bridge.openSettings).toHaveBeenCalledOnce();
    expect(chat.hidden).toBe(false);
    expect(document.getElementById('settings')!.hidden).toBe(true);
    expect(chat.contains(document.getElementById('settings'))).toBe(false);
    expect(document.getElementById('conversation')!.textContent).toContain('one history');
    expect(draft.value).toBe('작성 중');
    expect(chat.textContent).not.toMatch(/선택한 원격 세션|Bot Chat|표현:|여기서 이야기해요/);
    expect(bridge.createSession).not.toHaveBeenCalled();
  });

  it('shows settings controls alone, closes its own window and protects unsaved edits', async () => {
    const bridge = await start('settings');
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    expect(document.getElementById('chat')!.hidden).toBe(true);
    expect(document.getElementById('settings')!.hidden).toBe(false);
    expect(document.getElementById('conversation')!.children).toHaveLength(0);
    const endpoint = document.getElementById('endpoint') as HTMLInputElement;
    endpoint.value = 'unsaved';
    emit({ type: 'configuration', selectionId: 'another', revision: 10 });
    expect(bridge.bootstrap).toHaveBeenCalledOnce();
    expect(endpoint.value).toBe('unsaved');
    document.getElementById('settings-close')!.click();
    expect(close).toHaveBeenCalledOnce();
    expect(bridge.createSession).not.toHaveBeenCalled();
  });

  it('adopts new selection broadcasts before filtering by selection and rejects stale refreshes', async () => {
    const bridge = await start();
    const old = deferred<Bootstrap>();
    const latest = deferred<Bootstrap>();
    bridge.bootstrap
      .mockImplementationOnce(() => old.promise)
      .mockImplementationOnce(() => latest.promise);
    emit({ type: 'configuration', selectionId: 'two', revision: 2 });
    emit({ type: 'configuration', selectionId: 'three', revision: 3 });
    latest.resolve(snapshot('three', 3));
    await vi.waitFor(() =>
      expect(document.getElementById('conversation')!.textContent).toContain('three history'),
    );
    old.resolve(snapshot('two', 2));
    await Promise.resolve();
    await Promise.resolve();
    expect(document.getElementById('conversation')!.textContent).toContain('three history');
    expect(document.getElementById('conversation')!.textContent).not.toContain('two history');
  });

  it('preserves transcript DOM, draft and reading position for unchanged selection settings', async () => {
    const bridge = await start();
    const conversation = document.getElementById('conversation')!;
    const message = conversation.firstElementChild;
    conversation.scrollTop = 120;
    (document.getElementById('message') as HTMLTextAreaElement).value = 'draft';
    bridge.bootstrap.mockResolvedValueOnce(snapshot('one', 5));
    emit({ type: 'configuration', selectionId: 'one', revision: 5 });
    await vi.waitFor(() => expect(bridge.bootstrap).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    expect(conversation.firstElementChild).toBe(message);
    expect(conversation.scrollTop).toBe(120);
    expect((document.getElementById('message') as HTMLTextAreaElement).value).toBe('draft');
  });

  it('keeps preview disabled during requests and approval without rendering chat in settings', async () => {
    await start('settings');
    const turn: TurnView = {
      binding: {
        provider: 'mock',
        connectionId: 'local',
        agentId: 'default',
        sessionId: 'one',
        continuity: 'unverified',
      },
      requestId: 'request',
      turnId: 'turn',
      state: 'streaming',
      text: 'response',
    };
    emit({ type: 'turn', selectionId: 'one', revision: 2, turn });
    expect((document.querySelector('[data-preview]') as HTMLButtonElement).disabled).toBe(true);
    expect(document.getElementById('conversation')!.children).toHaveLength(0);
    emit({ type: 'turn', selectionId: 'one', revision: 3, turn: { ...turn, state: 'completed' } });
    expect((document.querySelector('[data-preview]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('reports settings failures within settings and keeps successful saves out of chat notice', async () => {
    const bridge = await start('settings');
    bridge.testConnection.mockRejectedValueOnce(new Error('failure'));
    document.getElementById('save-settings')!.click();
    await vi.waitFor(() =>
      expect(document.getElementById('settings-notice')!.textContent).toContain(
        '처리하지 못했습니다',
      ),
    );
    expect(document.getElementById('notice')!.textContent).toBe('');
    document.getElementById('save-settings')!.click();
    await vi.waitFor(() =>
      expect(document.getElementById('settings-notice')!.textContent).toBe('설정을 저장했습니다.'),
    );
    expect(document.getElementById('notice')!.textContent).toBe('');
  });
});
