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
} from '../shared/contracts.js';
import { unsupportedCapabilities } from '../shared/contracts.js';
import { parseSettings } from '../shared/validation.js';
import { TurnCoordinator, bindingKey, type CoordinatorMetadata } from '../core/turn-coordinator.js';
import { MockAdapter } from '../adapters/mock.js';
import { HermesAdapter } from '../adapters/hermes.js';
import { HermesSshAdapter } from '../adapters/hermes-ssh.js';
import { GrokBotAdapter } from '../adapters/grok.js';
import { JevJudge } from '../adapters/jev.js';
import { ModelLibrary } from './model-library.js';
import { CredentialVault, JsonFile, credentialScope } from './storage.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const smoke = process.argv.includes('--smoke');
const smokeHermes = process.argv.includes('--smoke-hermes');
const smokeJev = process.argv.includes('--jev-key-fd=3');
app.setName('Live2D Agent Companion');
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
let tray: Tray | undefined;
let coordinator: TurnCoordinator | undefined;
let adapter: AgentAdapter | undefined;
let switching = false;
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
};
let settingsFile: JsonFile;
let pendingFile: JsonFile;
let vault: CredentialVault;
let pending: Record<string, CoordinatorMetadata> = {};
let lastCue: Extract<CompanionEvent, { type: 'cue' }> | undefined;
let lastJudgeMs: number | undefined;
let position: { x: number; y: number } | undefined;

function emit(event: CompanionEvent): void {
  event = { ...event, selectionId, revision: ++revision };
  if (event.type === 'cue') lastCue = event;
  for (const window of [overlay, chat])
    if (window && !window.isDestroyed()) window.webContents.send('companion:event', event);
  persistPending();
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
            judge: async (text: string, signal: AbortSignal) => {
              const start = Date.now();
              try {
                return await jev.judge(text, signal);
              } finally {
                lastJudgeMs = Date.now() - start;
              }
            },
          }
        : jev;
    const ownSelection = selectionId;
    coordinator = new TurnCoordinator({
      adapter,
      binding,
      judge,
      onEvent: (event) => {
        if (selectionId === ownSelection) emit(event);
      },
      beforeSubmit: async (metadata) => {
        if (storageFault) throw new Error('요청 상태 저장에 실패했습니다.');
        pending[bindingKey(metadata.binding)] = metadata;
        await pendingFile.write(pending);
      },
    });
    const saved = pending[bindingKey(binding)];
    if (saved?.pending) {
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
async function bootstrap(): Promise<Bootstrap> {
  const state = {
    selectionId,
    revision,
    settings: structuredClone(settings),
    model: structuredClone(model),
    storageSecure: vault.secure,
    capabilities: structuredClone(capabilities),
    connectionError: storageFault
      ? '요청 상태를 저장하지 못해 새 전송을 차단했습니다. 저장 공간과 권한을 확인하세요.'
      : (connectionError ?? modelError),
    currentTurn: coordinator?.current,
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
    for (const [key, value] of Object.entries(settings.expressionMap ?? {})) {
      const emotion = key as keyof typeof model.expressionMap;
      if (!value) delete model.expressionMap[emotion];
      else if (model.expressions.includes(value)) model.expressionMap[emotion] = value;
    }
    for (const [key, value] of Object.entries(settings.gestureMap ?? {})) {
      const gesture = key as keyof typeof model.gestureMap;
      if (!value) delete model.gestureMap[gesture];
      else if (model.motions.includes(value)) model.gestureMap[gesture] = value;
    }
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
  chatOnly = false,
): void {
  if (event.senderFrame !== event.sender.mainFrame)
    throw new Error('허용되지 않은 IPC 요청입니다.');
  const windows = chatOnly ? [chat] : [overlay, chat];
  if (!windows.some((w) => w && !w.isDestroyed() && w.webContents === event.sender))
    throw new Error('허용되지 않은 창입니다.');
  const url = new URL(event.senderFrame?.url ?? '');
  if (url.protocol !== 'app:' || url.hostname !== 'ui' || url.pathname !== '/index.html')
    throw new Error('허용되지 않은 페이지입니다.');
}
function openChat(): void {
  if (chat && !chat.isDestroyed()) {
    chat.show();
    chat.focus();
    return;
  }
  chat = new BrowserWindow({
    width: 470,
    height: 810,
    minWidth: 400,
    minHeight: 600,
    backgroundColor: '#f6f8f7',
    show: false,
    title: 'DeepSeek Companion',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(root, 'dist/preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  secureWindow(chat);
  chat.once('ready-to-show', () => {
    if (!smoke) chat?.show();
  });
  chat.on('closed', () => {
    chat = undefined;
  });
  void chat.loadURL('app://ui/index.html?view=chat');
}
function positionOverlay(): void {
  if (!overlay) return;
  const size = {
    width: Math.round(440 * settings.scale),
    height: Math.round(680 * settings.scale),
  };
  if (smoke) {
    overlay.setBounds({ ...size, x: 0, y: 0 });
    return;
  }
  const point = position ?? {
    x:
      screen.getPrimaryDisplay().workArea.x +
      screen.getPrimaryDisplay().workArea.width -
      size.width -
      24,
    y:
      screen.getPrimaryDisplay().workArea.y +
      screen.getPrimaryDisplay().workArea.height -
      size.height,
  };
  const area = screen.getDisplayNearestPoint(point).workArea;
  overlay.setBounds({
    width: Math.min(size.width, area.width),
    height: Math.min(size.height, area.height),
    x: Math.max(area.x, Math.min(point.x, area.x + area.width - Math.min(size.width, area.width))),
    y: Math.max(
      area.y,
      Math.min(point.y, area.y + area.height - Math.min(size.height, area.height)),
    ),
  });
  overlay.setAlwaysOnTop(settings.alwaysOnTop);
}
function registerIpc(): void {
  ipcMain.handle('companion:bootstrap', async (event) => {
    trusted(event);
    return bootstrap();
  });
  ipcMain.handle('companion:test', async (event) => {
    trusted(event, true);
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
    return bootstrap();
  });
  ipcMain.handle('companion:sessions', async (event) => {
    trusted(event, true);
    if (switching) throw new Error('연결 변경 중입니다.');
    return (await adapter?.listSessions?.(settings.provider.agentId)) ?? [];
  });
  ipcMain.handle('companion:create-session', async (event) => {
    trusted(event, true);
    if (switching || quitting || !adapter?.createSession)
      throw new Error('이 연결은 세션 생성을 지원하지 않습니다.');
    switching = true;
    try {
      const created = await adapter.createSession(settings.provider.agentId);
      settings.provider.sessionId = created.id;
      await settingsFile.write({ settings, position });
      await configure(true);
      return await bootstrap();
    } finally {
      switching = false;
    }
  });
  ipcMain.handle('companion:settings', async (event, input: unknown) => {
    trusted(event, true);
    const next = parseSettings(input);
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
    switching = true;
    try {
      settings = next;
      await settingsFile.write({ settings, position });
      await loadModel();
      if (runtimeChanged) await configure(true);
      positionOverlay();
      overlay?.reload();
      return await bootstrap();
    } finally {
      switching = false;
    }
  });
  ipcMain.handle('companion:credential', async (event, provider: unknown, value: unknown) => {
    trusted(event, true);
    const key = z.enum(['hermes', 'grok_bot', 'jev']).parse(provider);
    await vault.set(
      credentialScope(key, settings.provider.endpoint),
      z.string().max(8000).parse(value),
    );
  });
  ipcMain.handle('companion:model', async (event) => {
    trusted(event, true);
    const selected = await dialog.showOpenDialog(chat!, {
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
    }
    return bootstrap();
  });
  ipcMain.handle('companion:send', async (event, text: unknown, expectedSelection: unknown) => {
    trusted(event, true);
    if (quitting || switching || storageFault || !coordinator || !adapter)
      throw new Error('연결 또는 저장소 준비 상태를 확인하세요.');
    if (settings.provider.sessionId === '__select_session__')
      throw new Error('기존 세션을 선택하거나 테스트용 새 세션을 생성하세요.');
    if (expectedSelection !== selectionId)
      throw new Error('대화 대상이 변경되었습니다. 다시 확인하세요.');
    const activeAdapter = adapter;
    const activeCoordinator = coordinator;
    const selected = selectionId;
    await activeAdapter.connect();
    if (switching || selectionId !== selected || coordinator !== activeCoordinator)
      throw new Error('대화 대상이 변경되어 전송하지 않았습니다.');
    await activeCoordinator.send(z.string().trim().min(1).max(32000).parse(text));
  });
  const activeRequest = (id: unknown) => {
    if (quitting || switching || !coordinator || id !== coordinator.current?.requestId)
      throw new Error('현재 요청과 일치하지 않습니다.');
    return coordinator;
  };
  ipcMain.handle('companion:cancel', async (event, id: unknown) => {
    trusted(event, true);
    await activeRequest(id).cancel();
  });
  ipcMain.handle('companion:reconcile', async (event, id: unknown) => {
    trusted(event, true);
    await activeRequest(id).reconcile();
  });
  ipcMain.handle(
    'companion:approve',
    async (event, id: unknown, decision: unknown, requestId: unknown) => {
      trusted(event, true);
      await activeRequest(requestId).approve(
        z.string().min(1).max(512).parse(id),
        z.enum(['allow_once', 'deny']).parse(decision),
      );
    },
  );
  ipcMain.handle('companion:chat', (event) => {
    trusted(event);
    openChat();
  });
  ipcMain.handle('companion:move', async (event, dx: unknown, dy: unknown) => {
    trusted(event);
    const delta = z.number().finite().min(-200).max(200);
    const x = delta.parse(dx);
    const y = delta.parse(dy);
    if (event.sender !== overlay?.webContents) throw new Error('Overlay 전용 요청입니다.');
    const [oldX = 0, oldY = 0] = overlay.getPosition();
    position = { x: Math.round(oldX + x), y: Math.round(oldY + y) };
    positionOverlay();
    await settingsFile.write({ settings, position });
  });
  ipcMain.on('companion:hit', (event, hit: unknown) => {
    try {
      trusted(event);
      if (event.sender !== overlay?.webContents || typeof hit !== 'boolean') return;
      overlay.setIgnoreMouseEvents(settings.clickThrough && !hit, { forward: true });
    } catch {
      /* invalid renderer input is ignored */
    }
  });
}
async function runSmoke(): Promise<void> {
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
  await chat?.webContents.executeJavaScript(
    "document.getElementById('message').value='연결 테스트입니다. 도구를 사용하지 말고, 정말 반갑고 기쁜 마음을 담은 한국어 인사 한 문장만 답해 주세요.';document.getElementById('composer').requestSubmit()",
  );
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
  };
  let uiRouting = true;
  if (!smokeHermes) {
    const previousSession = settings.provider.sessionId;
    await chat?.webContents.executeJavaScript("document.getElementById('create-session').click()");
    for (let i = 0; i < 100; i++) {
      if (settings.provider.sessionId !== previousSession) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    const newSessionCleared = await chat?.webContents.executeJavaScript(
      "document.querySelectorAll('#conversation .message').length===0 && document.getElementById('provider-badge').textContent==='MOCK DEMO'",
    );
    await chat?.webContents.executeJavaScript(
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
    if (!stored) {
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
    if (smoke && smokeJev) {
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
    overlay = new BrowserWindow({
      width: 440,
      height: 680,
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
    secureWindow(overlay);
    positionOverlay();
    overlay.once('ready-to-show', () => {
      if (!smoke) overlay?.showInactive();
    });
    registerIpc();
    await configure();
    await overlay.loadURL('app://ui/index.html?view=overlay');
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
          { label: '채팅 / 설정', click: openChat },
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
    screen.on('display-removed', positionOverlay);
    screen.on('display-metrics-changed', positionOverlay);
    if (smoke) await runSmoke();
  })
  .catch(async () => {
    console.error('앱 초기화 실패. 모델·SDK·보호 저장소 구성을 확인하세요.');
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
  void (async () => {
    await coordinator?.dispose();
    persistPending();
    await settingsFile?.flush();
    await pendingFile?.flush();
  })()
    .catch(() => {})
    .finally(() => app.quit());
});
