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
    lastCue?: string;
    lastExpression?: string;
    lastMotion?: string;
    expressionActive?: boolean;
    expressionWeight?: number;
    motionActive?: boolean;
  };
}
