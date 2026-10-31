import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  protocol,
  safeStorage,
  screen,
  session,
  Menu,
  Tray,
  nativeImage,
} from 'electron';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  AgentAdapter,
  AppSettings,
  Bootstrap,
  CompanionEvent,
  ModelInventory,
  AgentBinding,
  Capabilities,
  OverlayInputRegion,
  ExpressionContext,
} from '../shared/contracts.js';
import {
  CHARACTER_PREVIEWS,
  DEFAULT_PRESENTATION,
  unsupportedCapabilities,
} from '../shared/contracts.js';
import { OverlayInputState } from '../shared/overlay-input.js';
import {
  defaultOverlayPosition,
  intersectsDisplay,
  transferOverlay,
} from '../shared/overlay-placement.js';
import { parseInputRegion } from '../shared/input-region.js';
import {
  applyModelMappings,
  THINKING_MOTION,
  SURPRISED_EXPRESSION,
} from '../shared/model-mappings.js';
import { X11InputShape } from './x11-input.js';
import { characterPreviewSchema, parseSettings } from '../shared/validation.js';
import { TurnCoordinator, bindingKey, type CoordinatorMetadata } from '../core/turn-coordinator.js';
import { ConversationHistory } from '../core/conversation-history.js';
import { MockAdapter } from '../adapters/mock.js';
import { HermesAdapter } from '../adapters/hermes.js';
import { HermesSshAdapter } from '../adapters/hermes-ssh.js';
import { GrokBotAdapter } from '../adapters/grok.js';
import { JevJudge } from '../adapters/jev.js';
import { ModelLibrary } from './model-library.js';
import { CredentialVault, JsonFile, credentialScope } from './storage.js';
import { EnvKeyError, readJevEnv } from './env-key.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const smoke = process.argv.includes('--smoke');
const smokeHermes = process.argv.includes('--smoke-hermes');
const smokeStdinJev = process.argv.includes('--jev-key-fd=3');
const smokeEnv = process.argv.includes('--smoke-env');
const smokeJev = smokeStdinJev || smokeEnv;
app.setName('Live2D Agent Companion');
// Linux mouse forwarding and global cursor queries are unavailable on native
// Wayland. Prefer Xwayland when present, while respecting an explicit backend.
if (
  process.platform === 'linux' &&
  process.env.DISPLAY &&
  !app.commandLine.hasSwitch('ozone-platform')
)
  app.commandLine.appendSwitch('ozone-platform', 'x11');
const x11InputRequested =
  process.platform === 'linux' && app.commandLine.getSwitchValue('ozone-platform') === 'x11';
let overlayInput: Bootstrap['overlayInput'] =
  process.platform === 'linux' ? 'unsupported' : 'forward';
let overlayInputError: string | undefined =
  process.platform === 'linux'
    ? '이 창 시스템에서는 클릭 통과를 지원하지 않습니다. X11/Xwayland와 X11 input helper가 필요합니다.'
    : undefined;
const overlayInputState = new OverlayInputState();
let ignoredMouseEvents = false;
let inputShape: X11InputShape | undefined;
let inputRegion: OverlayInputRegion | undefined;
let inputRegionAt = 0;
if (smoke) {
  app.setPath('userData', resolve(root, '.tmp/smoke-profile'));
  app.commandLine.appendSwitch('use-gl', 'angle');
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
}
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);
let overlay: BrowserWindow | undefined;
let chat: BrowserWindow | undefined;
let settingsWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let coordinator: TurnCoordinator | undefined;
let adapter: AgentAdapter | undefined;
let switching = false;
let submissionPending: { selectionId: string; token: symbol } | undefined;
let selectionId = crypto.randomUUID();
let revision = 0;
let storageFault = false;
let capabilities: Capabilities = unsupportedCapabilities();
let connectionError: string | undefined;
let quitting = false;
let model: ModelInventory | undefined;
let modelError: string | undefined;
const models = new ModelLibrary();
let settings: AppSettings = {
  provider: { provider: 'mock', endpoint: '', agentId: 'demo', sessionId: 'demo-session' },
  jevEnabled: false,
  jevModel: 'jev-1.14.0',
  modelPath: join(root, 'local-assets/DeepSeek/大肥鱼.model3.json'),
  scale: 1,
  alwaysOnTop: true,
  clickThrough: true,
  presentation: { ...DEFAULT_PRESENTATION },
};
let settingsFile: JsonFile;
let pendingFile: JsonFile;
let vault: CredentialVault;
let pending: Record<string, CoordinatorMetadata> = {};
let lastCue: Extract<CompanionEvent, { type: 'cue' }> | undefined;
let lastJudgeMs: number | undefined;
let position: { x: number; y: number } | undefined;
let intendedOverlayBounds: Electron.Rectangle | undefined;
const histories = new Map<string, ConversationHistory>();
function conversation(binding = currentBinding()): ConversationHistory {
  const key = bindingKey(binding);
  let history = histories.get(key);
  if (!history) {
    history = new ConversationHistory();
    histories.set(key, history);
  }
  return history;
}
async function loadHistory(): Promise<void> {
  const binding = currentBinding();
  const active = adapter;
  if (binding.sessionId === '__select_session__') return;
  await conversation(binding).load(active?.history ? () => active.history!(binding) : undefined);
}

function emit(event: CompanionEvent): void {
  if (event.type === 'turn') conversation(event.turn.binding).update(event.turn);
  event = { ...event, selectionId, revision: ++revision };
  if (event.type === 'cue') lastCue = event;
  for (const window of event.type === 'history' ? [chat] : [overlay, chat, settingsWindow])
    if (window && !window.isDestroyed()) window.webContents.send('companion:event', event);
  if (event.type === 'turn' || event.type === 'character' || event.type === 'cue') persistPending();
}
function persistPending(): void {
  if (!coordinator || !pendingFile) return;
  const snapshot = coordinator.snapshot();
  const key = bindingKey(snapshot.binding);
  if (snapshot.pending) pending[key] = snapshot;
  else delete pending[key];
  void pendingFile.write(pending).catch(() => {
    storageFault = true;
  });
}
function currentBinding(): AgentBinding {
  const p = settings.provider;
  return {
    provider: p.provider,
    connectionId: createHash('sha256').update(`${p.provider}:${p.endpoint}`).digest('hex'),
    agentId: p.agentId,
    sessionId: p.sessionId,
    continuity: p.provider === 'mock' ? 'new-session' : 'unverified',
  };
}
async function configure(alreadyLocked = false): Promise<void> {
  if (switching && !alreadyLocked)
    throw new Error('연결을 변경 중입니다. 잠시 후 다시 시도하세요.');
  if (!alreadyLocked) switching = true;
  try {
    persistPending();
    await coordinator?.dispose();
    coordinator = undefined;
    selectionId = crypto.randomUUID();
    capabilities = unsupportedCapabilities();
    connectionError = undefined;
    const p = settings.provider;
    const token = () => vault.get(credentialScope(p.provider, p.endpoint));
    adapter =
      p.provider === 'hermes'
        ? p.endpoint.startsWith('ssh:')
          ? new HermesSshAdapter({
              endpoint: p.endpoint,
              profile: p.agentId,
              bridgePath: join(root, 'scripts/hermes-bridge.py'),
            })
          : new HermesAdapter({ endpoint: p.endpoint, token })
        : p.provider === 'grok_bot'
          ? new GrokBotAdapter({ endpoint: p.endpoint, token })
          : new MockAdapter();
    const binding = currentBinding();
    const jev = settings.jevEnabled
      ? new JevJudge({ token: () => vault.get(credentialScope('jev')), model: settings.jevModel })
      : undefined;
    const judge =
      jev && smoke
        ? {
            judge: async (text: string, signal: AbortSignal, context?: ExpressionContext) => {
              const start = Date.now();
              try {
                return await jev.judge(text, signal, context);
              } finally {
                lastJudgeMs = Date.now() - start;
              }
            },
          }
        : jev;
    const ownSelection = selectionId;
    const ownAdapter = adapter;
    const ownHistory = conversation(binding);
    let restoredHistoryRefreshed = false;
    coordinator = new TurnCoordinator({
      adapter,
      binding,
      judge,
      onEvent: (event) => {
        if (selectionId !== ownSelection) return;
        emit(event);
        if (
          event.type === 'turn' &&
          event.turn.requestId === ownHistory.restoredRequestId &&
          !restoredHistoryRefreshed &&
          ['completed', 'failed', 'cancelled', 'interrupted'].includes(event.turn.state) &&
          ownAdapter.history
        ) {
          restoredHistoryRefreshed = true;
          void ownHistory
            .refresh(() => ownAdapter.history!(binding))
            .then(
              () => {
                if (selectionId === ownSelection)
                  emit({
                    type: 'history',
                    messages: ownHistory.snapshot(),
                    restoredRequestId: ownHistory.restoredRequestId,
                  });
              },
              () => {
                if (selectionId === ownSelection)
                  emit({
                    type: 'history',
                    messages: ownHistory.snapshot(),
                    restoredRequestId: ownHistory.restoredRequestId,
                    error: '복구된 답변의 기록을 불러오지 못했습니다. 채팅창을 다시 열어 주세요.',
                  });
              },
            );
        }
      },
      beforeSubmit: async (metadata, text) => {
        if (storageFault) throw new Error('요청 상태 저장에 실패했습니다.');
        pending[bindingKey(metadata.binding)] = metadata;
        await pendingFile.write(pending);
        conversation(metadata.binding).submitted(metadata.pending!.requestId, text);
      },
    });
    const saved = pending[bindingKey(binding)];
    if (saved?.pending) {
      // Native history has no durable admission→row join. Re-read the provider's display
      // history on settlement instead of adding a second copy of a restored answer.
      if (adapter.history) ownHistory.restoredRequestId = saved.pending.requestId;
      if (
        (adapter instanceof HermesAdapter || adapter instanceof HermesSshAdapter) &&
        saved.pending.remoteRunId
      )
        adapter.restore(
          { binding, requestId: saved.pending.requestId, turnId: saved.pending.turnId },
          saved.pending.remoteRunId,
          () => {},
        );
      coordinator.restore(saved);
    }
  } finally {
    if (!alreadyLocked) switching = false;
  }
}
async function bootstrap(includeHistory = true): Promise<Bootstrap> {
  let historyError: string | undefined;
  const selected = selectionId;
  if (includeHistory) {
    try {
      await loadHistory();
    } catch {
      historyError = '이전 대화를 불러오지 못했습니다. 연결을 확인하고 채팅창을 다시 열어 주세요.';
    }
    if (selected !== selectionId) return bootstrap(includeHistory);
  }
  const state = {
    selectionId,
    revision,
    settings: structuredClone(settings),
    model: structuredClone(model),
    storageSecure: vault.secure,
    overlayInput,
    overlayInputError,
    capabilities: structuredClone(capabilities),
    connectionError: storageFault
      ? '요청 상태를 저장하지 못해 새 전송을 차단했습니다. 저장 공간과 권한을 확인하세요.'
      : (connectionError ?? modelError),
    currentTurn: coordinator?.current,
    ...(includeHistory
      ? {
          history: conversation().snapshot(),
          historyError,
          historyRestoredRequestId: conversation().restoredRequestId,
        }
      : {}),
  };
  const [hermes, grok_bot, jev] = await Promise.all([
    vault.has(credentialScope('hermes', state.settings.provider.endpoint)),
    vault.has(credentialScope('grok_bot', state.settings.provider.endpoint)),
    vault.has(credentialScope('jev')),
  ]);
  return { ...state, credentials: { hermes, grok_bot, jev } };
}
async function loadModel(): Promise<void> {
  try {
    model = await models.load(settings.modelPath);
    applyModelMappings(model, settings);
    modelError = undefined;
  } catch {
    model = undefined;
    modelError = '모델을 불러올 수 없습니다. 설정에서 .model3.json 파일을 선택하세요.';
  }
}
const csp =
  "default-src 'none'; script-src 'self' app: 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' app: blob:; connect-src app:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'";
async function handleApp(url: URL): Promise<Response> {
  if (url.hostname === 'model') return models.handle(url);
  if (!['ui', 'runtime'].includes(url.hostname)) return new Response('', { status: 404 });
  const path = decodeURIComponent(url.pathname);
  if (path.includes('..') || path.includes('\\') || path.includes('\0'))
    return new Response('', { status: 403 });
  const relative = path === '/' ? 'index.html' : path.slice(1);
  if (!/^[a-zA-Z0-9_./-]+$/.test(relative)) return new Response('', { status: 404 });
  try {
    const bytes = await readFile(
      join(root, 'dist', url.hostname === 'ui' ? 'renderer' : 'runtime', relative),
    );
    const type =
      (
        {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.json': 'application/json',
        } as Record<string, string>
      )[extname(relative)] ?? 'application/octet-stream';
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': type,
        'Content-Security-Policy': csp,
        'X-Content-Type-Options': 'nosniff',
        'Access-Control-Allow-Origin': 'app://ui',
      },
    });
  } catch {
    return new Response('', { status: 404 });
  }
}
function secureWindow(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
}
function trusted(
  event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent,
  scope: 'all' | 'chat' | 'controls' = 'all',
): void {
  if (event.senderFrame !== event.sender.mainFrame)
    throw new Error('허용되지 않은 IPC 요청입니다.');
  const windows =
    scope === 'chat'
      ? [chat]
      : scope === 'controls'
        ? [chat, settingsWindow]
        : [overlay, chat, settingsWindow];
  if (!windows.some((w) => w && !w.isDestroyed() && w.webContents === event.sender))
    throw new Error('허용되지 않은 창입니다.');
  const url = new URL(event.senderFrame?.url ?? '');
  if (url.protocol !== 'app:' || url.hostname !== 'ui' || url.pathname !== '/index.html')
    throw new Error('허용되지 않은 페이지입니다.');
}
function openPanel(view: 'chat' | 'settings'): void {
  const existing = view === 'chat' ? chat : settingsWindow;
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return;
  }
  const created = new BrowserWindow({
    width: view === 'chat' ? 470 : 560,
    height: 810,
    minWidth: 400,
    minHeight: 600,
    backgroundColor: '#1e191f',
    show: false,
    title: view === 'chat' ? 'Live2D Companion Chat' : 'Live2D Companion Settings',
    // Independent managed dialogs float on Sway without hiding or blocking chat.
    type: process.platform === 'linux' ? 'dialog' : 'normal',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(root, 'dist/preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  if (view === 'chat') chat = created;
  else settingsWindow = created;
  secureWindow(created);
  created.on('page-title-updated', (event) => event.preventDefault());
  created.once('ready-to-show', () => {
    if (!smoke && !created.isDestroyed()) created.show();
  });
  created.on('closed', () => {
    if (chat === created) chat = undefined;
    if (settingsWindow === created) settingsWindow = undefined;
  });
  void created.loadURL(`app://ui/index.html?view=${view}`);
}
function openChat(): void {
  openPanel('chat');
}
function openSettings(): void {
  openPanel('settings');
}
function updateOverlayInput(): void {
  if (!overlay || overlay.isDestroyed()) return;
  if (overlayInput === 'native-shape') {
    const { width, height } = intendedOverlayBounds ?? overlay.getBounds();
    const shape =
      settings.clickThrough &&
      !overlayInputState.dragging &&
      inputRegion?.width === width &&
      inputRegion.height === height
        ? inputRegion
        : { width, height, rects: [{ x: 0, y: 0, width, height }] };
    inputShape?.update(shape);
    return;
  }
  const ignore = overlayInputState.shouldIgnore(
    settings.clickThrough && overlayInput === 'forward',
  );
  if (ignore === ignoredMouseEvents) return;
  ignoredMouseEvents = ignore;
  overlay.setIgnoreMouseEvents(ignore, overlayInput === 'forward' ? { forward: true } : undefined);
}
function stopOverlayDrag(): void {
  const wasDragging = overlayInputState.dragging;
  overlayInputState.setDragging(false);
  if (wasDragging) {
    positionOverlay();
    void settingsFile
      .write({ settings, position })
      .catch(() => console.error('캐릭터 위치를 저장하지 못했습니다.'));
  } else updateOverlayInput();
}
function positionOverlay(): void {
  if (!overlay) return;
  const size = {
    width: Math.round(440 * settings.scale),
    height: Math.round(680 * settings.scale),
  };
  if (smoke) {
    intendedOverlayBounds = { ...size, x: 0, y: 0 };
    overlay.setBounds(intendedOverlayBounds);
    return;
  }
  const fallback = defaultOverlayPosition(size, screen.getPrimaryDisplay().workArea);
  const candidate = { ...size, ...(position ?? fallback) };
  // Cross monitor boundaries freely, and retain intentional half-body crops.
  // Only recover a completely lost window, after capture ends or on startup.
  const bounds =
    overlayInputState.dragging ||
    intersectsDisplay(
      candidate,
      screen.getAllDisplays().map((display) => display.bounds),
    )
      ? candidate
      : fallback;
  position = { x: bounds.x, y: bounds.y };
  intendedOverlayBounds = bounds;
  overlay.setBounds(bounds);
  overlay.setAlwaysOnTop(settings.alwaysOnTop);
  updateOverlayInput();
}
async function createOverlay(): Promise<void> {
  // Linux focusable:false opts out of WM management, keeping only this overlay
  // above fullscreen windows without taking keyboard focus. The option is
  // constructor-only on Linux, so toggling alwaysOnTop recreates this window.
  ignoredMouseEvents = false;
  inputRegion = undefined;
  inputRegionAt = 0;
  overlayInputState.setDragging(false);
  overlayInputState.acceptHit(true);
  overlay = new BrowserWindow({
    width: 440,
    height: 680,
    title: 'Live2D Companion Overlay',
    focusable: process.platform !== 'linux' || !settings.alwaysOnTop,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(root, 'dist/preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });
  const created = overlay;
  secureWindow(overlay);
  overlay.on('page-title-updated', (event) => event.preventDefault());
  overlay.on('blur', stopOverlayDrag);
  overlay.on('hide', stopOverlayDrag);
  overlay.on('show', updateOverlayInput);
  overlay.on('resize', () => {
    inputRegion = undefined;
    updateOverlayInput();
  });
  overlay.webContents.on('did-start-loading', () => {
    inputRegion = undefined;
    stopOverlayDrag();
    // Keep the error/settings fallback clickable while the renderer reloads.
    overlayInputState.acceptHit(true);
    updateOverlayInput();
  });
  overlay.webContents.on('render-process-gone', () => {
    inputRegion = undefined;
    stopOverlayDrag();
  });
  overlay.on('closed', () => {
    if (overlay !== created) return;
    inputShape?.close();
    inputShape = undefined;
    inputRegion = undefined;
    overlay = undefined;
  });
  positionOverlay();
  if (x11InputRequested) {
    const unavailable = (): void => {
      if (overlay !== created || created.isDestroyed()) return;
      inputShape = undefined;
      overlayInput = 'unsupported';
      overlayInputError =
        'X11 input helper를 사용할 수 없어 클릭 통과를 적용하지 않습니다. 설정값은 유지됩니다.';
      // A killed helper can leave its last server-side input region behind.
      // Electron restores the full region; the visual shape is never changed.
      // Force a state transition: Chromium may otherwise cache an unchanged
      // false value while a helper has independently changed the server region.
      created.setIgnoreMouseEvents(true);
      created.setIgnoreMouseEvents(false);
      ignoredMouseEvents = false;
      emit({ type: 'overlay-input', mode: overlayInput, error: overlayInputError });
    };
    try {
      const helper = await X11InputShape.open(
        join(root, 'dist/native/x11-input'),
        created.getNativeWindowHandle().readUInt32LE(0),
        unavailable,
      );
      if (overlay !== created || created.isDestroyed() || quitting) {
        helper.close();
        return;
      }
      inputShape = helper;
      overlayInput = 'native-shape';
      overlayInputError = undefined;
      updateOverlayInput();
    } catch {
      unavailable();
    }
  }
  overlay.once('ready-to-show', () => {
    if (!smoke) overlay?.showInactive();
  });
  await overlay.loadURL('app://ui/index.html?view=overlay');
}
function registerIpc(): void {
  ipcMain.handle('companion:bootstrap', async (event) => {
    trusted(event);
    return bootstrap(event.sender === chat?.webContents);
  });
  ipcMain.handle('companion:test', async (event) => {
    trusted(event, 'controls');
    const selected = selectionId;
    const active = adapter;
    if (switching || !active) throw new Error('연결 변경 중입니다.');
    try {
      const discovered = await active.discover();
      if (selectionId === selected) {
        capabilities = discovered;
        connectionError = undefined;
      }
    } catch {
      if (selectionId === selected)
        connectionError = '공급자 연결을 확인할 수 없습니다. 주소와 인증 정보를 확인하세요.';
    }
    if (selectionId === selected) emit({ type: 'configuration' });
    return bootstrap(event.sender === chat?.webContents);
  });
  ipcMain.handle('companion:sessions', async (event) => {
    trusted(event, 'controls');
    if (switching) throw new Error('연결 변경 중입니다.');
    return (await adapter?.listSessions?.(settings.provider.agentId)) ?? [];
  });
  ipcMain.handle('companion:create-session', async (event) => {
    trusted(event, 'controls');
    if (switching || quitting || !adapter?.createSession)
      throw new Error('이 연결은 세션 생성을 지원하지 않습니다.');
    switching = true;
    try {
      const created = await adapter.createSession(settings.provider.agentId);
      settings.provider.sessionId = created.id;
      await settingsFile.write({ settings, position });
      await configure(true);
      overlay?.reload();
      emit({ type: 'configuration' });
      return await bootstrap(event.sender === chat?.webContents);
    } finally {
      switching = false;
    }
  });
  ipcMain.handle('companion:settings', async (event, input: unknown) => {
    trusted(event, 'controls');
    const next = parseSettings(input);
    const recreateOverlay =
      process.platform === 'linux' && next.alwaysOnTop !== settings.alwaysOnTop;
    if (switching || quitting) throw new Error('연결을 변경 중이거나 앱을 종료하고 있습니다.');
    if (next.modelPath !== settings.modelPath)
      throw new Error('모델은 파일 선택 버튼으로 변경하세요.');
    if (!next.provider.sessionId)
      next.provider.sessionId = next.provider.endpoint.startsWith('ssh:')
        ? '__select_session__'
        : `companion-${crypto.randomUUID()}`;
    const runtimeChanged =
      JSON.stringify(next.provider) !== JSON.stringify(settings.provider) ||
      next.jevEnabled !== settings.jevEnabled ||
      next.jevModel !== settings.jevModel;
    const mappingsChanged =
      JSON.stringify(next.expressionMap ?? {}) !== JSON.stringify(settings.expressionMap ?? {}) ||
      JSON.stringify(next.gestureMap ?? {}) !== JSON.stringify(settings.gestureMap ?? {});
    const reloadOverlay =
      runtimeChanged || mappingsChanged || next.clickThrough !== settings.clickThrough;
    const placementChanged =
      next.scale !== settings.scale || next.alwaysOnTop !== settings.alwaysOnTop;
    switching = true;
    try {
      if (next.presentation?.positionLocked) stopOverlayDrag();
      settings = next;
      await settingsFile.write({ settings, position });
      if (mappingsChanged) await loadModel();
      if (runtimeChanged) await configure(true);
      if (recreateOverlay) {
        overlay?.destroy();
        await createOverlay();
      } else {
        if (placementChanged) positionOverlay();
        updateOverlayInput();
        if (reloadOverlay) overlay?.reload();
        else
          emit({
            type: 'presentation',
            settings: settings.presentation ?? { ...DEFAULT_PRESENTATION },
          });
      }
      if (runtimeChanged || mappingsChanged) emit({ type: 'configuration' });
      return await bootstrap(event.sender === chat?.webContents);
    } finally {
      switching = false;
    }
  });
  ipcMain.handle('companion:credential', async (event, provider: unknown, value: unknown) => {
    trusted(event, 'controls');
    const key = z.enum(['hermes', 'grok_bot', 'jev']).parse(provider);
    await vault.set(
      credentialScope(key, settings.provider.endpoint),
      z.string().max(8000).parse(value),
    );
  });
  ipcMain.handle('companion:model', async (event) => {
    trusted(event, 'controls');
    const selected = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender)!, {
      filters: [{ name: 'Live2D model', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (!selected.canceled && selected.filePaths[0]) {
      const next = await models.load(selected.filePaths[0]);
      settings.modelPath = selected.filePaths[0];
      settings.expressionMap = {};
      settings.gestureMap = {};
      model = next;
      modelError = undefined;
      await settingsFile.write({ settings, position });
      overlay?.reload();
      emit({ type: 'configuration' });
    }
    return bootstrap(event.sender === chat?.webContents);
  });
  ipcMain.handle('companion:preview', (event, input: unknown) => {
    trusted(event, 'controls');
    const preset = characterPreviewSchema.parse(input);
    const current = coordinator?.current;
    if (
      switching ||
      quitting ||
      submissionPending?.selectionId === selectionId ||
      current?.approval ||
      (current && !['completed', 'failed', 'cancelled', 'interrupted'].includes(current.state))
    )
      throw new Error('요청이나 승인 처리가 끝난 뒤 캐릭터를 미리 볼 수 있습니다.');
    emit({ type: 'character.preview', preset });
  });
  ipcMain.handle('companion:send', async (event, text: unknown, expectedSelection: unknown) => {
    trusted(event, 'chat');
    if (quitting || switching || storageFault || !coordinator || !adapter)
      throw new Error('연결 또는 저장소 준비 상태를 확인하세요.');
    if (settings.provider.sessionId === '__select_session__')
      throw new Error('기존 세션을 선택하거나 새 대화를 만드세요.');
    if (expectedSelection !== selectionId)
      throw new Error('대화 대상이 변경되었습니다. 다시 확인하세요.');
    const activeAdapter = adapter;
    const activeCoordinator = coordinator;
    const selected = selectionId;
    if (submissionPending?.selectionId === selected) throw new Error('요청 전송을 준비 중입니다.');
    const submissionToken = Symbol();
    submissionPending = { selectionId: selected, token: submissionToken };
    try {
      await activeAdapter.connect();
      await loadHistory();
      if (switching || selectionId !== selected || coordinator !== activeCoordinator)
        throw new Error('대화 대상이 변경되어 전송하지 않았습니다.');
      await activeCoordinator.send(z.string().trim().min(1).max(32000).parse(text));
    } finally {
      if (submissionPending?.token === submissionToken) submissionPending = undefined;
    }
  });
  const activeRequest = (id: unknown) => {
    if (quitting || switching || !coordinator || id !== coordinator.current?.requestId)
      throw new Error('현재 요청과 일치하지 않습니다.');
    return coordinator;
  };
  ipcMain.handle('companion:cancel', async (event, id: unknown) => {
    trusted(event, 'chat');
    await activeRequest(id).cancel();
  });
  ipcMain.handle('companion:reconcile', async (event, id: unknown) => {
    trusted(event, 'chat');
    await activeRequest(id).reconcile();
  });
  ipcMain.handle(
    'companion:approve',
    async (event, id: unknown, decision: unknown, requestId: unknown) => {
      trusted(event, 'chat');
      await activeRequest(requestId).approve(
        z.string().min(1).max(512).parse(id),
        z.enum(['allow_once', 'deny']).parse(decision),
      );
    },
  );
  ipcMain.handle('companion:open-settings', (event) => {
    trusted(event);
    openSettings();
  });
  ipcMain.handle('companion:chat', (event) => {
    trusted(event);
    openChat();
  });
  ipcMain.handle('companion:displays', (event) => {
    trusted(event, 'controls');
    const current = screen.getDisplayMatching(
      intendedOverlayBounds ?? overlay?.getBounds() ?? screen.getPrimaryDisplay().bounds,
    ).id;
    return screen.getAllDisplays().map((display, index) => ({
      id: display.id,
      label: display.label || `모니터 ${index + 1}`,
      width: display.bounds.width,
      height: display.bounds.height,
      current: display.id === current,
    }));
  });
  ipcMain.handle('companion:display', async (event, id: unknown) => {
    trusted(event, 'controls');
    if (switching || quitting || !overlay || overlay.isDestroyed())
      throw new Error('지금은 캐릭터를 이동할 수 없습니다.');
    const displayId = z.number().int().safe().parse(id);
    const target = screen.getAllDisplays().find((display) => display.id === displayId);
    if (!target) throw new Error('연결된 모니터를 다시 선택하세요.');
    stopOverlayDrag();
    const bounds = intendedOverlayBounds ?? overlay.getBounds();
    const source = screen.getDisplayMatching(bounds);
    const moved = transferOverlay(bounds, source.bounds, target.bounds);
    position = { x: moved.x, y: moved.y };
    positionOverlay();
    overlay.showInactive();
    await settingsFile.write({ settings, position });
  });
  ipcMain.handle('companion:move', async (event, dx: unknown, dy: unknown) => {
    trusted(event);
    const delta = z.number().finite().min(-200).max(200);
    const x = delta.parse(dx);
    const y = delta.parse(dy);
    if (event.sender !== overlay?.webContents) throw new Error('Overlay 전용 요청입니다.');
    if (settings.presentation?.positionLocked || switching || quitting)
      throw new Error('캐릭터 위치가 잠겨 있거나 설정을 변경 중입니다.');
    if (!overlayInputState.dragging)
      throw new Error('캐릭터를 드래그하는 동안만 이동할 수 있습니다.');
    // Use the intended position, rather than a compositor acknowledgement that
    // can lag several pointer events behind on Xwayland.
    const bounds = position ?? overlay.getBounds();
    position = { x: Math.round(bounds.x + x), y: Math.round(bounds.y + y) };
    positionOverlay();
    await settingsFile.write({ settings, position });
  });
  ipcMain.handle(
    'companion:resize',
    async (event, wheel: unknown, screenX: unknown, screenY: unknown) => {
      trusted(event);
      if (event.sender !== overlay?.webContents) throw new Error('Overlay 전용 요청입니다.');
      if (switching || quitting || settings.presentation?.positionLocked)
        throw new Error('캐릭터 위치가 잠겨 있거나 설정을 변경 중입니다.');
      const deltaY = z.number().finite().min(-240).max(240).parse(wheel);
      const coordinate = z.number().finite().min(-1_000_000).max(1_000_000);
      const cursor = { x: coordinate.parse(screenX), y: coordinate.parse(screenY) };
      const bounds = { ...(intendedOverlayBounds ?? overlay.getBounds()), ...position };
      const resized = overlayInputState.resize(settings.scale, deltaY, cursor, bounds);
      if (!resized) throw new Error('캐릭터를 드래그하는 동안만 배율을 바꿀 수 있습니다.');
      if (resized.scale === settings.scale) return;
      settings = { ...settings, scale: resized.scale };
      position = { x: resized.bounds.x, y: resized.bounds.y };
      intendedOverlayBounds = resized.bounds;
      inputRegion = undefined;
      overlay.setBounds(resized.bounds);
      updateOverlayInput();
      emit({ type: 'overlay-scale', scale: settings.scale });
      await settingsFile.write({ settings, position });
    },
  );
  ipcMain.on('companion:drag', (event, active: unknown) => {
    try {
      trusted(event);
      if (event.sender !== overlay?.webContents || typeof active !== 'boolean') return;
      if (active && (settings.presentation?.positionLocked || switching || quitting)) return;
      if (active) {
        const bounds = overlay.getBounds();
        position = { x: bounds.x, y: bounds.y };
      }
      if (active) {
        overlayInputState.setDragging(true);
        updateOverlayInput();
      } else stopOverlayDrag();
    } catch {
      /* invalid renderer input is ignored */
    }
  });
  ipcMain.on('companion:input-region', (event, value: unknown) => {
    try {
      trusted(event);
      if (event.sender !== overlay?.webContents || overlayInput !== 'native-shape') return;
      if (value === null) {
        inputRegion = undefined;
        updateOverlayInput();
        return;
      }
      const now = performance.now();
      if (now - inputRegionAt < 50) return;
      inputRegionAt = now;
      const region = parseInputRegion(value);
      const bounds = intendedOverlayBounds ?? overlay.getBounds();
      if (!region || region.width !== bounds.width || region.height !== bounds.height) return;
      inputRegion = region;
      updateOverlayInput();
    } catch {
      /* invalid renderer input is ignored */
    }
  });
  ipcMain.on('companion:hit', (event, hit: unknown) => {
    try {
      trusted(event);
      if (
        event.sender !== overlay?.webContents ||
        typeof hit !== 'boolean' ||
        overlayInput !== 'forward'
      )
        return;
      overlayInputState.acceptHit(hit);
      updateOverlayInput();
    } catch {
      /* invalid renderer input is ignored */
    }
  });
}
async function runSmoke(): Promise<void> {
  if (smokeHermes) {
    const sessions = await adapter?.listSessions?.(settings.provider.agentId);
    const selected = sessions?.find((entry) => entry.id === settings.provider.sessionId);
    if (selected?.label !== 'Live2D Companion Integration Test') {
      console.error(
        '실제 공급자 smoke는 전용 테스트 세션에서만 실행하세요. 일반 대화에는 전송하지 않습니다.',
      );
      app.exit(1);
      return;
    }
  }
  await mkdir(join(root, 'artifacts'), { recursive: true });
  openChat();
  overlay?.show();
  chat?.show();
  for (let i = 0; i < 100; i++) {
    const state = await overlay?.webContents.executeJavaScript('window.__avatarStatus');
    if (state?.loaded && state.frames > 1) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  for (let i = 0; i < 50; i++) {
    if (await chat?.webContents.executeJavaScript('window.__uiReady === true')) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await chat?.webContents.executeJavaScript(`
    window.__chatViewSentinel = document.getElementById('conversation');
    document.getElementById('message').value = '설정 창 보존 검사';
    for (let i=0;i<20;i++) {
      const row=document.createElement('p');row.dataset.windowProbe='true';
      row.textContent='로컬 설정 창 표시 검사';row.style.height='60px';
      document.getElementById('conversation').append(row);
    }
    document.getElementById('conversation').scrollTop=240;
    document.getElementById('settings-toggle').click();
  `);
  for (let i = 0; i < 100; i++) {
    if (
      settingsWindow &&
      (await settingsWindow.webContents.executeJavaScript('window.__uiReady === true'))
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  settingsWindow?.show();
  const firstSettings = settingsWindow;
  await chat?.webContents.executeJavaScript("document.getElementById('settings-toggle').click()");
  const chatUnchanged = await chat?.webContents.executeJavaScript(`
    window.__chatViewSentinel===document.getElementById('conversation') &&
    document.getElementById('conversation').scrollTop===240 &&
    document.getElementById('message').value==='설정 창 보존 검사' &&
    !document.getElementById('chat').hidden && document.getElementById('settings').hidden &&
    !document.getElementById('welcome') && !document.getElementById('expression-status')
  `);
  const settingsIsolated = await settingsWindow?.webContents.executeJavaScript(`
    !document.getElementById('settings').hidden && document.getElementById('chat').hidden &&
    typeof require==='undefined'
  `);
  const settingsCannotSubmit = await settingsWindow?.webContents.executeJavaScript(`(async()=>{
    const b=await window.companion.bootstrap();
    const tested=await window.companion.testConnection();
    const rejected=await window.companion.send('설정 창은 메시지를 전송하지 않음', b.selectionId).then(()=>false,()=>true);
    return rejected && !Object.hasOwn(b,'history') && !Object.hasOwn(tested,'history');
  })()`);
  const closedSettings = new Promise<void>((resolve) =>
    settingsWindow?.once('closed', () => resolve()),
  );
  await settingsWindow?.webContents.executeJavaScript(
    "document.getElementById('settings-close').click()",
  );
  await closedSettings;
  await chat?.webContents.executeJavaScript("document.getElementById('settings-toggle').click()");
  for (let i = 0; i < 100; i++) {
    if (
      settingsWindow &&
      (await settingsWindow.webContents.executeJavaScript('window.__uiReady === true'))
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  settingsWindow?.show();
  const independentSettings = Boolean(
    chatUnchanged &&
    settingsIsolated &&
    settingsCannotSubmit &&
    firstSettings?.isDestroyed() &&
    settingsWindow &&
    chat?.isVisible(),
  );
  await chat?.webContents.executeJavaScript(`
    document.getElementById('message').value='';
    for(const row of document.querySelectorAll('[data-window-probe]'))row.remove();
  `);
  const localizedMaps = await settingsWindow?.webContents.executeJavaScript(`(()=>{
    const expression = Array.from(document.querySelectorAll('#expression-maps option')).find(o=>o.value==='脸红');
    const motion = Array.from(document.querySelectorAll('#gesture-maps option')).find(o=>o.value==='竖手指切出来动画');
    return expression?.textContent==='홍조' && expression.title==='脸红' &&
      motion?.textContent==='검지 포즈 시작' && motion.title==='竖手指切出来动画';
  })()`);
  let previewSafety = true;
  let presentationControls = true;
  let pendingSelection = true;
  let mappingCoverage = true;
  const mappingChecks: Record<string, boolean> = {};
  if (!smokeHermes) {
    const beforeSelection = selectionId;
    const beforeRequest = coordinator?.current?.requestId;
    const invalidPreset = await chat?.webContents.executeJavaScript(
      "window.companion.previewCharacter('invalid').then(()=>false,()=>true)",
    );
    const overlayRejected = await overlay?.webContents.executeJavaScript(
      "window.companion.previewCharacter('thinking').then(()=>false,()=>true)",
    );
    const previews: string[] = [];
    for (const preset of CHARACTER_PREVIEWS) {
      await settingsWindow?.webContents.executeJavaScript(
        `document.querySelector('[data-preview="${preset}"]').click()`,
      );
      for (let i = 0; i < 40; i++) {
        if (
          await overlay?.webContents.executeJavaScript(
            `window.__avatarStatus?.lastPreview === '${preset}'`,
          )
        ) {
          previews.push(preset);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    previewSafety = Boolean(
      invalidPreset &&
      overlayRejected &&
      previews.length === CHARACTER_PREVIEWS.length &&
      selectionId === beforeSelection &&
      coordinator?.current?.requestId === beforeRequest &&
      !lastJudgeMs,
    );
    const selectedDefaults = await settingsWindow?.webContents.executeJavaScript(`
      document.querySelector('#gesture-maps [data-map="thinking"]').value === '${THINKING_MOTION}' &&
      document.querySelector('#expression-maps [data-map="surprised"]').value === '${SURPRISED_EXPRESSION}'
    `);
    mappingChecks.selectedDefaults = Boolean(selectedDefaults);
    for (const motion of ['竖手指切出来动画', THINKING_MOTION]) {
      const reloaded = new Promise<void>((resolve) =>
        overlay?.webContents.once('did-finish-load', () => resolve()),
      );
      await chat?.webContents.executeJavaScript(`(async()=>{
        const b = await window.companion.bootstrap();
        await window.companion.saveSettings({...b.settings,
          gestureMap:{...b.settings.gestureMap,thinking:'${motion}'},
          expressionMap:{...b.settings.expressionMap,surprised:'${SURPRISED_EXPRESSION}'}});
      })()`);
      await reloaded;
      for (let i = 0; i < 100; i++) {
        if (
          await overlay?.webContents.executeJavaScript(
            'window.__avatarStatus?.loaded && window.__avatarStatus.frames > 3',
          )
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await chat?.webContents.executeJavaScript("window.companion.previewCharacter('thinking')");
      await new Promise((resolve) => setTimeout(resolve, 300));
      mappingChecks[`preview:${motion}`] = Boolean(
        await overlay?.webContents.executeJavaScript(`
        window.__avatarStatus?.lastMotion === '${motion}' && window.__avatarStatus.motionActive
      `),
      );
      await chat?.webContents.executeJavaScript("window.companion.previewCharacter('reset')");
      emit({ type: 'character', state: 'thinking' });
      await new Promise((resolve) => setTimeout(resolve, 300));
      mappingChecks[`state:${motion}`] = Boolean(
        await overlay?.webContents.executeJavaScript(`
        window.__avatarStatus?.lastMotion === '${motion}' && window.__avatarStatus.motionActive
      `),
      );
      emit({ type: 'character', state: 'idle' });
      await chat?.webContents.executeJavaScript("window.companion.previewCharacter('reset')");
    }
    const savedMappings = (await settingsFile.readStrict()) as { settings: AppSettings };
    mappingCoverage = Boolean(
      Object.values(mappingChecks).every(Boolean) &&
      savedMappings.settings.gestureMap?.thinking === THINKING_MOTION &&
      savedMappings.settings.expressionMap?.surprised === SURPRISED_EXPRESSION &&
      selectionId === beforeSelection &&
      coordinator?.current?.requestId === beforeRequest,
    );
  }
  if (!smokeHermes) {
    const chatLoaded = new Promise<void>((resolve) =>
      chat?.webContents.once('did-finish-load', () => resolve()),
    );
    chat?.reload();
    await chatLoaded;
    for (let i = 0; i < 100; i++) {
      if (await chat?.webContents.executeJavaScript('window.__uiReady === true')) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  await chat?.webContents.executeJavaScript(
    "document.getElementById('message').value='연결 테스트입니다. 도구를 사용하지 말고, 정말 반갑고 기쁜 마음을 담은 한국어 인사 한 문장만 답해 주세요.';document.getElementById('composer').requestSubmit()",
  );
  if (!smokeHermes) {
    const activeRejected = await chat?.webContents.executeJavaScript(
      "window.companion.previewCharacter('happy').then(()=>false,()=>true)",
    );
    previewSafety = Boolean(previewSafety && activeRejected);
  }
  for (let i = 0; i < 200; i++) {
    if (coordinator?.current?.state === 'completed' && (!smokeJev || lastCue)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!smokeJev && coordinator?.current)
    emit({
      type: 'cue',
      cue: {
        requestId: coordinator.current.requestId,
        segmentId: 1,
        emotion: 'happy',
        gesture: 'wave',
        confidence: 1,
        source: 'fallback',
      },
    });
  if (lastCue) {
    const cueFrame = await overlay?.webContents.executeJavaScript(
      'window.__avatarStatus?.frames ?? 0',
    );
    for (let i = 0; i < 80; i++) {
      const state = await overlay?.webContents.executeJavaScript('window.__avatarStatus');
      if (
        state?.frames > cueFrame &&
        (state.lastExpression === 'neutral' || state.expressionWeight >= 0.8) &&
        (state.lastMotion === 'none' || state.motionActive)
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  const renderer = await overlay?.webContents.executeJavaScript('window.__avatarStatus');
  const alpha = await overlay?.webContents.executeJavaScript(
    "(()=>{const c=document.getElementById('avatar'),g=c.getContext('webgl'),p=new Uint8Array(4);g.readPixels(0,0,1,1,g.RGBA,g.UNSIGNED_BYTE,p);return {corner:p[3],width:c.width,height:c.height}})()",
  );
  const screenshot = await overlay?.webContents.capturePage();
  if (screenshot) await writeFile(join(root, 'artifacts/live2d-smoke.png'), screenshot.toPNG());
  const chatshot = await chat?.webContents.capturePage();
  if (chatshot) await writeFile(join(root, 'artifacts/chat-smoke.png'), chatshot.toPNG());
  const boundaries = await chat?.webContents.executeJavaScript(
    '({node:typeof require, bridge:typeof window.companion.send})',
  );
  const result = {
    independentSettings,
    localizedMaps,
    mappingCoverage,
    mappingChecks,
    renderer,
    alpha,
    provider: settings.provider.provider,
    turn: coordinator?.current?.state,
    textReceived: Boolean(coordinator?.current?.text),
    boundaries,
    jev: {
      requested: smokeJev,
      source: lastCue?.cue.source,
      emotion: lastCue?.cue.emotion,
      gesture: lastCue?.cue.gesture,
      lastRoundtripMs: lastJudgeMs,
    },
    secureStorage: vault.secure,
    credentialSource: smokeEnv ? 'env-file' : smokeStdinJev ? 'stdin' : 'vault',
  };
  let uiRouting = true;
  let monitorSelection = true;
  let historyRestored = true;
  const firstProvider = { ...settings.provider };
  if (!smokeHermes) {
    const transcript = await chat?.webContents.executeJavaScript(
      "Array.from(document.querySelectorAll('#conversation .message')).map(row=>({role:row.classList.contains('user')?'user':'assistant',text:row.querySelector('.message-text').textContent}))",
    );
    const sameTranscript = async () => {
      for (let i = 0; i < 100; i++) {
        if (await chat?.webContents.executeJavaScript('window.__uiReady === true')) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return chat?.webContents.executeJavaScript(
        `JSON.stringify(Array.from(document.querySelectorAll('#conversation .message')).map(row=>({role:row.classList.contains('user')?'user':'assistant',text:row.querySelector('.message-text').textContent}))) === ${JSON.stringify(JSON.stringify(transcript))}`,
      );
    };
    chat?.reload();
    await new Promise<void>((resolve) =>
      chat?.webContents.once('did-finish-load', () => resolve()),
    );
    const reloadRestored = await sameTranscript();
    const closedChat = new Promise<void>((resolve) => chat?.once('closed', () => resolve()));
    chat?.close();
    await closedChat;
    openChat();
    const reopenRestored = await sameTranscript();
    historyRestored = Boolean(transcript?.length === 2 && reloadRestored && reopenRestored);
    Object.assign(result, {
      historyRestored,
      historyRestoreChecks: {
        initialCount: transcript?.length,
        cachedCount: conversation().snapshot().length,
        reloadRestored,
        reopenRestored,
      },
    });
    await chat?.webContents.executeJavaScript("window.companion.previewCharacter('reset')");
    emit({
      type: 'cue',
      cue: {
        requestId: coordinator!.current!.requestId,
        segmentId: 2,
        emotion: 'surprised',
        gesture: 'none',
        confidence: 1,
        source: 'fallback',
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 350));
    mappingChecks.surprised = Boolean(
      await overlay?.webContents.executeJavaScript(`
      window.__avatarStatus?.lastExpression === '${SURPRISED_EXPRESSION}' &&
      window.__avatarStatus.expressionWeight > .8 && window.__avatarStatus.actingPreset === 'surprised'
    `),
    );
    mappingCoverage = Boolean(mappingCoverage && mappingChecks.surprised);
    const surprisedShot = await overlay?.webContents.capturePage();
    if (surprisedShot)
      await writeFile(join(root, 'artifacts/surprised-smoke.png'), surprisedShot.toPNG());
    Object.assign(result, { mappingCoverage });
    await chat?.webContents.executeJavaScript("window.companion.previewCharacter('reset')");
    const beforeDisplaySelection = selectionId;
    const beforeDisplayRequest = coordinator?.current?.requestId;
    for (let i = 0; i < 40; i++) {
      if (
        await settingsWindow?.webContents.executeJavaScript(
          "document.getElementById('display-list').options.length > 0",
        )
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const listed = await settingsWindow?.webContents.executeJavaScript(
      "document.getElementById('display-list').options.length",
    );
    await settingsWindow?.webContents.executeJavaScript(
      "document.getElementById('move-display').click()",
    );
    let moved = false;
    for (let i = 0; i < 40; i++) {
      moved = Boolean(
        await settingsWindow?.webContents.executeJavaScript(
          "!document.getElementById('move-display').disabled && document.getElementById('settings-notice').textContent.includes('캐릭터를 선택한 모니터로')",
        ),
      );
      if (moved) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const rejectedUnknown = await chat?.webContents.executeJavaScript(
      'window.companion.moveToDisplay(Number.MAX_SAFE_INTEGER).then(()=>false,()=>true)',
    );
    monitorSelection =
      listed === screen.getAllDisplays().length &&
      moved &&
      rejectedUnknown &&
      selectionId === beforeDisplaySelection &&
      coordinator?.current?.requestId === beforeDisplayRequest;
    Object.assign(result, { monitorSelection });
    // Earlier mapping probes call main directly, bypassing the settings form's
    // adoptBootstrap. Reopen its renderer before testing real form edits.
    const settingsReloaded = new Promise<void>((resolve) =>
      settingsWindow?.webContents.once('did-finish-load', () => resolve()),
    );
    settingsWindow?.reload();
    await settingsReloaded;
    for (let i = 0; i < 100; i++) {
      if (await settingsWindow?.webContents.executeJavaScript('window.__uiReady === true')) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const beforePresentationSelection = selectionId;
    const beforePresentationRequest = coordinator?.current?.requestId;
    const beforePresentationPosition = structuredClone(position);
    await overlay?.webContents.executeJavaScript('window.__presentationSentinel = true');
    await settingsWindow?.webContents.executeJavaScript(`
      for (const [id, value] of [['intensity','quiet'],['framing','bust'],['position-locked',true],['reduced-motion',true]]) {
        const control = document.getElementById(id);
        if (typeof value === 'boolean') control.checked = value;
        else control.value = value;
        control.dispatchEvent(new Event('change', {bubbles:true}));
      }
    `);
    for (let i = 0; i < 80; i++) {
      if (
        settings.presentation?.intensity === 'quiet' &&
        settings.presentation.framing === 'bust' &&
        settings.presentation.positionLocked &&
        settings.presentation.reducedMotion
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const lockedManipulation = await overlay?.webContents.executeJavaScript(`(async()=>{
      window.companion.setDragging(true);
      const move = await window.companion.move(10,10).then(()=>false,()=>true);
      const resize = await window.companion.resizeOverlay(-120,100,100).then(()=>false,()=>true);
      return move && resize && document.getElementById('avatar').classList.contains('position-locked') &&
        window.__presentationSentinel === true;
    })()`);
    const persistedPresentation = (await settingsFile.readStrict()) as { settings?: AppSettings };
    presentationControls = Boolean(
      lockedManipulation &&
      !overlayInputState.dragging &&
      settings.presentation?.intensity === 'quiet' &&
      settings.presentation.framing === 'bust' &&
      settings.presentation.positionLocked &&
      settings.presentation.reducedMotion &&
      JSON.stringify(persistedPresentation.settings?.presentation) ===
        JSON.stringify(settings.presentation) &&
      JSON.stringify(position) === JSON.stringify(beforePresentationPosition) &&
      selectionId === beforePresentationSelection &&
      coordinator?.current?.requestId === beforePresentationRequest,
    );
    const hitPoint = await overlay?.webContents.executeJavaScript(`(()=>{
      const canvas = document.getElementById('avatar');
      const gl = canvas.getContext('webgl'), pixel = new Uint8Array(4);
      for (let y = Math.floor(canvas.height * .3); y < canvas.height * .7; y += 8) {
        for (let x = Math.floor(canvas.width * .35); x < canvas.width * .65; x += 8) {
          gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          if (pixel[3] > 128) return { x: Math.round(x * innerWidth / canvas.width), y: Math.round((canvas.height-y-1)*innerHeight/canvas.height) };
        }
      }
    })()`);
    let lockedGesture = false;
    if (hitPoint && overlay) {
      await overlay.webContents.executeJavaScript(`
        window.__lockedPointerEvents = 0;
        document.getElementById('avatar').addEventListener('pointerdown', ()=>window.__lockedPointerEvents++);
      `);
      chat?.hide();
      settingsWindow?.hide();
      const mouse = (type: 'mouseMove' | 'mouseDown' | 'mouseUp', x: number, y: number) =>
        overlay?.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 });
      mouse('mouseMove', hitPoint.x, hitPoint.y);
      mouse('mouseDown', hitPoint.x, hitPoint.y);
      mouse('mouseMove', hitPoint.x + 24, hitPoint.y + 24);
      mouse('mouseUp', hitPoint.x + 24, hitPoint.y + 24);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const stayedHidden = !chat?.isVisible();
      mouse('mouseMove', hitPoint.x, hitPoint.y);
      mouse('mouseDown', hitPoint.x, hitPoint.y);
      mouse('mouseUp', hitPoint.x, hitPoint.y);
      for (let i = 0; i < 20 && !chat?.isVisible(); i++)
        await new Promise((resolve) => setTimeout(resolve, 25));
      lockedGesture = Boolean(
        stayedHidden &&
        chat?.isVisible() &&
        (await overlay.webContents.executeJavaScript('window.__lockedPointerEvents === 2')),
      );
      chat?.show();
      settingsWindow?.show();
    }
    presentationControls = Boolean(presentationControls && lockedGesture);
    Object.assign(result, { lockedGesture });
    // Reload the overlay to verify bootstrap applies persisted values to a new renderer.
    overlay?.reload();
    let restoredPresentation = false;
    for (let i = 0; i < 100; i++) {
      restoredPresentation = Boolean(
        await overlay?.webContents.executeJavaScript(
          "window.__avatarStatus?.loaded && document.getElementById('avatar').classList.contains('position-locked') && document.getElementById('framing').value === 'bust'",
        ),
      );
      if (restoredPresentation) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    presentationControls = Boolean(presentationControls && restoredPresentation);
    await chat?.webContents
      .executeJavaScript(
        `(async()=>{
      const boot = await window.companion.bootstrap();
      await window.companion.send('/approval', boot.selectionId);
      return window.companion.previewCharacter('happy').then(()=>false,()=>true);
    })()`,
      )
      .then((rejected) => {
        previewSafety = Boolean(previewSafety && rejected);
      });
    // A queued director publication must never override a newer approval block.
    emit({ type: 'character', state: 'working' });
    const blockedFrame = await overlay?.webContents.executeJavaScript(`new Promise(resolve=>{
      requestAnimationFrame(()=>requestAnimationFrame(()=>resolve({
        preset: window.__avatarStatus?.actingPreset, pose: window.__avatarStatus?.posePhase
      })));
    })`);
    const approvalBlocked = blockedFrame?.preset === 'neutral' && blockedFrame?.pose === 'none';
    await chat?.webContents.executeJavaScript("document.getElementById('allow').click()");
    let approvalResumed = false;
    for (let i = 0; i < 80; i++) {
      approvalResumed = Boolean(
        await overlay?.webContents.executeJavaScript(
          "['thinking','working'].includes(window.__avatarStatus?.actingPreset)",
        ),
      );
      if (approvalResumed) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    previewSafety = Boolean(previewSafety && approvalBlocked && approvalResumed);
    Object.assign(result, { approvalBlocked, approvalResumed });
    for (let i = 0; i < 80; i++) {
      if (!coordinator?.current?.approval && coordinator?.current?.state === 'completed') break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    Object.assign(result, { presentationControls, previewSafety });
    const previousSession = settings.provider.sessionId;
    await settingsWindow?.webContents.executeJavaScript(
      "document.getElementById('create-session').click()",
    );
    for (let i = 0; i < 100; i++) {
      if (settings.provider.sessionId !== previousSession) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    const newSessionCleared = await chat?.webContents.executeJavaScript(
      "document.querySelectorAll('#conversation .message').length===0 && document.getElementById('provider-badge').textContent==='MOCK DEMO'",
    );
    // Delayed connects are selection-scoped: switching targets may submit immediately,
    // and the old handler's finally must not erase the new target's pending guard.
    const oldAdapter = adapter!;
    const oldCoordinator = coordinator;
    const oldSelection = selectionId;
    const oldConnect = oldAdapter.connect;
    let releaseOld!: () => void;
    let oldConnectStarted = false;
    const oldGate = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    oldAdapter.connect = async () => {
      oldConnectStarted = true;
      await oldGate;
    };
    await chat?.webContents.executeJavaScript(`
      window.__oldPendingSend = window.companion.send('Mock 이전 연결 대기 검사', '${oldSelection}').then(()=>false,()=>true);
      true;
    `);
    for (let i = 0; i < 20 && !oldConnectStarted; i++)
      await new Promise((resolve) => setTimeout(resolve, 25));
    await chat?.webContents.executeJavaScript('window.companion.createSession().then(()=>true)');
    const newSelection = selectionId;
    const newAdapter = adapter!;
    const newConnect = newAdapter.connect;
    let releaseNew!: () => void;
    let newConnectStarted = false;
    const newGate = new Promise<void>((resolve) => {
      releaseNew = resolve;
    });
    newAdapter.connect = async () => {
      newConnectStarted = true;
      await newGate;
    };
    await chat?.webContents.executeJavaScript(`
      window.__newPendingSend = window.companion.send('Mock 새 연결 대기 검사', '${newSelection}').then(()=>true,()=>false);
      true;
    `);
    for (let i = 0; i < 20 && !newConnectStarted; i++)
      await new Promise((resolve) => setTimeout(resolve, 25));
    const newToken = submissionPending?.token;
    releaseOld();
    const oldRejected = await chat?.webContents.executeJavaScript('window.__oldPendingSend');
    const guardOwned =
      newToken !== undefined &&
      submissionPending?.token === newToken &&
      submissionPending.selectionId === newSelection;
    const pendingPreviewRejected = await chat?.webContents.executeJavaScript(
      "window.companion.previewCharacter('happy').then(()=>false,()=>true)",
    );
    releaseNew();
    const newSubmitted = await chat?.webContents.executeJavaScript('window.__newPendingSend');
    oldAdapter.connect = oldConnect;
    newAdapter.connect = newConnect;
    pendingSelection = Boolean(
      oldConnectStarted &&
      newConnectStarted &&
      oldRejected &&
      oldSelection !== newSelection &&
      guardOwned &&
      pendingPreviewRejected &&
      newSubmitted &&
      !oldCoordinator?.current &&
      coordinator?.current?.binding.sessionId === settings.provider.sessionId,
    );
    for (let i = 0; i < 40 && coordinator?.current?.state !== 'completed'; i++)
      await new Promise((resolve) => setTimeout(resolve, 25));
    Object.assign(result, { pendingSelection });
    await settingsWindow?.webContents.executeJavaScript(
      "document.getElementById('provider').value='hermes';document.getElementById('endpoint').value='https://example.invalid';document.getElementById('agent-id').value='default';document.getElementById('session-id').value='routing-test';document.getElementById('load-sessions').click()",
    );
    for (let i = 0; i < 100; i++) {
      if (
        await chat?.webContents.executeJavaScript(
          "document.getElementById('provider-badge').textContent.includes('HERMES')",
        )
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const providerSwitchCleared = await chat?.webContents.executeJavaScript(
      "document.querySelectorAll('#conversation .message').length===0 && document.getElementById('provider-badge').textContent.includes('HERMES') && document.getElementById('approval').hidden",
    );
    uiRouting = Boolean(newSessionCleared && providerSwitchCleared);
    Object.assign(result, { uiRouting: { newSessionCleared, providerSwitchCleared } });
    await chat?.webContents.executeJavaScript(`(async()=>{
      const boot = await window.companion.bootstrap();
      await window.companion.saveSettings({...boot.settings,provider:${JSON.stringify(firstProvider)}});
    })()`);
    const historyReloaded = new Promise<void>((resolve) =>
      chat?.webContents.once('did-finish-load', () => resolve()),
    );
    chat?.reload();
    await historyReloaded;
    for (let i = 0; i < 100; i++) {
      if (await chat?.webContents.executeJavaScript('window.__uiReady === true')) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const expectedHistory = conversation()
      .snapshot()
      .map(({ role, text }) => ({ role, text }));
    const sessionHistoryRestored = await chat?.webContents.executeJavaScript(
      `JSON.stringify(Array.from(document.querySelectorAll('#conversation .message')).map(row=>({role:row.classList.contains('user')?'user':'assistant',text:row.querySelector('.message-text').textContent}))) === ${JSON.stringify(JSON.stringify(expectedHistory))}`,
    );
    historyRestored = Boolean(historyRestored && sessionHistoryRestored);
    Object.assign(result, { historyRestored, sessionHistoryRestored });
  }
  await writeFile(join(root, 'artifacts/desktop-smoke.json'), JSON.stringify(result, null, 2));
  if (smokeHermes && smokeJev)
    await writeFile(join(root, 'artifacts/desktop-live.json'), JSON.stringify(result, null, 2));
  const cueApplied =
    !lastCue ||
    ((renderer?.lastExpression === 'neutral' || renderer?.expressionActive) &&
      (renderer?.lastMotion === 'none' || renderer?.motionActive));
  app.exit(
    renderer?.loaded &&
      alpha.corner === 0 &&
      result.turn === 'completed' &&
      cueApplied &&
      uiRouting &&
      monitorSelection &&
      localizedMaps &&
      independentSettings &&
      mappingCoverage &&
      presentationControls &&
      previewSafety &&
      pendingSelection &&
      historyRestored &&
      (!smokeJev || (lastCue?.cue.source === 'jev' && renderer.lastCue))
      ? 0
      : 1,
  );
}

app
  .whenReady()
  .then(async () => {
    settingsFile = new JsonFile(app.getPath('userData'), 'settings.json');
    pendingFile = new JsonFile(app.getPath('userData'), 'pending-requests.json');
    const stored = await settingsFile.read();
    if (stored && typeof stored === 'object' && 'settings' in stored) {
      try {
        settings = parseSettings(stored.settings);
      } catch {
        /* safe defaults */
      }
      if ('position' in stored) {
        const result = z
          .object({ x: z.number().finite(), y: z.number().finite() })
          .safeParse(stored.position);
        if (result.success) position = result.data;
      }
    }
    if (!stored && !smoke) {
      try {
        const connection = JSON.parse(
          await readFile(join(root, 'local-assets/connection.json'), 'utf8'),
        );
        settings = parseSettings({ ...settings, provider: connection, jevEnabled: true });
      } catch {
        /* optional private local profile */
      }
    }
    if (smoke)
      settings = {
        ...settings,
        provider: {
          provider: 'mock',
          endpoint: '',
          agentId: 'smoke',
          sessionId: `smoke-${Date.now()}`,
        },
        jevEnabled: false,
        ...(!smokeHermes ? { expressionMap: undefined, gestureMap: undefined } : {}),
        presentation: { ...DEFAULT_PRESENTATION },
      };
    if (smoke && smokeHermes) {
      const connection = JSON.parse(
        await readFile(join(root, 'local-assets/connection.json'), 'utf8'),
      ) as AppSettings['provider'];
      settings = parseSettings({ ...settings, provider: connection });
    }
    const previous = await pendingFile.readStrict();
    if (previous && typeof previous === 'object' && !Array.isArray(previous))
      pending = previous as Record<string, CoordinatorMetadata>;
    vault = new CredentialVault(
      new JsonFile(app.getPath('userData'), 'protected-credentials.json'),
      {
        available: async () =>
          (await safeStorage.isAsyncEncryptionAvailable()) &&
          (process.platform !== 'linux' ||
            safeStorage.getSelectedStorageBackend() !== 'basic_text'),
        encrypt: (value) => safeStorage.encryptStringAsync(value),
        decrypt: async (value) => (await safeStorage.decryptStringAsync(value)).result,
      },
    );
    await vault.initialize();
    if (!smoke || smokeEnv) {
      const key = await readJevEnv(join(root, '.env'));
      if (key) await vault.set(credentialScope('jev'), key);
      else if (smokeEnv) throw new EnvKeyError('실제 .env 검사에 사용할 Jev 키가 없습니다.');
      if (smoke && smokeEnv) settings.jevEnabled = true;
    }
    if (smoke && smokeStdinJev) {
      const key = readFileSync(3, 'utf8').trim();
      await vault.set(credentialScope('jev'), key);
      settings.jevEnabled = true;
    }
    await loadModel();
    protocol.handle('app', (request) => handleApp(new URL(request.url)));
    session.defaultSession.setPermissionRequestHandler((_w, _p, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
      (_details, callback) => callback({ cancel: true }),
    );
    registerIpc();
    await configure();
    await createOverlay();
    const iconPixels = Buffer.alloc(24 * 24 * 4);
    for (let y = 0; y < 24; y++)
      for (let x = 0; x < 24; x++) {
        const offset = (y * 24 + x) * 4;
        if ((x - 11.5) ** 2 + (y - 11.5) ** 2 < 125) {
          const cross = Math.abs(x - 11.5) < 1.5 || Math.abs(y - 11.5) < 1.5;
          iconPixels.set(cross ? [244, 250, 245, 255] : [88, 110, 49, 255], offset);
        }
      }
    const icon = nativeImage.createFromBitmap(iconPixels, { width: 24, height: 24 });
    if (!smoke) {
      tray = new Tray(icon);
      tray.setToolTip('DeepSeek Companion');
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: '채팅', click: openChat },
          { label: '설정', click: openSettings },
          {
            label: '캐릭터 위치 복구',
            click: () => {
              position = undefined;
              positionOverlay();
              overlay?.showInactive();
            },
          },
          { label: '종료', click: () => app.quit() },
        ]),
      );
      tray.on('click', openChat);
      globalShortcut.register('CommandOrControl+Shift+Space', openChat);
      globalShortcut.register('CommandOrControl+Shift+Home', () => {
        position = undefined;
        positionOverlay();
        overlay?.showInactive();
      });
    }
    screen.on('display-removed', () => {
      stopOverlayDrag();
      positionOverlay();
      void settingsFile
        .write({ settings, position })
        .catch(() => console.error('캐릭터 위치를 저장하지 못했습니다.'));
    });
    screen.on('display-metrics-changed', positionOverlay);
    if (smoke) await runSmoke();
  })
  .catch(async (error) => {
    console.error(
      error instanceof EnvKeyError
        ? error.message
        : '앱 초기화 실패. 모델·SDK·보호 저장소 구성을 확인하세요.',
    );
    app.exit(1);
  });
app.on('window-all-closed', () => {
  if (smoke) app.quit();
});
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  globalShortcut.unregisterAll();
  inputShape?.close();
  inputShape = undefined;
  void (async () => {
    await coordinator?.dispose();
    persistPending();
    await settingsFile?.flush();
    await pendingFile?.flush();
  })()
    .catch(() => {})
    .finally(() => app.quit());
});
