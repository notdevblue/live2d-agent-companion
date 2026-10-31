// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PRESENTATION,
  unsupportedCapabilities,
  type Bootstrap,
  type AppSettings,
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
    saveSettings: vi.fn(async (_settings: AppSettings) => structuredClone(initial)),
    testConnection: vi.fn(async () => structuredClone(initial)),
    sessions: vi.fn(async () => []),
    createSession: vi.fn(async () => structuredClone(initial)),
    send: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    reconcile: vi.fn(async () => {}),
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
    await vi.waitFor(() => expect(bridge.bootstrap).toHaveBeenCalledTimes(2));
    expect(endpoint.value).toBe('unsaved');
    document.getElementById('settings-close')!.click();
    expect(close).toHaveBeenCalledOnce();
    expect(bridge.createSession).not.toHaveBeenCalled();
  });
  it('updates an open settings window after a chat session change without saving stale session or draft fields', async () => {
    const bridge = await start('settings');
    const endpoint = document.getElementById('endpoint') as HTMLInputElement;
    endpoint.value = 'unsaved';
    const next = snapshot('two', 5);
    bridge.bootstrap.mockResolvedValueOnce(next);
    emit({ type: 'configuration', selectionId: 'two', revision: 5 });
    await vi.waitFor(() =>
      expect((document.getElementById('session-id') as HTMLInputElement).value).toBe('two'),
    );
    expect(endpoint.value).toBe('unsaved');
    document.getElementById('framing')!.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(bridge.saveSettings).toHaveBeenCalledOnce());
    expect(bridge.saveSettings.mock.calls[0]?.[0]).toMatchObject({
      provider: { sessionId: 'two', endpoint: '' },
    });
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

  it('does not let a delayed settings refresh undo newer pending request state', async () => {
    const bridge = await start('settings');
    const refreshing = deferred<Bootstrap>();
    bridge.bootstrap.mockImplementationOnce(() => refreshing.promise);
    emit({ type: 'configuration', selectionId: 'one', revision: 2 });
    const turn: TurnView = {
      binding: {
        provider: 'mock',
        connectionId: 'local',
        agentId: 'default',
        sessionId: 'one',
        continuity: 'unverified',
      },
      requestId: 'r',
      turnId: 't',
      state: 'streaming',
      text: 'live',
    };
    emit({ type: 'turn', selectionId: 'one', revision: 5, turn });
    refreshing.resolve(snapshot('one', 2));
    await Promise.resolve();
    await Promise.resolve();
    expect((document.querySelector('[data-preview]') as HTMLButtonElement).disabled).toBe(true);
    emit({ type: 'turn', selectionId: 'one', revision: 6, turn: { ...turn, state: 'completed' } });
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

function typeMessage(value: string) {
  const message = document.getElementById('message') as HTMLTextAreaElement;
  message.value = value;
  message.dispatchEvent(new Event('input', { bubbles: true }));
  return message;
}
function submitMessage(value: string) {
  typeMessage(value);
  document
    .getElementById('composer')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}
describe('FR-UI-002 chat slash actions', () => {
  it('creates one new session locally, clears old conversation and preserves a new draft typed while waiting', async () => {
    const bridge = await start();
    const creating = deferred<Bootstrap>();
    bridge.createSession.mockImplementationOnce(() => creating.promise);
    submitMessage('/new');
    submitMessage('/new');
    expect(bridge.createSession).toHaveBeenCalledOnce();
    expect(bridge.send).not.toHaveBeenCalled();
    typeMessage('새 대화에 쓸 초안');
    creating.resolve({ ...snapshot('two', 2), history: [] });
    await vi.waitFor(() =>
      expect(document.getElementById('conversation')!.children).toHaveLength(0),
    );
    expect((document.getElementById('message') as HTMLTextAreaElement).value).toBe(
      '새 대화에 쓸 초안',
    );
    expect((document.getElementById('send') as HTMLButtonElement).disabled).toBe(false);
  });
  it('opens settings and help locally while leaving unknown commands editable and out of the conversation', async () => {
    const bridge = await start();
    submitMessage('/settings');
    await vi.waitFor(() =>
      expect((document.getElementById('message') as HTMLTextAreaElement).value).toBe(''),
    );
    expect(bridge.openSettings).toHaveBeenCalledOnce();
    submitMessage('/help');
    await vi.waitFor(() => expect(document.getElementById('slash-menu')!.hidden).toBe(false));
    expect((document.getElementById('message') as HTMLTextAreaElement).value).toBe('/');
    // A bare slash submitted from the form only opens the menu.
    submitMessage('/');
    await vi.waitFor(() => expect(document.getElementById('slash-menu')!.hidden).toBe(false));
    submitMessage('/unknown');
    expect(document.getElementById('notice')!.textContent).toContain('지원하지 않는 명령');
    expect((document.getElementById('message') as HTMLTextAreaElement).value).toBe('/unknown');
    submitMessage('/new argument');
    expect(document.getElementById('notice')!.textContent).toContain('추가 인자');
    expect(bridge.send).not.toHaveBeenCalled();
    expect(bridge.createSession).not.toHaveBeenCalled();
    expect(document.querySelectorAll('#conversation .message')).toHaveLength(1);
  });
  it('allows stop and status during a pending response while blocking ordinary duplicate prompts', async () => {
    const bridge = await start();
    const turn: TurnView = {
      binding: {
        provider: 'mock',
        connectionId: 'local',
        agentId: 'default',
        sessionId: 'one',
        continuity: 'unverified',
      },
      requestId: 'pending',
      turnId: 'turn',
      state: 'streaming',
      text: 'reply',
    };
    emit({ type: 'turn', selectionId: 'one', revision: 2, turn });
    typeMessage('ordinary');
    expect((document.getElementById('send') as HTMLButtonElement).disabled).toBe(true);
    submitMessage('/stop');
    await vi.waitFor(() =>
      expect((document.getElementById('message') as HTMLTextAreaElement).value).toBe(''),
    );
    expect(bridge.cancel).toHaveBeenCalledExactlyOnceWith('pending');
    submitMessage('/status');
    await vi.waitFor(() => expect(bridge.reconcile).toHaveBeenCalledExactlyOnceWith('pending'));
    expect(bridge.send).not.toHaveBeenCalled();
  });
  it('preserves path text and permits a new selection to send while an old connection remains pending', async () => {
    const bridge = await start();
    const oldSend = deferred<void>();
    bridge.send.mockImplementationOnce(() => oldSend.promise);
    submitMessage('/etc/os-release 확인해');
    expect(bridge.send).toHaveBeenCalledExactlyOnceWith('/etc/os-release 확인해', 'one');
    typeMessage('아직 보내면 안 됨');
    expect((document.getElementById('send') as HTMLButtonElement).disabled).toBe(true);
    bridge.createSession.mockResolvedValueOnce({ ...snapshot('two', 2), history: [] });
    submitMessage('/new');
    await vi.waitFor(() =>
      expect((document.getElementById('message') as HTMLTextAreaElement).value).toBe(''),
    );
    submitMessage('new target');
    await vi.waitFor(() => expect(bridge.send).toHaveBeenCalledTimes(2));
    expect(bridge.send.mock.calls[1]).toEqual(['new target', 'two']);
    oldSend.resolve();
    await Promise.resolve();
    expect(document.getElementById('notice')!.textContent).toBe('');
  });
});
