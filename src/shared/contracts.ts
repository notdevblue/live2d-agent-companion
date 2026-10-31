export type ProviderId = 'mock' | 'hermes' | 'grok_bot';
export type Support = 'supported' | 'experimental' | 'unsupported';
export type Capability =
  | 'text'
  | 'streaming'
  | 'attachments.image'
  | 'session.list'
  | 'session.resume'
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
export interface UserTurn extends RequestRef {
  text: string;
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
export type Emotion = (typeof EMOTIONS)[number];
export type Gesture = (typeof GESTURES)[number];
export interface ExpressionDecision {
  emotion: Emotion;
  gesture: Gesture;
  confidence: number;
}
export interface ExpressionJudge {
  judge(text: string, signal: AbortSignal): Promise<ExpressionDecision>;
}
export interface CharacterCue extends ExpressionDecision {
  requestId: string;
  segmentId: number;
  source: 'jev' | 'fallback';
}
export interface TurnView extends RequestRef {
  state: TurnState;
  text: string;
  error?: string;
  approval?: { approvalId: string; summary: string; expiresAt: number };
  expressionStatus?: string;
}
export type CompanionEvent = (
  | { type: 'turn'; turn: TurnView }
  | { type: 'character'; state: 'idle' | 'thinking' | 'working' | 'error' }
  | { type: 'cue'; cue: CharacterCue }
) & { selectionId?: string; revision?: number };
export interface ProviderSettings {
  provider: ProviderId;
  endpoint: string;
  agentId: string;
  sessionId: string;
}
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
export interface Bootstrap {
  selectionId: string;
  revision: number;
  settings: AppSettings;
  model?: ModelInventory;
  credentials: { hermes: boolean; grok_bot: boolean; jev: boolean };
  storageSecure: boolean;
  capabilities: Capabilities;
  connectionError?: string;
  currentTurn?: TurnView;
}
export interface CompanionBridge {
  bootstrap(): Promise<Bootstrap>;
  testConnection(): Promise<Bootstrap>;
  sessions(): Promise<Array<{ id: string; label: string }>>;
  createSession(): Promise<Bootstrap>;
  saveSettings(settings: AppSettings): Promise<Bootstrap>;
  storeCredential(provider: 'hermes' | 'grok_bot' | 'jev', value: string): Promise<void>;
  chooseModel(): Promise<Bootstrap>;
  send(text: string, selectionId: string): Promise<void>;
  cancel(requestId: string): Promise<void>;
  reconcile(requestId: string): Promise<void>;
  approve(approvalId: string, decision: 'allow_once' | 'deny', requestId: string): Promise<void>;
  openChat(): Promise<void>;
  move(dx: number, dy: number): Promise<void>;
  hitTest(hit: boolean): void;
  onEvent(listener: (event: CompanionEvent) => void): () => void;
}
export const unsupportedCapabilities = (): Capabilities =>
  Object.fromEntries(
    [
      'text',
      'streaming',
      'attachments.image',
      'session.list',
      'session.resume',
      'request.reconcile',
      'cancel',
      'tool.events',
      'tool.approvals',
      'pc.tools',
    ].map((key) => [key, 'unsupported']),
  ) as Capabilities;
