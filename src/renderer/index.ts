import {
  EMOTIONS,
  GESTURES,
  DEFAULT_PRESENTATION,
  OVERLAY_SCALE_LIMITS,
  type AppSettings,
  type Bootstrap,
  type CompanionEvent,
  type CharacterPreview,
  type PresentationSettings,
  type TurnView,
} from '../shared/contracts.js';
import type { Avatar } from './avatar.js';
import { modelAssetLabel } from './model-labels.js';
import { localMapping } from '../shared/model-mappings.js';
import { renderMessageText } from './chat-markdown.js';
import { isConversationAtBottom, scrollConversationToBottom } from './chat-scroll.js';
import { AssistantMessageBubbles } from './assistant-messages.js';
import { parseChatCommand, SlashCommandMenu, type ChatCommandId } from './slash-commands.js';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const bridge = window.companion;
const mode = new URLSearchParams(location.search).get('view');
const isOverlay = mode === 'overlay';
const isSettings = mode === 'settings';
let configurationRefresh = 0;
let boot: Bootstrap;
let avatar: Avatar | undefined;
let view: TurnView | undefined;
let lastCharacterState: Extract<CompanionEvent, { type: 'character' }>['state'] = 'idle';
let appliedCharacterState: string | undefined;
let ready = false;
let currentRevision = 0;
const buffered: CompanionEvent[] = [];
let cancelOverlayGesture: (() => void) | undefined;
let presentationSaves: Promise<void> = Promise.resolve();
let slashMenu: SlashCommandMenu | undefined;
let commandPending = false;
let submission: { selectionId: string } | undefined;
const assistantMessages = new AssistantMessageBubbles();
const input = (id: string) => element<HTMLInputElement>(id);
const notice = (text: string) => {
  element('notice').textContent = text;
};
const settingsNotice = (text: string) => {
  element('settings-notice').textContent = text;
};
const safe = (work: () => Promise<void>, report = notice) => {
  void work().catch(() =>
    report('처리하지 못했습니다. 연결 주소·인증·현재 요청 상태를 확인하세요.'),
  );
};
const settingsWork = (work: () => Promise<void>) => safe(work, settingsNotice);
const labels: Record<string, string> = {
  submitting: '요청 전송 중',
  accepted: '응답 대기',
  streaming: '응답 수신 중',
  awaiting_result: '실행 시작됨 · 결과 미도착',
  cancel_requested: '원격 중단 확인 대기',
  reconciling: '원격 상태 확인 필요',
  completed: '응답 완료',
  failed: '요청 실패',
  cancelled: '중단됨',
  interrupted: '원격 실행 중단',
};
const emotionLabels: Record<string, string> = {
  neutral: '기본',
  happy: '기쁨',
  sad: '슬픔',
  surprised: '놀람',
  embarrassed: '부끄러움',
  concerned: '걱정',
};
const gestureLabels: Record<string, string> = {
  none: '없음',
  wave: '인사',
  explain: '설명',
  thinking: '생각',
};
function requestActive(): boolean {
  return !!view && !['completed', 'failed', 'cancelled', 'interrupted'].includes(view.state);
}
function updateComposer(): void {
  const local = parseChatCommand(element<HTMLTextAreaElement>('message').value).type !== 'text';
  element<HTMLButtonElement>('send').disabled =
    commandPending || (!local && (requestActive() || submission?.selectionId === boot.selectionId));
  slashMenu?.setBusy(commandPending);
}
async function executeCommand(command: ChatCommandId): Promise<void> {
  if (commandPending) return;
  const message = element<HTMLTextAreaElement>('message');
  const original = message.value;
  commandPending = true;
  slashMenu?.close();
  updateComposer();
  notice('');
  try {
    switch (command) {
      case 'new':
        adoptBootstrap(await bridge.createSession());
        break;
      case 'settings':
        await bridge.openSettings();
        break;
      case 'stop':
        if (requestActive()) await bridge.cancel(view!.requestId);
        else notice('진행 중인 요청이 없습니다.');
        break;
      case 'status':
        if (requestActive()) await bridge.reconcile(view!.requestId);
        else notice(view ? labels[view.state]! : '진행 중인 요청이 없습니다.');
        break;
      case 'help':
        message.value = '';
        slashMenu?.update();
        message.value = '/';
        break;
    }
    if (command !== 'help' && message.value === original) message.value = '';
  } catch {
    notice('명령을 실행하지 못했습니다. 연결과 현재 요청 상태를 확인하세요.');
  } finally {
    commandPending = false;
    slashMenu?.update();
    updateComposer();
    if (command !== 'settings') message.focus();
  }
}

function addMessage(role: 'user' | 'assistant', text: string): HTMLElement {
  const item = document.createElement('article');
  item.className = `message ${role}`;
  const label = document.createElement('p');
  label.className = 'message-label';
  label.textContent = role === 'user' ? 'YOU' : 'DEEPSEEK-CHAN';
  const content = document.createElement('div');
  content.className = 'message-text';
  renderMessageText(content, role, text);
  item.append(label, content);
  element('conversation').append(item);
  return content;
}
function restoreHistory(): void {
  if (isSettings || isOverlay || !boot.history) return;
  for (const message of element('conversation').querySelectorAll('.message')) message.remove();
  assistantMessages.clear();
  for (const message of boot.history) {
    const content = addMessage(message.role, message.text);
    if (message.role === 'assistant' && message.requestId)
      assistantMessages.remember(message.requestId, message.messageId, content);
  }
  scrollConversationToBottom(element('conversation'));
  // Only apply each snapshot once. Later settings responses may omit history.
  boot.history = undefined;
}
function applyPresentation(settings: PresentationSettings): void {
  boot.settings.presentation = { ...settings };
  avatar?.configure(settings);
  element('avatar').classList.toggle('position-locked', settings.positionLocked);
  if (settings.positionLocked) cancelOverlayGesture?.();
  element<HTMLSelectElement>('intensity').value = settings.intensity;
  element<HTMLSelectElement>('framing').value = settings.framing;
  input('position-locked').checked = settings.positionLocked;
  input('reduced-motion').checked = settings.reducedMotion;
}
function collectPresentation(): PresentationSettings {
  return {
    intensity: element<HTMLSelectElement>('intensity').value as PresentationSettings['intensity'],
    framing: element<HTMLSelectElement>('framing').value as PresentationSettings['framing'],
    positionLocked: input('position-locked').checked,
    reducedMotion: input('reduced-motion').checked,
  };
}
function updatePreviewAvailability(): void {
  const busy =
    !!view &&
    (!!view.approval || !['completed', 'failed', 'cancelled', 'interrupted'].includes(view.state));
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-preview]'))
    button.disabled = busy;
  element('preview-status').textContent = busy
    ? '요청·승인이 끝나면 미리 볼 수 있습니다.'
    : '로컬 캐릭터만 움직입니다. 메시지를 보내거나 Jev를 호출하지 않습니다.';
}
function applyCharacterState(): void {
  const blocked =
    view?.approval ||
    (view && ['cancel_requested', 'reconciling', 'cancelled', 'interrupted'].includes(view.state));
  const state = blocked
    ? 'blocked'
    : view?.state === 'failed'
      ? 'error'
      : view?.state === 'completed'
        ? 'idle'
        : lastCharacterState;
  if (state === appliedCharacterState) return;
  // Clear transient reactions once at the boundary, without restarting the error timer
  // or erasing a completed turn's still-fading cue on subsequent state publications.
  if (state === 'blocked' || state === 'error') avatar?.reset();
  avatar?.setState(state);
  appliedCharacterState = state;
}
function renderEvent(event: CompanionEvent): void {
  if (event.type === 'configuration') return;
  if (event.type === 'history') {
    if (isSettings || isOverlay) return;
    boot.history = event.messages;
    boot.historyRestoredRequestId = event.restoredRequestId;
    boot.historyError = event.error;
    restoreHistory();
    notice(event.error ?? '');
    return;
  }
  if (event.type === 'presentation') {
    applyPresentation(event.settings);
    return;
  }
  if (event.type === 'character.preview') {
    // Only main's guarded local-preview IPC emits this event. Terminal cancelled
    // turns can explicitly preview again without changing their request state.
    appliedCharacterState = 'idle';
    avatar?.setState('idle');
    avatar?.preview(event.preset);
    return;
  }
  if (event.type === 'overlay-input') {
    boot.overlayInput = event.mode;
    boot.overlayInputError = event.error;
    populateOverlayInput();
    if (avatar)
      avatar.onInputRegion =
        event.mode === 'native-shape' && boot.settings.clickThrough
          ? bridge.setInputRegion
          : undefined;
    return;
  }
  if (event.type === 'overlay-scale') {
    boot.settings.scale = event.scale;
    input('scale').value = String(event.scale);
    return;
  }
  if (event.type === 'character') {
    lastCharacterState = event.state;
    applyCharacterState();
    return;
  }
  if (event.type === 'cue') {
    if (
      event.cue.requestId !== view?.requestId ||
      view.approval ||
      ['failed', 'cancelled', 'cancel_requested', 'interrupted', 'reconciling'].includes(view.state)
    )
      return;
    avatar?.cue(event.cue);
    return;
  }
  if (isSettings) {
    view = event.turn;
    updatePreviewAvailability();
    return;
  }
  const followReply = isConversationAtBottom(element('conversation'));
  const readingPosition = element('conversation').scrollTop;
  if (event.turn.requestId !== view?.requestId) {
    // Background task transitions preserve message reactions. A new request is
    // the explicit boundary that stops the preceding request's transient pose.
    avatar?.reset();
    appliedCharacterState = 'idle';
    lastCharacterState = 'thinking';
  }
  view = event.turn;
  applyCharacterState();
  if (view.requestId !== boot.historyRestoredRequestId)
    assistantMessages.update(view, (text) => addMessage('assistant', text));
  updatePreviewAvailability();
  element('turn-status').textContent = labels[view.state] ?? view.state;
  const terminal = ['completed', 'failed', 'cancelled', 'interrupted'].includes(view.state);
  element<HTMLButtonElement>('send').disabled = !terminal;
  updateComposer();
  element('stop').hidden = terminal;
  element('reconcile').hidden = terminal || view.state !== 'reconciling';
  element('approval').hidden = !view.approval;
  if (view.approval) element('approval-summary').textContent = view.approval.summary;
  if (view.error) notice(view.error);
  else notice(boot.historyError ?? '');
  if (followReply) scrollConversationToBottom(element('conversation'));
  else element('conversation').scrollTop = readingPosition;
}
function receive(event: CompanionEvent): void {
  if (!ready) {
    buffered.push(event);
    if (buffered.length > 256) buffered.shift();
    return;
  }
  if (event.type === 'configuration') {
    // A chat command can also change selection while settings has unsaved edits.
    const refresh = ++configurationRefresh;
    safe(async () => {
      const next = await bridge.bootstrap();
      if (refresh !== configurationRefresh) return;
      if (isSettings) {
        // /new can change the selected session while this window has unsaved
        // edits. Update metadata and only replace untouched provider fields.
        const previous = boot.settings.provider;
        const sameSelection = next.selectionId === boot.selectionId;
        if (sameSelection && next.revision < currentRevision) next.currentTurn = view;
        for (const [id, key] of [
          ['provider', 'provider'],
          ['endpoint', 'endpoint'],
          ['agent-id', 'agentId'],
          ['session-id', 'sessionId'],
        ] as const) {
          const control = element<HTMLInputElement | HTMLSelectElement>(id);
          if (control.value === previous[key]) control.value = next.settings.provider[key];
        }
        if (previous.sessionId !== next.settings.provider.sessionId)
          element('session-list').hidden = true;
        if (boot.connectionError !== next.connectionError)
          settingsNotice(next.connectionError ?? '');
        currentRevision = sameSelection ? Math.max(currentRevision, next.revision) : next.revision;
        boot = next;
        view = next.currentTurn;
        updatePreviewAvailability();
      } else adoptBootstrap(next, true);
    });
    return;
  }
  if (event.selectionId !== boot.selectionId || (event.revision ?? 0) <= currentRevision) return;
  currentRevision = event.revision!;
  renderEvent(event);
}
function populateMaps(): void {
  for (const [id, keys, names, options, mapping] of [
    [
      'expression-maps',
      EMOTIONS,
      emotionLabels,
      boot.model?.expressions ?? [],
      boot.model?.expressionMap ?? {},
    ],
    [
      'gesture-maps',
      GESTURES,
      gestureLabels,
      boot.model?.motions ?? [],
      boot.model?.gestureMap ?? {},
    ],
  ] as const) {
    const container = element(id);
    container.replaceChildren();
    for (const key of keys) {
      const label = document.createElement('label');
      label.textContent = names[key] ?? key;
      const select = document.createElement('select');
      select.dataset.map = key;
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent =
        key === 'neutral'
          ? '중립 (기본 표정)'
          : key === 'none'
            ? '없음 (제스처 생략)'
            : '기본 연기만 (추가 자산 없음)';
      select.append(empty);
      const kind = id === 'expression-maps' ? 'expression' : 'motion';
      const local = localMapping(kind, key);
      for (const option of [...(local ? [local] : []), ...options]) {
        const entry = document.createElement('option');
        entry.value = option;
        entry.textContent = modelAssetLabel(option, kind);
        if (option !== local) entry.title = option;
        select.append(entry);
      }
      select.value = (mapping as Record<string, string>)[key] ?? '';
      label.append(select);
      container.append(label);
    }
  }
}
function populateOverlayInput(): void {
  input('click-through').disabled = boot.overlayInput === 'unsupported';
  let clickThroughStatus = document.getElementById('click-through-status');
  if (!clickThroughStatus) {
    clickThroughStatus = document.createElement('span');
    clickThroughStatus.id = 'click-through-status';
    input('click-through').after(clickThroughStatus);
  }
  clickThroughStatus.textContent =
    boot.overlayInput === 'unsupported'
      ? ` · ${boot.overlayInputError ?? '현재 창 시스템에서는 미지원 (설정값은 유지).'}`
      : '';
}
async function refreshDisplays(): Promise<void> {
  const displays = await bridge.displays();
  const select = element<HTMLSelectElement>('display-list');
  select.replaceChildren();
  for (const display of displays) {
    const option = document.createElement('option');
    option.value = String(display.id);
    option.textContent = `${display.label} · ${display.width}×${display.height}${display.current ? ' · 현재' : ''}`;
    option.selected = display.current;
    select.append(option);
  }
}
function populate(): void {
  restoreHistory();
  const s = boot.settings;
  element<HTMLSelectElement>('provider').value = s.provider.provider;
  input('endpoint').value = s.provider.endpoint;
  input('agent-id').value = s.provider.agentId;
  input('session-id').value = s.provider.sessionId;
  input('jev-enabled').checked = s.jevEnabled;
  input('jev-model').value = s.jevModel;
  input('scale').min = String(OVERLAY_SCALE_LIMITS.min);
  input('scale').max = String(OVERLAY_SCALE_LIMITS.max);
  input('scale').value = String(s.scale);
  input('always-on-top').checked = s.alwaysOnTop;
  input('click-through').checked = s.clickThrough;
  applyPresentation(s.presentation ?? { ...DEFAULT_PRESENTATION });
  populateOverlayInput();
  const ssh = s.provider.endpoint.startsWith('ssh:');
  element('provider-badge').textContent =
    s.provider.provider === 'mock'
      ? 'MOCK DEMO'
      : s.provider.provider === 'hermes'
        ? `HERMES · ${ssh ? 'SSH' : 'API'}`
        : 'GROK · EXPERIMENTAL';
  element('continuity').textContent =
    s.provider.provider === 'mock'
      ? '실제 Bot 연결 아님'
      : s.provider.provider === 'hermes'
        ? `${ssh ? '선택한 원격 세션' : 'API 전용 세션'} · Bot Chat 미검증`
        : 'Webhook 실행 시작 · 응답 미지원';
  input('provider-key').placeholder = boot.credentials[s.provider.provider as 'hermes' | 'grok_bot']
    ? '저장됨 · 변경할 때만 입력'
    : '인증키 입력';
  input('jev-key').placeholder = boot.credentials.jev
    ? '저장됨 · 변경할 때만 입력'
    : 'Jev 인증키 입력';
  element('vault-status').textContent = boot.storageSecure
    ? '인증키는 OS 보호 저장소로 암호화됩니다.'
    : 'OS 보호 저장소를 사용할 수 없어 앱은 키를 메모리에만 유지합니다. 재실행 시 .env에서 다시 읽거나 직접 입력하세요.';
  element('model-name').textContent = boot.model
    ? `${boot.model.name} · 표정 ${boot.model.expressions.length} / 모션 ${boot.model.motions.length}`
    : '모델이 선택되지 않았습니다.';
  const report = isSettings ? settingsNotice : notice;
  report(boot.connectionError ?? boot.historyError ?? '');
  populateMaps();
  if (boot.currentTurn) renderEvent({ type: 'turn', turn: boot.currentTurn });
  else {
    view = undefined;
    element<HTMLButtonElement>('send').disabled = false;
    element('stop').hidden = true;
    element('reconcile').hidden = true;
    element('approval').hidden = true;
    element('turn-status').textContent = '전송 준비';
    updateComposer();
    updatePreviewAvailability();
  }
}
function adoptBootstrap(next: Bootstrap, configuration = false): void {
  const sameSelection = next.selectionId === boot.selectionId;
  const switched = !sameSelection;
  if (configuration && sameSelection) {
    // A settings update must not rebuild the transcript or interrupt reading.
    next.history = undefined;
    next.currentTurn = view;
  }
  if (sameSelection && next.revision < currentRevision) {
    next.currentTurn = view;
    next.history = undefined;
  }
  if (switched) {
    for (const message of element('conversation').querySelectorAll('.message')) message.remove();
    assistantMessages.clear();
    view = undefined;
    lastCharacterState = 'idle';
    appliedCharacterState = undefined;
    element('session-list').hidden = true;
  }
  currentRevision = sameSelection ? Math.max(currentRevision, next.revision) : next.revision;
  boot = next;
  const readingPosition = element('conversation').scrollTop;
  populate();
  if (configuration && sameSelection) element('conversation').scrollTop = readingPosition;
}
function collectSettings(): AppSettings {
  const maps = (id: string) =>
    Object.fromEntries(
      [...element(id).querySelectorAll('select')].map((select) => [
        select.dataset.map!,
        select.value,
      ]),
    );
  return {
    ...boot.settings,
    provider: {
      provider: element<HTMLSelectElement>('provider').value as AppSettings['provider']['provider'],
      endpoint: input('endpoint').value.trim(),
      agentId: input('agent-id').value.trim(),
      sessionId: input('session-id').value.trim(),
    },
    jevEnabled: input('jev-enabled').checked,
    jevModel: input('jev-model').value.trim(),
    scale: Number(input('scale').value),
    alwaysOnTop: input('always-on-top').checked,
    clickThrough: input('click-through').checked,
    presentation: collectPresentation(),
    expressionMap: maps('expression-maps'),
    gestureMap: maps('gesture-maps'),
  };
}
async function overlayMode(): Promise<void> {
  element('overlay').hidden = false;
  const hitAt = (x: number, y: number): boolean => {
    if (avatar) return avatar.hit(x, y);
    const fallback = element('model-error');
    const rect = fallback.getBoundingClientRect();
    return !fallback.hidden && x >= rect.left && y >= rect.top && x < rect.right && y < rect.bottom;
  };
  if (!boot.model) {
    element('model-error').hidden = false;
    element('model-error').onclick = () => void bridge.openSettings();
    return;
  }
  try {
    const { Avatar } = await import('./avatar.js');
    avatar = new Avatar(element<HTMLCanvasElement>('avatar'), boot.model);
    applyPresentation(boot.settings.presentation ?? { ...DEFAULT_PRESENTATION });
    if (boot.overlayInput === 'native-shape' && boot.settings.clickThrough)
      avatar.onInputRegion = bridge.setInputRegion;
    await avatar.load();
  } catch {
    avatar?.dispose();
    avatar = undefined;
    bridge.setInputRegion(null);
    element('model-error').hidden = false;
    element('model-error').textContent = '모델 로드 실패 · 설정 열기';
    element('model-error').onclick = () => void bridge.openSettings();
    window.__avatarStatus = { loaded: false, frames: 0, error: '모델 로드 실패' };
  }
  let pointerId: number | undefined;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  let hitTime = 0;
  const canvas = element<HTMLCanvasElement>('avatar');
  const finishDrag = (clicked = false, x?: number, y?: number): void => {
    const captured = pointerId;
    if (captured === undefined) return;
    pointerId = undefined;
    bridge.setDragging(false);
    if (canvas.hasPointerCapture(captured)) canvas.releasePointerCapture(captured);
    bridge.hitTest(x !== undefined && y !== undefined && hitAt(x, y));
    if (clicked && !moved) void bridge.openChat();
  };
  cancelOverlayGesture = () => finishDrag();
  canvas.addEventListener('pointerdown', (event) => {
    if (pointerId !== undefined || event.button !== 0 || !hitAt(event.clientX, event.clientY))
      return;
    canvas.setPointerCapture(event.pointerId);
    pointerId = event.pointerId;
    moved = false;
    startX = lastX = event.screenX;
    startY = lastY = event.screenY;
    if (!boot.settings.presentation?.positionLocked) bridge.setDragging(true);
    event.preventDefault();
  });
  window.addEventListener('pointermove', (event) => {
    if (pointerId !== undefined) {
      if (event.pointerId !== pointerId) return;
      if (!(event.buttons & 1)) {
        finishDrag();
        return;
      }
      const dx = event.screenX - lastX;
      const dy = event.screenY - lastY;
      lastX = event.screenX;
      lastY = event.screenY;
      if (Math.abs(event.screenX - startX) + Math.abs(event.screenY - startY) > 3) moved = true;
      if (!boot.settings.presentation?.positionLocked && Math.abs(dx) <= 200 && Math.abs(dy) <= 200)
        void bridge.move(dx, dy).catch(() => {});
    } else if (performance.now() - hitTime > 30) {
      hitTime = performance.now();
      bridge.hitTest(hitAt(event.clientX, event.clientY));
    }
  });
  canvas.addEventListener(
    'wheel',
    (event) => {
      if (pointerId === undefined || !(event.buttons & 1)) return;
      event.preventDefault();
      moved = true; // Resizing is a manipulation, so release must not open chat.
      if (boot.settings.presentation?.positionLocked) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
      const deltaY = Math.max(-240, Math.min(240, event.deltaY * unit));
      void bridge.resizeOverlay(deltaY, event.screenX, event.screenY).catch(() => {});
    },
    { passive: false },
  );
  canvas.addEventListener('pointerup', (event) => {
    if (event.pointerId === pointerId) {
      if (Math.abs(event.screenX - startX) + Math.abs(event.screenY - startY) > 3) moved = true;
      finishDrag(true, event.clientX, event.clientY);
    }
  });
  canvas.addEventListener('pointercancel', () => finishDrag());
  canvas.addEventListener('lostpointercapture', () => finishDrag());
  window.addEventListener('blur', () => finishDrag());
  window.addEventListener('unload', () => {
    finishDrag();
    cancelOverlayGesture = undefined;
    avatar?.dispose();
  });
}
async function main(): Promise<void> {
  if (!bridge) throw new Error('보안 브리지를 불러올 수 없습니다.');
  if (!isOverlay && !isSettings) {
    element('chat').hidden = false;
    element<HTMLButtonElement>('send').disabled = true;
    notice('이전 대화를 불러오는 중입니다.');
  }
  bridge.onEvent(receive);
  boot = await bridge.bootstrap();
  currentRevision = boot.revision;
  const finish = () => {
    if (boot.currentTurn) {
      renderEvent({ type: 'turn', turn: boot.currentTurn });
    }
    ready = true;
    for (const event of buffered.splice(0)) receive(event);
  };
  if (isOverlay) {
    await overlayMode();
    finish();
    return;
  }
  element('chat').hidden = isSettings;
  element('settings').hidden = !isSettings;
  if (isSettings) document.title = 'DeepSeek Companion · 설정';
  populate();
  if (!boot.currentTurn && !isSettings) notice(boot.historyError ?? boot.connectionError ?? '');
  finish();
  if (!isSettings) {
    slashMenu = new SlashCommandMenu(
      element<HTMLTextAreaElement>('message'),
      element('slash-menu'),
      (command) => void executeCommand(command),
    );
    element('message').addEventListener('input', updateComposer);
  }
  element('settings-toggle').onclick = () => safe(() => bridge.openSettings());
  element('settings-close').onclick = () => window.close();
  if (isSettings) settingsWork(refreshDisplays);
  element('move-display').onclick = () =>
    settingsWork(async () => {
      const button = element<HTMLButtonElement>('move-display');
      button.disabled = true;
      try {
        await bridge.moveToDisplay(Number(element<HTMLSelectElement>('display-list').value));
        await refreshDisplays();
        settingsNotice('캐릭터를 선택한 모니터로 옮기고 위치를 저장했습니다.');
      } finally {
        button.disabled = false;
      }
    });
  for (const id of ['intensity', 'framing', 'position-locked', 'reduced-motion'])
    element(id).addEventListener('change', () => {
      const presentation = collectPresentation();
      presentationSaves = presentationSaves
        .then(async () => {
          const next = await bridge.saveSettings({ ...boot.settings, presentation });
          boot.settings = next.settings;
          settingsNotice('캐릭터 표현 설정을 저장했습니다.');
        })
        .catch(() => settingsNotice('캐릭터 표현 설정을 저장하지 못했습니다. 다시 선택해 주세요.'));
    });
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-preview]'))
    button.onclick = () =>
      settingsWork(async () => {
        await presentationSaves;
        await bridge.previewCharacter(button.dataset.preview as CharacterPreview);
      });
  element('choose-model').onclick = () =>
    settingsWork(async () => {
      adoptBootstrap(await bridge.chooseModel());
    });
  element('load-sessions').onclick = () =>
    settingsWork(async () => {
      adoptBootstrap(await bridge.saveSettings(collectSettings()));
      const sessions = await bridge.sessions();
      const select = element<HTMLSelectElement>('session-list');
      select.replaceChildren();
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = '연결할 기존 세션을 선택하세요';
      select.append(placeholder);
      for (const session of sessions) {
        const option = document.createElement('option');
        option.value = session.id;
        option.textContent = `${session.label || '제목 없음'} · ${session.id}`;
        select.append(option);
      }
      select.hidden = false;
      settingsNotice(
        sessions.length
          ? '세션을 선택한 뒤 설정 저장을 눌러 주세요.'
          : '사용 가능한 기존 세션이 없습니다.',
      );
      select.onchange = () => {
        input('session-id').value = select.value;
      };
    });
  element('create-session').onclick = () =>
    settingsWork(async () => {
      adoptBootstrap(await bridge.saveSettings(collectSettings()));
      adoptBootstrap(await bridge.createSession());
      settingsNotice('선택한 프로필에 새 대화를 만들었습니다. 기존 Bot Chat과 별도입니다.');
    });
  element('save-settings').onclick = () =>
    settingsWork(async () => {
      const button = element<HTMLButtonElement>('save-settings');
      button.disabled = true;
      try {
        const next = collectSettings();
        adoptBootstrap(await bridge.saveSettings(next));
        if (input('provider-key').value && boot.settings.provider.provider !== 'mock')
          await bridge.storeCredential(
            boot.settings.provider.provider,
            input('provider-key').value,
          );
        if (input('jev-key').value) await bridge.storeCredential('jev', input('jev-key').value);
        input('provider-key').value = '';
        input('jev-key').value = '';
        adoptBootstrap(await bridge.testConnection());
        settingsNotice(boot.connectionError ?? '설정을 저장했습니다.');
      } finally {
        button.disabled = false;
      }
    });
  element('composer').addEventListener('submit', (event) => {
    event.preventDefault();
    const text = element<HTMLTextAreaElement>('message').value.trim();
    if (!text) return;
    slashMenu?.update();
    const parsed = parseChatCommand(text);
    if (parsed.type === 'command') {
      void executeCommand(parsed.command);
      return;
    }
    if (slashMenu?.selectedCommand) {
      void executeCommand(slashMenu.selectedCommand);
      return;
    }
    if (parsed.type !== 'text') {
      notice(
        parsed.type === 'unknown'
          ? '지원하지 않는 명령입니다. /로 목록을 열어 주세요.'
          : '명령은 추가 인자 없이 입력해 주세요.',
      );
      return;
    }
    if (!text || element<HTMLButtonElement>('send').disabled) return;
    addMessage('user', text);
    scrollConversationToBottom(element('conversation'));
    element<HTMLTextAreaElement>('message').value = '';
    element<HTMLButtonElement>('send').disabled = true;
    slashMenu?.update();
    const ownSubmission = { selectionId: boot.selectionId };
    submission = ownSubmission;
    safe(async () => {
      try {
        await bridge.send(text, ownSubmission.selectionId);
      } catch {
        if (boot.selectionId === ownSubmission.selectionId)
          notice('전송하지 못했습니다. 공급자 주소·인증 정보와 연결 상태를 확인하세요.');
      } finally {
        if (submission === ownSubmission) submission = undefined;
        updateComposer();
      }
    });
  });
  element<HTMLTextAreaElement>('message').addEventListener('keydown', (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.repeat && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      return;
    }
    if (slashMenu?.handleKeydown(event)) return;
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      element<HTMLFormElement>('composer').requestSubmit();
    }
  });
  element('stop').onclick = () =>
    safe(async () => {
      if (view) await bridge.cancel(view.requestId);
    });
  element('reconcile').onclick = () =>
    safe(async () => {
      if (view) await bridge.reconcile(view.requestId);
    });
  element('deny').onclick = () =>
    safe(async () => {
      if (view?.approval) await bridge.approve(view.approval.approvalId, 'deny', view.requestId);
    });
  element('allow').onclick = () =>
    safe(async () => {
      if (view?.approval)
        await bridge.approve(view.approval.approvalId, 'allow_once', view.requestId);
    });
  window.__uiReady = true;
}
void main().catch(() => {
  document.body.textContent =
    '앱을 초기화하지 못했습니다. SDK·모델·설정을 확인하고 다시 실행하세요.';
});
