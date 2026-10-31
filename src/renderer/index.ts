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

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const bridge = window.companion;
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
const assistantMessages = new Map<string, HTMLElement>();
const input = (id: string) => element<HTMLInputElement>(id);
const notice = (text: string) => {
  element('notice').textContent = text;
};
const safe = (work: () => Promise<void>) => {
  void work().catch(() =>
    notice('처리하지 못했습니다. 연결 주소·인증·현재 요청 상태를 확인하세요.'),
  );
};
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

function addMessage(role: 'user' | 'assistant', text: string): HTMLElement {
  element('welcome').hidden = true;
  const item = document.createElement('article');
  item.className = `message ${role}`;
  const label = document.createElement('p');
  label.className = 'message-label';
  label.textContent = role === 'user' ? 'YOU' : 'DEEPSEEK-CHAN';
  const content = document.createElement('div');
  content.className = 'message-text';
  content.textContent = text;
  item.append(label, content);
  element('conversation').append(item);
  return content;
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
    element('expression-status').textContent =
      `표현: ${emotionLabels[event.cue.emotion]}${event.cue.attitude && event.cue.attitude !== 'neutral' ? ` · ${{ explain: '설명', tease: '장난', shy: '쑥스러움', reassure: '안심' }[event.cue.attitude]}` : ''} · ${event.cue.source === 'jev' ? 'Jev' : '기본'}`;
    return;
  }
  if (event.turn.requestId !== view?.requestId) lastCharacterState = 'thinking';
  view = event.turn;
  applyCharacterState();
  if (view.text || assistantMessages.has(view.requestId)) {
    let content = assistantMessages.get(view.requestId);
    if (!content) {
      content = addMessage('assistant', view.text);
      assistantMessages.set(view.requestId, content);
    } else content.textContent = view.text;
    element('conversation').scrollTop = element('conversation').scrollHeight;
  }
  updatePreviewAvailability();
  element('turn-status').textContent = labels[view.state] ?? view.state;
  const terminal = ['completed', 'failed', 'cancelled', 'interrupted'].includes(view.state);
  element<HTMLButtonElement>('send').disabled = !terminal;
  element('stop').hidden = terminal;
  element('reconcile').hidden = terminal || view.state !== 'reconciling';
  element('approval').hidden = !view.approval;
  if (view.approval) element('approval-summary').textContent = view.approval.summary;
  if (view.error) notice(view.error);
  else notice('');
}
function receive(event: CompanionEvent): void {
  if (!ready) {
    buffered.push(event);
    if (buffered.length > 256) buffered.shift();
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
  element('expression-status').textContent = s.jevEnabled
    ? boot.credentials.jev
      ? '표현: Jev 사용'
      : '표현: Jev 키 입력 필요'
    : '표현: 기본 규칙';
  if (boot.connectionError) notice(boot.connectionError);
  populateMaps();
  if (boot.currentTurn) renderEvent({ type: 'turn', turn: boot.currentTurn });
  else {
    view = undefined;
    element<HTMLButtonElement>('send').disabled = false;
    element('stop').hidden = true;
    element('reconcile').hidden = true;
    element('approval').hidden = true;
    element('turn-status').textContent = '전송 준비';
    updatePreviewAvailability();
  }
}
function adoptBootstrap(next: Bootstrap): void {
  const switched =
    JSON.stringify(next.settings.provider) !== JSON.stringify(boot.settings.provider);
  const sameSelection = next.selectionId === boot.selectionId;
  if (sameSelection && next.revision < currentRevision) next.currentTurn = view;
  if (switched) {
    for (const message of element('conversation').querySelectorAll('.message')) message.remove();
    assistantMessages.clear();
    view = undefined;
    lastCharacterState = 'idle';
    appliedCharacterState = undefined;
    element('welcome').hidden = false;
    element('session-list').hidden = true;
  }
  currentRevision = sameSelection ? Math.max(currentRevision, next.revision) : next.revision;
  boot = next;
  populate();
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
    element('model-error').onclick = () => void bridge.openChat();
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
    element('model-error').onclick = () => void bridge.openChat();
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
  if (new URLSearchParams(location.search).get('view') === 'overlay') {
    await overlayMode();
    finish();
    return;
  }
  element('chat').hidden = false;
  populate();
  finish();
  const toggle = () => {
    element('settings').hidden = !element('settings').hidden;
    if (!element('settings').hidden) safe(refreshDisplays);
  };
  element('settings-toggle').onclick = toggle;
  element('settings-close').onclick = toggle;
  element('move-display').onclick = () =>
    safe(async () => {
      const button = element<HTMLButtonElement>('move-display');
      button.disabled = true;
      try {
        await bridge.moveToDisplay(Number(element<HTMLSelectElement>('display-list').value));
        await refreshDisplays();
        notice('캐릭터를 선택한 모니터로 옮기고 위치를 저장했습니다.');
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
          notice('캐릭터 표현 설정을 저장했습니다.');
        })
        .catch(() => notice('캐릭터 표현 설정을 저장하지 못했습니다. 다시 선택해 주세요.'));
    });
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-preview]'))
    button.onclick = () =>
      safe(async () => {
        await presentationSaves;
        await bridge.previewCharacter(button.dataset.preview as CharacterPreview);
      });
  element('choose-model').onclick = () =>
    safe(async () => {
      adoptBootstrap(await bridge.chooseModel());
    });
  element('load-sessions').onclick = () =>
    safe(async () => {
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
      notice(
        sessions.length
          ? '세션을 선택한 뒤 설정 저장을 눌러 주세요.'
          : '사용 가능한 기존 세션이 없습니다.',
      );
      select.onchange = () => {
        input('session-id').value = select.value;
      };
    });
  element('create-session').onclick = () =>
    safe(async () => {
      adoptBootstrap(await bridge.saveSettings(collectSettings()));
      adoptBootstrap(await bridge.createSession());
      notice('테스트 전용 새 세션을 생성했습니다. 기존 Bot Chat과 별도입니다.');
    });
  element('save-settings').onclick = () =>
    safe(async () => {
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
        notice(boot.connectionError ?? '설정을 저장했습니다.');
      } finally {
        button.disabled = false;
      }
    });
  element('composer').addEventListener('submit', (event) => {
    event.preventDefault();
    const text = element<HTMLTextAreaElement>('message').value.trim();
    if (!text || element<HTMLButtonElement>('send').disabled) return;
    addMessage('user', text);
    element<HTMLTextAreaElement>('message').value = '';
    element<HTMLButtonElement>('send').disabled = true;
    safe(async () => {
      try {
        await bridge.send(text, boot.selectionId);
      } catch {
        element<HTMLButtonElement>('send').disabled = false;
        notice('전송하지 못했습니다. 공급자 주소·인증 정보와 연결 상태를 확인하세요.');
      }
    });
  });
  element<HTMLTextAreaElement>('message').addEventListener('keydown', (event) => {
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
