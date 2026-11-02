// The official SDK is fetched into ignored vendor/. Our adapter narrows its runtime surface.
declare module '@cubism/*';
interface Window {
  companion: import('../shared/contracts.js').CompanionBridge;
  __uiReady?: boolean;
  __avatarStatus?: {
    loaded: boolean;
    frames: number;
    error?: string;
    parameters?: number;
    maskGroups?: number;
    maskBuffers?: number;
    lastCue?: string;
    lastSegmentId?: number;
    lastAttitude?: string;
    lastExpression?: string;
    lastMotion?: string;
    expressionActive?: boolean;
    expressionWeight?: number;
    motionActive?: boolean;
    actingPreset?: string;
    posePhase?: string;
    pettingWeight?: number;
    /** Independent local idle owner, never a semantic message hand gesture. */
    localIdleGesture?: boolean;
    /** Finite local idle face attention, independent of semantic cues and hands. */
    localIdleAttention?: boolean;
    lastPreview?: import('../shared/contracts.js').CharacterPreview;
    reactionPhase?: import('./acting.js').ActingFrame['phase'];
    variant?: number;
  };
}
