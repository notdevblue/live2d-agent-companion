export type ProviderId = 'mock' | 'hermes' | 'grok_bot';
export type Support = 'supported' | 'experimental' | 'unsupported';
export type Capability =
  | 'text'
  | 'streaming'
  | 'attachments.image'
  | 'attachments.file'
  | 'session.list'
  | 'session.resume'
  | 'session.history'
  | 'request.reconcile'
  | 'cancel'
  | 'tool.events'
  | 'tool.approvals'
  | 'pc.tools';
export type Capabilities = Record<Capability, Support>;
export interface AgentBinding {
  provider: ProviderId;
  connectionId: string;
  agentId: string;
  sessionId: string;
  continuity: 'verified' | 'unverified' | 'new-session';
}
export interface RequestRef {
  turnId: string;
  requestId: string;
  binding: AgentBinding;
}
export interface AttachmentInput {
  name: string;
  mime: string;
  data: Uint8Array;
}
export const ATTACHMENT_LIMITS = {
  maxFiles: 10,
  maxFileBytes: 10 * 1024 * 1024,
  maxTotalBytes: 25 * 1024 * 1024,
} as const;
export interface UserTurn extends RequestRef {
  text: string;
  attachments?: AttachmentInput[];
}
export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  requestId?: string;
  messageId?: string;
}
export interface AssistantMessage {
  messageId: string;
  text: string;
  completed: boolean;
}
export interface ApprovalResponse extends RequestRef {
  approvalId: string;
  decision: 'allow_once' | 'deny';
}
export type TurnState =
  | 'submitting'
  | 'accepted'
  | 'streaming'
  | 'awaiting_result'
  | 'cancel_requested'
  | 'reconciling'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';
export interface EventPayloads {
  'turn.accepted': { remoteRunId?: string };
  'turn.awaiting_result': Record<string, never>;
  'turn.reconciling': { reason: string };
  'turn.resumed': { state: 'accepted' | 'streaming' | 'awaiting_result' | 'cancel_requested' };
  'message.delta': { text: string; messageId: string };
  'message.snapshot': { text: string; messageId: string };
  'message.complete': { text: string; messageId: string };
  'tool.started': { toolId: string; name: string };
  'tool.completed': { toolId: string };
  'approval.requested': { approvalId: string; summary: string; expiresAt: number };
  'approval.resolved': { approvalId: string; decision: 'allow_once' | 'deny' };
  'approval.closed': { approvalId: string; reason: string };
  'turn.completed': Record<string, never>;
  'turn.failed': { code: string; safeMessage: string };
  'turn.cancelled': { remoteConfirmed: true };
  'turn.interrupted': { reason: string };
}
export type AgentEvent = {
  [K in keyof EventPayloads]: RequestRef & {
    schemaVersion: 1;
    eventId: string;
    type: K;
    payload: EventPayloads[K];
  };
}[keyof EventPayloads];
export type EventSink = (event: AgentEvent) => void;
export interface AgentAdapter {
  readonly provider: ProviderId;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  discover(): Promise<Capabilities>;
  listSessions?(agentId: string): Promise<Array<{ id: string; label: string }>>;
  createSession?(agentId: string): Promise<{ id: string; label: string }>;
  history?(binding: AgentBinding): Promise<ConversationMessage[]>;
  send(turn: UserTurn, sink: EventSink): Promise<void>;
  cancel?(requestId: string): Promise<'confirmed' | 'requested' | 'unsupported'>;
  respondApproval?(response: ApprovalResponse): Promise<'applied' | 'closed' | 'unknown'>;
  reconcile?(request: RequestRef, sink: EventSink): Promise<'resumed' | 'settled' | 'unknown'>;
}
export const EMOTIONS = [
  'neutral',
  'happy',
  'sad',
  'surprised',
  'embarrassed',
  'concerned',
] as const;
export const GESTURES = ['none', 'wave', 'explain', 'thinking'] as const;
export const ATTITUDES = ['neutral', 'explain', 'tease', 'laugh', 'shy', 'reassure'] as const;
export type Emotion = (typeof EMOTIONS)[number];
export type Gesture = (typeof GESTURES)[number];
export type Attitude = (typeof ATTITUDES)[number];
export interface ExpressionDecision {
  attitude?: Attitude;
  emotion: Emotion;
  gesture: Gesture;
  confidence: number;
}
export interface ExpressionJudge {
  judge(
    text: string,
    signal: AbortSignal,
    context?: ExpressionContext,
  ): Promise<ExpressionDecision>;
}
export interface ExpressionContext {
  userRequest: string;
}
export interface CharacterCue extends ExpressionDecision {
  requestId: string;
  segmentId: number;
  messageId?: string;
  source: 'jev' | 'fallback';
}
export const EXPRESSION_PACING = {
  maxJudgements: 8,
  maxText: 800,
  maxRequestText: 1600,
  collectMs: 350,
  maxAgeMs: 2000,
} as const;
export interface TurnView extends RequestRef {
  state: TurnState;
  text: string;
  messages?: AssistantMessage[];
  error?: string;
  approval?: { approvalId: string; summary: string; expiresAt: number };
  expressionStatus?: string;
}
export interface PresentationSettings {
  intensity: 'quiet' | 'normal' | 'expressive';
  framing: 'full' | 'bust' | 'close';
  positionLocked: boolean;
  reducedMotion: boolean;
}
export const DEFAULT_PRESENTATION: Readonly<PresentationSettings> = {
  intensity: 'normal',
  framing: 'full',
  positionLocked: false,
  reducedMotion: false,
};
export const CHARACTER_PREVIEWS = [
  'thinking',
  'explain',
  'shy',
  'tease',
  'happy',
  'surprised',
  'wink',
  'nod',
  'shake',
  'pout',
  'laugh',
  'heart',
  'grass',
  'reset',
] as const;
export type CharacterPreview = (typeof CHARACTER_PREVIEWS)[number];
export type CompanionEvent = (
  | { type: 'configuration' }
  | { type: 'turn'; turn: TurnView }
  | { type: 'history'; messages: ConversationMessage[]; restoredRequestId?: string; error?: string }
  | { type: 'character'; state: 'idle' | 'thinking' | 'working' | 'error' }
  | { type: 'cue'; cue: CharacterCue }
  | { type: 'presentation'; settings: PresentationSettings }
  | { type: 'character.preview'; preset: CharacterPreview }
  | { type: 'overlay-scale'; scale: number }
  | { type: 'overlay-input'; mode: OverlayInputMode; error?: string }
) & { selectionId?: string; revision?: number };
export interface ProviderSettings {
  provider: ProviderId;
  endpoint: string;
  agentId: string;
  sessionId: string;
}
export const OVERLAY_SCALE_LIMITS = { min: 0.4, max: 4 } as const;

export interface AppSettings {
  provider: ProviderSettings;
  jevEnabled: boolean;
  jevModel: string;
  modelPath: string;
  scale: number;
  alwaysOnTop: boolean;
  clickThrough: boolean;
  expressionMap?: Partial<Record<Emotion, string>>;
  gestureMap?: Partial<Record<Gesture, string>>;
  presentation?: PresentationSettings;
}
export interface ModelInventory {
  url: string;
  name: string;
  expressions: string[];
  motions: string[];
  parameters: Array<{ id: string; name: string }>;
  expressionMap: Partial<Record<Emotion, string>>;
  gestureMap: Partial<Record<Gesture, string>>;
}
export interface OverlayInputRegion {
  width: number;
  height: number;
  rects: Array<{ x: number; y: number; width: number; height: number }>;
}
export type OverlayInputMode = 'forward' | 'native-shape' | 'unsupported';
export interface OverlayDisplay {
  id: number;
  label: string;
  width: number;
  height: number;
  current: boolean;
}
export interface Bootstrap {
  selectionId: string;
  revision: number;
  settings: AppSettings;
  model?: ModelInventory;
  credentials: { hermes: boolean; grok_bot: boolean; jev: boolean };
  storageSecure: boolean;
  overlayInput: OverlayInputMode;
  overlayInputError?: string;
  capabilities: Capabilities;
  connectionError?: string;
  currentTurn?: TurnView;
  history?: ConversationMessage[];
  historyError?: string;
  historyRestoredRequestId?: string;
}
export interface CompanionBridge {
  bootstrap(): Promise<Bootstrap>;
  testConnection(): Promise<Bootstrap>;
  sessions(): Promise<Array<{ id: string; label: string }>>;
  createSession(): Promise<Bootstrap>;
  saveSettings(settings: AppSettings): Promise<Bootstrap>;
  storeCredential(provider: 'hermes' | 'grok_bot' | 'jev', value: string): Promise<void>;
  chooseModel(): Promise<Bootstrap>;
  previewCharacter(preset: CharacterPreview): Promise<void>;
  send(text: string, selectionId: string, attachments?: AttachmentInput[]): Promise<void>;
  cancel(requestId: string): Promise<void>;
  reconcile(requestId: string): Promise<void>;
  approve(approvalId: string, decision: 'allow_once' | 'deny', requestId: string): Promise<void>;
  openChat(): Promise<void>;
  openSettings(): Promise<void>;
  openOverlayMenu(): Promise<void>;
  displays(): Promise<OverlayDisplay[]>;
  moveToDisplay(id: number): Promise<void>;
  move(dx: number, dy: number): Promise<void>;
  resizeOverlay(deltaY: number, screenX: number, screenY: number): Promise<void>;
  setDragging(active: boolean): void;
  hitTest(hit: boolean): void;
  setInputRegion(region: OverlayInputRegion | null): void;
  onEvent(listener: (event: CompanionEvent) => void): () => void;
}
export const unsupportedCapabilities = (): Capabilities =>
  Object.fromEntries(
    [
      'text',
      'streaming',
      'attachments.image',
      'attachments.file',
      'session.list',
      'session.resume',
      'session.history',
      'request.reconcile',
      'cancel',
      'tool.events',
      'tool.approvals',
      'pc.tools',
    ].map((key) => [key, 'unsupported']),
  ) as Capabilities;
