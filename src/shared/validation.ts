import { z } from 'zod';
import {
  CHARACTER_PREVIEWS,
  DEFAULT_PRESENTATION,
  EMOTIONS,
  OVERLAY_SCALE_LIMITS,
} from './contracts.js';
import type { AgentEvent, AppSettings } from './contracts.js';

const id = z.string().min(1).max(512);
export const bindingSchema = z
  .object({
    provider: z.enum(['mock', 'hermes', 'grok_bot']),
    connectionId: id,
    agentId: id,
    sessionId: id,
    continuity: z.enum(['verified', 'unverified', 'new-session']),
  })
  .strict();
const base = z
  .object({
    schemaVersion: z.literal(1),
    eventId: id,
    turnId: id,
    requestId: id,
    binding: bindingSchema,
    type: z.string(),
    payload: z.unknown(),
  })
  .strict();
const message = z.object({ text: z.string().max(200000), messageId: id }).strict();
const payloads: Record<string, z.ZodType> = {
  'turn.accepted': z.object({ remoteRunId: id.optional() }).strict(),
  'turn.awaiting_result': z.object({}).strict(),
  'turn.reconciling': z.object({ reason: z.string().max(500) }).strict(),
  'turn.resumed': z
    .object({ state: z.enum(['accepted', 'streaming', 'awaiting_result', 'cancel_requested']) })
    .strict(),
  'message.delta': message,
  'message.snapshot': message,
  'message.complete': message,
  'tool.started': z.object({ toolId: id, name: z.string().max(200) }).strict(),
  'tool.completed': z.object({ toolId: id }).strict(),
  'approval.requested': z
    .object({
      approvalId: id,
      summary: z.string().max(2000),
      expiresAt: z.number().finite().positive(),
    })
    .strict(),
  'approval.resolved': z
    .object({ approvalId: id, decision: z.enum(['allow_once', 'deny']) })
    .strict(),
  'approval.closed': z.object({ approvalId: id, reason: z.string().max(500) }).strict(),
  'turn.completed': z.object({}).strict(),
  'turn.failed': z
    .object({ code: z.string().max(100), safeMessage: z.string().max(1000) })
    .strict(),
  'turn.cancelled': z.object({ remoteConfirmed: z.literal(true) }).strict(),
  'turn.interrupted': z.object({ reason: z.string().max(500) }).strict(),
};
export function validateAgentEvent(input: unknown): AgentEvent | undefined {
  const result = base.safeParse(input);
  if (!result.success) return undefined;
  const schema = payloads[result.data.type];
  const payload = schema?.safeParse(result.data.payload);
  if (!payload?.success) return undefined;
  return { ...result.data, payload: payload.data } as AgentEvent;
}
export function allowedEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === 'ssh:') {
      parseSshTarget(value);
      return true;
    }
    return (
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
    );
  } catch {
    return false;
  }
}
export function parseSshTarget(value: string): string {
  const url = new URL(value);
  const user = url.username;
  const host = url.hostname.toLowerCase();
  const hostnameValid =
    host.length <= 253 &&
    host
      .split('.')
      .every(
        (label) => label.length <= 63 && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label),
      );
  if (
    url.protocol !== 'ssh:' ||
    !/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(user) ||
    !hostnameValid ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    (url.pathname && url.pathname !== '/')
  )
    throw new Error('Hermes SSH 연결 주소가 올바르지 않습니다.');
  return `${user}@${host}`;
}
export function canonicalEndpoint(value: string): string {
  if (!value) return '';
  if (!allowedEndpoint(value)) throw new Error('연결 주소 형식이 올바르지 않습니다.');
  const url = new URL(value);
  url.hostname = url.hostname.toLowerCase();
  return url.toString().replace(/\/+$/, '');
}
export const characterPreviewSchema = z.enum(CHARACTER_PREVIEWS);
export const presentationSchema = z
  .object({
    intensity: z.enum(['quiet', 'normal', 'expressive']),
    framing: z.enum(['full', 'bust', 'close']),
    positionLocked: z.boolean(),
    reducedMotion: z.boolean(),
    pettingEnabled: z.boolean().optional(),
  })
  .strict();
export const settingsSchema = z
  .object({
    provider: z
      .object({
        provider: z.enum(['mock', 'hermes', 'grok_bot']),
        endpoint: z.string().max(2048),
        agentId: z.string().min(1).max(200),
        sessionId: z.string().max(200),
      })
      .strict(),
    jevEnabled: z.boolean(),
    jevModel: z
      .string()
      .regex(/^jev-[a-zA-Z0-9.-]+$/)
      .max(100),
    modelPath: z.string().max(4096),
    scale: z.number().min(OVERLAY_SCALE_LIMITS.min).max(OVERLAY_SCALE_LIMITS.max),
    alwaysOnTop: z.boolean(),
    clickThrough: z.boolean(),
    presentation: presentationSchema.optional(),
    expressionMap: z.partialRecord(z.enum(EMOTIONS), z.string().max(200)).optional(),
    gestureMap: z
      .partialRecord(z.enum(['none', 'wave', 'explain', 'thinking']), z.string().max(200))
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.provider.provider !== 'mock' &&
      (!allowedEndpoint(value.provider.endpoint) ||
        (value.provider.provider !== 'hermes' && value.provider.endpoint.startsWith('ssh:')))
    )
      context.addIssue({
        code: 'custom',
        message: 'HTTPS, localhost HTTP 또는 Hermes SSH 주소를 입력하세요.',
        path: ['provider', 'endpoint'],
      });
  })
  .transform((value) => ({
    ...value,
    presentation: value.presentation ?? { ...DEFAULT_PRESENTATION },
    provider: {
      ...value.provider,
      endpoint:
        value.provider.provider === 'mock' ? '' : canonicalEndpoint(value.provider.endpoint),
    },
  }));
export const parseSettings = (input: unknown): AppSettings => settingsSchema.parse(input);
