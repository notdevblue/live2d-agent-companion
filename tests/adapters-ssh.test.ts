import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  HERMES_PROGRESS_GUIDANCE,
  HermesSshAdapter,
  sshTarget,
  type NativeBridge,
} from '../src/adapters/hermes-ssh.js';
import { TransportError } from '../src/adapters/transport.js';
import type { AgentEvent, UserTurn } from '../src/shared/contracts.js';
import { TurnCoordinator } from '../src/core/turn-coordinator.js';
const turn: UserTurn = {
  turnId: 'turn-1',
  requestId: 'request-1',
  text: 'hello',
  binding: {
    provider: 'hermes',
    connectionId: 'ssh-host',
    agentId: 'default',
    sessionId: 'existing-session',
    continuity: 'unverified',
  },
};
const receipt = (status = 'started', extra = {}) => ({
  admission_id: 'admission-1',
  ref: { profile_id: '/home/test/.hermes', session_id: 'existing-session' },
  status,
  execution_generation: 7,
  ...extra,
});
const snapshot = {
  session_id: 'existing-session',
  replay_epoch: 'epoch-1',
  last_sequence: 10,
  execution_generation: 6,
  pending: [],
  prompts: [],
};
class FakeBridge implements NativeBridge {
  profileId = '/home/test/.hermes';
  onEvent: NativeBridge['onEvent'] = () => undefined;
  onDisconnect = () => undefined;
  start = vi.fn(async () => undefined);
  close = vi.fn(async () => undefined);
  request = vi.fn(
    async (method: string, _params: Record<string, unknown>): Promise<Record<string, unknown>> => {
      if (method === 'gateway.capabilities') return { per_session_exclusive_submit: true };
      if (method === 'session.resume') return structuredClone(snapshot);
      if (method === 'prompt.submit') return receipt();
      if (method === 'prompt.receipt')
        return receipt('terminal', {
          outcome: 'completed',
          result: { final_response: 'answer', completed: true },
        });
      if (method === 'session.list')
        return { sessions: [{ session_id: 'existing-session', title: 'Existing conversation' }] };
      throw new Error('unexpected mock method');
    },
  );
  event(type: string, seq: number, payload: object = {}, extra = {}) {
    this.onEvent({
      method: 'event',
      params: {
        type,
        seq,
        payload,
        session_id: 'existing-session',
        admission_id: 'admission-1',
        execution_generation: 7,
        replay_epoch: 'epoch-1',
        ...extra,
      },
    });
  }
}
const create = (bridge = new FakeBridge()) => ({
  bridge,
  adapter: new HermesSshAdapter({
    endpoint: 'ssh://tester@example.test',
    profile: 'default',
    bridge,
  }),
});
const until = async (predicate: () => boolean) => vi.waitFor(() => expect(predicate()).toBe(true));

function uploadBridge() {
  const bridge = new FakeBridge();
  const original = bridge.request.getMockImplementation()!;
  const uploads: Array<{ id: string; mime: unknown; bytes: Buffer[] }> = [];
  bridge.request.mockImplementation(async (method, params) => {
    if (method === 'attachment.capabilities') return { images: true, files: true };
    if (method === 'attachment.begin') {
      const id = 'upload-' + uploads.length;
      uploads.push({ id, mime: params.mime, bytes: [] });
      return { upload_id: id };
    }
    if (method === 'attachment.chunk') {
      const upload = uploads.find((row) => row.id === params.upload_id)!;
      const bytes = Buffer.from(String(params.data_base64), 'base64');
      upload.bytes.push(bytes);
      return { written: Number(params.offset) + bytes.length };
    }
    if (method === 'attachment.finish') {
      const upload = uploads.find((row) => row.id === params.upload_id)!;
      return upload.mime === 'image/png'
        ? { path: '/home/test/.hermes/cache/images/owned.png', mime: 'image/png' }
        : { attached: true, ref_text: '@file:"attachments/report one.txt"' };
    }
    if (method === 'attachment.release') return {};
    return original(method, params);
  });
  return { bridge, uploads, adapter: create(bridge).adapter };
}
const imageFile = () => ({
  name: 'picture.png',
  mime: 'image/png',
  data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]),
});

describe('Hermes SSH native adapter', () => {
  it('discovers only probed attachment support and keeps older bridges unsupported', async () => {
    const { adapter } = uploadBridge();
    expect(await adapter.discover()).toMatchObject({
      'attachments.image': 'supported',
      'attachments.file': 'supported',
    });
    expect(await create().adapter.discover()).toMatchObject({
      'attachments.image': 'unsupported',
      'attachments.file': 'unsupported',
    });
  });
  it('uploads bounded chunks and submits immutable image references plus actual file refs', async () => {
    const { adapter, bridge, uploads } = uploadBridge();
    const file = {
      name: 'report one.txt',
      mime: 'text/plain',
      data: new Uint8Array(115_000).fill(65),
    };
    const events: AgentEvent[] = [];
    await adapter.send({ ...turn, attachments: [imageFile(), file] }, (event) =>
      events.push(event),
    );
    expect(Buffer.concat(uploads[0]!.bytes)).toEqual(Buffer.from(imageFile().data));
    expect(Buffer.concat(uploads[1]!.bytes)).toEqual(Buffer.from(file.data));
    const begin = bridge.request.mock.calls.filter(([method]) => method === 'attachment.begin');
    expect(begin[1]![1]).toMatchObject({
      session_id: 'existing-session',
      size: file.data.length,
      mime: 'application/octet-stream',
      sha256: createHash('sha256').update(file.data).digest('hex'),
    });
    for (const [method, params] of bridge.request.mock.calls)
      if (method === 'attachment.chunk')
        expect(String(params.data_base64).length).toBeLessThanOrEqual(65536);
    const submitted = bridge.request.mock.calls.find(([method]) => method === 'prompt.submit')![1];
    expect(submitted).toMatchObject({
      text: '@file:"attachments/report one.txt"\n\nhello',
      api_text: `@file:"attachments/report one.txt"\n\nhello\n\n${HERMES_PROGRESS_GUIDANCE}`,
      attachments: [{ path: '/home/test/.hermes/cache/images/owned.png', mime: 'image/png' }],
    });
    expect(bridge.request.mock.calls.at(-1)).toEqual([
      'attachment.release',
      { upload_ids: ['upload-0', 'upload-1'] },
    ]);
    expect(events[0]!.type).toBe('turn.accepted');
  });
  it('fails unsupported or broken uploads before prompt submission and cleans owned staging', async () => {
    for (const mode of ['unsupported', 'broken'] as const) {
      const { adapter, bridge } = uploadBridge(),
        original = bridge.request.getMockImplementation()!;
      bridge.request.mockImplementation(async (method, params) => {
        if (mode === 'unsupported' && method === 'attachment.capabilities')
          return { images: false, files: false };
        if (mode === 'broken' && method === 'attachment.chunk')
          throw new Error('private byte failure');
        return original(method, params);
      });
      const events: AgentEvent[] = [];
      await adapter.send({ ...turn, attachments: [imageFile()] }, (event) => events.push(event));
      expect(events).toMatchObject([{ type: 'turn.failed' }]);
      expect(JSON.stringify(events)).not.toContain('private byte failure');
      expect(bridge.request.mock.calls.some(([method]) => method === 'prompt.submit')).toBe(false);
      if (mode === 'broken')
        expect(bridge.request.mock.calls.at(-1)![0]).toBe('attachment.release');
    }
  });
  it('confirms cancellation during chunk upload and never submits later', async () => {
    const { adapter, bridge } = uploadBridge(),
      original = bridge.request.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    bridge.request.mockImplementation(async (method, params) => {
      if (method === 'attachment.chunk') await gate;
      return original(method, params);
    });
    const events: AgentEvent[] = [];
    const sending = adapter.send({ ...turn, attachments: [imageFile()] }, (event) =>
      events.push(event),
    );
    await until(() => bridge.request.mock.calls.some(([method]) => method === 'attachment.chunk'));
    expect(await adapter.cancel(turn.requestId)).toBe('confirmed');
    release();
    await sending;
    expect(events).toMatchObject([{ type: 'turn.cancelled', payload: { remoteConfirmed: true } }]);
    expect(bridge.request.mock.calls.some(([method]) => method === 'prompt.submit')).toBe(false);
    expect(bridge.request.mock.calls.at(-1)![0]).toBe('attachment.release');
  });
  it('stops staged work on disconnect without reopening a connection for cleanup', async () => {
    const { adapter, bridge } = uploadBridge(),
      original = bridge.request.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    bridge.request.mockImplementation(async (method, params) => {
      if (method === 'attachment.chunk') await gate;
      return original(method, params);
    });
    const events: AgentEvent[] = [];
    const sending = adapter.send({ ...turn, attachments: [imageFile()] }, (e) => events.push(e));
    await until(() => bridge.request.mock.calls.some(([method]) => method === 'attachment.chunk'));
    await adapter.disconnect();
    release();
    await sending;
    expect(
      bridge.request.mock.calls.some(
        ([method]) => method === 'prompt.submit' || method === 'attachment.release',
      ),
    ).toBe(false);
    expect(events.at(-1)!.type).toBe('turn.failed');
  });
  it('keeps an uncertain attachment admission reconciling without uploading or submitting again', async () => {
    const { adapter, bridge } = uploadBridge(),
      original = bridge.request.getMockImplementation()!;
    bridge.request.mockImplementation(async (method, params) => {
      if (method === 'prompt.submit') throw new TransportError('native_timeout', 'timeout');
      return original(method, params);
    });
    const events: AgentEvent[] = [];
    await adapter.send({ ...turn, attachments: [imageFile()] }, (e) => events.push(e));
    expect(events).toMatchObject([{ type: 'turn.reconciling' }]);
    await adapter.reconcile(turn, (e) => events.push(e));
    expect(bridge.request.mock.calls.filter(([method]) => method === 'prompt.submit')).toHaveLength(
      1,
    );
    expect(
      bridge.request.mock.calls.filter(([method]) => method === 'attachment.begin'),
    ).toHaveLength(1);
  });
  it('strictly parses host/user and rejects shell/URL injection', () => {
    expect(sshTarget('ssh://tester@example.test')).toBe('tester@example.test');
    expect(sshTarget('ssh://other@127.0.0.1')).toBe('other@127.0.0.1');
    for (const value of [
      'ssh://-o@example.test',
      'ssh://user@-bad.example',
      'ssh://user:secret@example.test',
      'ssh://user@example.test?command=rm',
      'ssh://user@example.test/command',
      'ssh://user@example.test:2222',
      'ssh://user%3Btouch@example.test',
    ])
      expect(() => sshTarget(value)).toThrow();
  });
  it('lists existing metadata and does not create or activate a Bot', async () => {
    const { bridge, adapter } = create();
    await adapter.connect();
    expect(await adapter.listSessions('default')).toEqual([
      { id: 'existing-session', label: 'Existing conversation' },
    ]);
    expect(bridge.request.mock.calls.map(([method]) => method)).toEqual([
      'gateway.capabilities',
      'session.list',
      'session.list',
      'session.list',
    ]);
    await expect(adapter.listSessions('other')).rejects.toThrow('프로필');
  });
  it('reads only the selected session history without submitting a prompt', async () => {
    const { bridge, adapter } = create();
    const original = bridge.request.getMockImplementation()!;
    bridge.request.mockImplementation(async (method, params) =>
      method === 'session.history'
        ? {
            messages: [
              { id: 'row:1', role: 'user', text: 'question' },
              { id: 'row:2', role: 'assistant', text: 'answer' },
            ],
          }
        : original(method, params),
    );
    expect(await adapter.history(turn.binding)).toHaveLength(2);
    expect(bridge.request.mock.calls).toEqual([
      ['session.resume', { session_id: 'existing-session', omit_messages: true }],
      ['session.history', { session_id: 'existing-session' }],
    ]);
    await expect(adapter.history({ ...turn.binding, agentId: 'other' })).rejects.toThrow();
    bridge.request.mockResolvedValue({ ...snapshot, session_id: 'other' });
    await expect(adapter.history(turn.binding)).rejects.toThrow('세션');
  });
  it('attaches exact existing session and submits JSON data with stable submission ID', async () => {
    const { bridge, adapter } = create();
    const events: AgentEvent[] = [];
    await adapter.send({ ...turn, text: '\";$(touch /tmp/injected);\n' }, (e) => events.push(e));
    expect(bridge.request.mock.calls).toEqual([
      ['session.resume', { session_id: 'existing-session', omit_messages: true }],
      [
        'prompt.submit',
        {
          session_id: 'existing-session',
          submission_id: 'request-1',
          text: '\";$(touch /tmp/injected);\n',
          api_text: `\";$(touch /tmp/injected);\n\n\n${HERMES_PROGRESS_GUIDANCE}`,
        },
      ],
    ]);
    bridge.event('message.delta', 11, { text: 'ans' });
    bridge.event('message.complete', 12, {
      text: 'answer',
      status: 'complete',
      outcome: 'completed',
    });
    await until(() => events.some((e) => e.type === 'turn.completed'));
    expect(events.map((e) => e.type)).toEqual([
      'turn.accepted',
      'message.delta',
      'message.complete',
      'turn.completed',
    ]);
    expect(events[0]).toMatchObject({ payload: { remoteRunId: 'admission-1' } });
  });
  it('isolates other sessions/admissions, duplicate and stale events', async () => {
    const { bridge, adapter } = create();
    const events: AgentEvent[] = [];
    await adapter.send(turn, (e) => events.push(e));
    bridge.event('message.delta', 11, { text: 'wrong-session' }, { session_id: 'other' });
    bridge.event('message.delta', 11, { text: 'wrong-admission' }, { admission_id: 'other' });
    bridge.event('message.delta', 12, { text: 'ok' });
    bridge.event('message.delta', 12, { text: 'duplicate' });
    expect(events.filter((e) => e.type === 'message.delta').map((e) => e.payload.text)).toEqual([
      'ok',
    ]);
  });
  it('closes streamed progress at null boundaries and keeps final text in its own message', async () => {
    const { bridge, adapter } = create();
    const events: AgentEvent[] = [];
    await adapter.send(turn, (e) => events.push(e));
    bridge.event('message.start', 11, {});
    bridge.event('message.delta', 12, { text: '확인하고 있어요.' });
    bridge.event('message.delta', 13, { text: null });
    bridge.event('message.delta', 14, { text: null });
    expect(events.filter((e) => e.type === 'message.complete')).toMatchObject([
      { payload: { text: '확인하고 있어요.', messageId: 'admission-1' } },
    ]);
    expect(events.some((e) => e.type === 'turn.completed')).toBe(false);
    expect(bridge.request.mock.calls.some(([method]) => method === 'prompt.receipt')).toBe(false);
    bridge.event('message.delta', 15, { text: 'answer' });
    bridge.event('message.complete', 16, { text: 'answer' });
    await until(() => events.some((e) => e.type === 'turn.completed'));
    expect(events.filter((e) => e.type === 'message.complete')).toMatchObject([
      { payload: { messageId: 'admission-1' } },
      { payload: { messageId: 'admission-1:message:1', text: 'answer' } },
    ]);
  });
  it('exposes only genuine non-streamed interim messages, not duplicate or empty commentary', async () => {
    const { bridge, adapter } = create();
    const events: AgentEvent[] = [];
    await adapter.send(turn, (e) => events.push(e));
    bridge.event('message.interim', 11, { text: '진행 중입니다.', already_streamed: false });
    bridge.event('message.interim', 12, { text: '진행 중입니다.', already_streamed: true });
    bridge.event('message.interim', 13, { text: '   ', already_streamed: false });
    bridge.event('message.delta', 14, { text: null });
    bridge.event('message.complete', 15, { text: 'answer' });
    await until(() => events.some((e) => e.type === 'turn.completed'));
    expect(events.filter((e) => e.type === 'message.complete')).toMatchObject([
      { payload: { text: '진행 중입니다.', messageId: 'admission-1' } },
      { payload: { text: 'answer', messageId: 'admission-1:message:1' } },
    ]);
  });
  it('buffers events arriving before submission acknowledgment', async () => {
    const { bridge, adapter } = create();
    const original = bridge.request.getMockImplementation()!;
    bridge.request.mockImplementation(async (method, params) => {
      if (method === 'prompt.submit') bridge.event('message.delta', 11, { text: 'early' });
      return original(method, params);
    });
    const events: AgentEvent[] = [];
    await adapter.send(turn, (e) => events.push(e));
    expect(events.map((e) => e.type)).toEqual(['turn.accepted', 'message.delta']);
  });
  it('does not submit to busy or differently resolved session', async () => {
    for (const badSnapshot of [
      { ...snapshot, session_id: 'another-session' },
      { ...snapshot, pending: [receipt()] },
    ]) {
      const { bridge, adapter } = create();
      bridge.request.mockResolvedValue(badSnapshot);
      const events: AgentEvent[] = [];
      await adapter.send(turn, (e) => events.push(e));
      expect(bridge.request).toHaveBeenCalledTimes(1);
      expect(events[0]?.type).toBe('turn.failed');
    }
  });
  it('uncertain admission timeout holds state and never re-submits', async () => {
    const { bridge, adapter } = create();
    const original = bridge.request.getMockImplementation()!;
    bridge.request.mockImplementation(async (method, params) => {
      if (method === 'prompt.submit') throw new TransportError('native_timeout', 'timeout');
      return original(method, params);
    });
    const events: AgentEvent[] = [];
    await adapter.send(turn, (e) => events.push(e));
    expect(events.map((e) => e.type)).toEqual(['turn.reconciling']);
    expect(bridge.request.mock.calls.filter(([method]) => method === 'prompt.submit')).toHaveLength(
      1,
    );
    await expect(
      adapter.send({ ...turn, requestId: 'request-2' }, (e) => events.push(e)),
    ).rejects.toThrow('이전 요청');
  });
  it('does not turn native server uncertainty or epoch changes into completion', async () => {
    const { bridge, adapter } = create();
    const events: AgentEvent[] = [];
    await adapter.send(turn, (e) => events.push(e));
    bridge.event(
      'message.complete',
      11,
      { text: 'injected', status: 'complete', outcome: 'completed' },
      { replay_epoch: 'different' },
    );
    expect(events.map((e) => e.type)).toEqual(['turn.accepted', 'turn.reconciling']);
    expect(
      bridge.request.mock.calls.filter(([method]) => method === 'prompt.receipt'),
    ).toHaveLength(0);
  });
  it('verifies final receipt and refuses partial results labeled complete', async () => {
    const { bridge, adapter } = create();
    const original = bridge.request.getMockImplementation()!;
    bridge.request.mockImplementation(async (method, params) =>
      method === 'prompt.receipt'
        ? receipt('terminal', {
            outcome: 'completed',
            result: { final_response: 'partial', completed: false, partial: true },
          })
        : original(method, params),
    );
    const events: AgentEvent[] = [];
    await adapter.send(turn, (e) => events.push(e));
    bridge.event('message.complete', 11, {
      text: 'partial',
      status: 'complete',
      outcome: 'completed',
    });
    await until(() => events.some((e) => e.type === 'turn.failed'));
    expect(events.some((e) => e.type === 'turn.completed')).toBe(false);
  });
  it('reconciles restored admission through read-only resume/receipt without submitting', async () => {
    const { bridge, adapter } = create();
    const events: AgentEvent[] = [];
    adapter.restore(turn, 'admission-1', (e) => events.push(e));
    expect(await adapter.reconcile(turn, (e) => events.push(e))).toBe('settled');
    expect(bridge.request.mock.calls.map(([method]) => method)).toEqual([
      'session.resume',
      'prompt.receipt',
    ]);
    expect(events.map((e) => e.type)).toEqual([
      'message.snapshot',
      'message.complete',
      'turn.completed',
    ]);
  });
  it('binds deny to exact generation and cannot reuse uncertain approval', async () => {
    const { bridge, adapter } = create();
    const events: AgentEvent[] = [];
    await adapter.send(turn, (e) => events.push(e));
    bridge.event('approval.request', 11, {
      prompt_id: 'approval-1',
      execution_generation: 7,
      command: 'redacted operation',
    });
    const original = bridge.request.getMockImplementation()!;
    bridge.request.mockImplementation(async (method, params) =>
      method === 'approval.respond'
        ? { status: 'resolved', prompt_id: 'approval-1' }
        : original(method, params),
    );
    const response = { ...turn, approvalId: 'approval-1', decision: 'deny' as const };
    expect(await adapter.respondApproval({ ...response, turnId: 'wrong' })).toBe('closed');
    expect(await adapter.respondApproval(response)).toBe('applied');
    expect(bridge.request.mock.calls.at(-1)).toEqual([
      'approval.respond',
      {
        session_id: 'existing-session',
        execution_generation: 7,
        prompt_id: 'approval-1',
        choice: 'deny',
      },
    ]);
    expect(await adapter.respondApproval(response)).toBe('closed');
  });
  it('disconnect never stops remote gateway or silently cancels a request', async () => {
    const { bridge, adapter } = create();
    const events: AgentEvent[] = [];
    await adapter.send(turn, (e) => events.push(e));
    bridge.onDisconnect();
    await adapter.disconnect();
    expect(events.at(-1)?.type).toBe('turn.reconciling');
    expect(bridge.close).toHaveBeenCalledOnce();
    expect(bridge.request.mock.calls.some(([method]) => /stop|interrupt|cancel/.test(method))).toBe(
      false,
    );
  });
});

describe('profile-backed Hermes conversation', () => {
  it('creates a normal conversation inheriting the selected profile tools', async () => {
    const { bridge, adapter } = create();
    bridge.request.mockResolvedValue({ session_id: 'new-session' });
    const created = await adapter.createSession('default');
    expect(created).toEqual({
      id: 'new-session',
      label: expect.stringMatching(/^Live2D Companion \([a-f0-9]{8}\)$/),
    });
    expect(bridge.request).toHaveBeenCalledWith('session.create', {
      request_id: expect.any(String),
      source: 'gui',
      title: created.label,
      follow_profile_config: true,
    });
    await expect(adapter.createSession('other-profile')).rejects.toThrow('프로필');
  });
  it('an approval timeout remains unknown and never widens to session/always permission', async () => {
    const { bridge, adapter } = create();
    const events: AgentEvent[] = [];
    await adapter.send(turn, (event) => events.push(event));
    bridge.event('approval.request', 11, {
      prompt_id: 'approval-1',
      execution_generation: 7,
      description: 'remote operation',
    });
    const original = bridge.request.getMockImplementation()!;
    bridge.request.mockImplementation(async (method, params) => {
      if (method === 'approval.respond') throw new Error('unknown ack');
      return original(method, params);
    });
    const response = { ...turn, approvalId: 'approval-1', decision: 'allow_once' as const };
    expect(await adapter.respondApproval(response)).toBe('unknown');
    expect(await adapter.respondApproval(response)).toBe('unknown');
    expect(
      bridge.request.mock.calls.filter(([method]) => method === 'approval.respond'),
    ).toHaveLength(1);
    expect(bridge.request.mock.calls.at(-1)?.[1]).toMatchObject({
      choice: 'once',
      execution_generation: 7,
    });
    expect(events.some((event) => event.type === 'approval.resolved')).toBe(false);
  });
  it('cancellation targets original admission/generation and waits for terminal proof', async () => {
    const { bridge, adapter } = create();
    const events: AgentEvent[] = [];
    await adapter.send(turn, (event) => events.push(event));
    let checks = 0;
    const original = bridge.request.getMockImplementation()!;
    bridge.request.mockImplementation(async (method, params) => {
      if (method === 'prompt.receipt')
        return ++checks === 1
          ? receipt('started')
          : receipt('terminal', { outcome: 'interrupted', result: { interrupted: true } });
      if (method === 'session.interrupt')
        return { ref: receipt().ref, execution_generation: 7, execution_state: 'running' };
      return original(method, params);
    });
    expect(await adapter.cancel('request-1')).toBe('confirmed');
    expect(bridge.request).toHaveBeenCalledWith('session.interrupt', {
      session_id: 'existing-session',
      execution_generation: 7,
    });
    expect(events.at(-1)?.type).toBe('turn.cancelled');
  });
});

describe('native in-flight replay recovery', () => {
  it('restores a current approval from the snapshot when replay has expired without answering it', async () => {
    vi.useFakeTimers();
    const { bridge, adapter } = create();
    const original = bridge.request.getMockImplementation()!;
    const expiresAt = Date.now() + 45000;
    bridge.request.mockImplementation(async (method, params) => {
      if (method === 'session.resume')
        return {
          ...snapshot,
          execution_generation: 7,
          prompts: [
            {
              kind: 'approval',
              prompt_id: 'approve-1',
              execution_generation: 7,
              description: 'fixture',
            },
          ],
        };
      if (method === 'prompt.receipt') return receipt('started');
      if (method === 'session.events.since')
        return { replay_epoch: 'epoch-1', snapshot_required: true };
      return original(method, params);
    });
    const metadata = {
      version: 1 as const,
      binding: turn.binding,
      pending: {
        turnId: turn.turnId,
        requestId: turn.requestId,
        state: 'reconciling' as const,
        remoteRunId: 'admission-1',
        eventIds: [],
        effectsCancelled: false,
        approval: { approvalId: 'approve-1', expiresAt, status: 'unknown' as const },
      },
    };
    adapter.restore(
      { binding: turn.binding, turnId: turn.turnId, requestId: turn.requestId },
      'admission-1',
      () => {},
    );
    const core = new TurnCoordinator({ adapter, binding: turn.binding, onEvent: () => {} });
    try {
      core.restore(metadata);
      await vi.advanceTimersByTimeAsync(1);
      expect(core.current).toMatchObject({
        state: 'awaiting_result',
        approval: { approvalId: 'approve-1' },
      });
      expect(core.snapshot().pending?.approval?.status).toBe('pending');
      expect(core.current?.approval?.expiresAt).toBe(expiresAt);
      await vi.advanceTimersByTimeAsync(30001);
      expect(core.current?.approval?.approvalId).toBe('approve-1');
      expect(
        bridge.request.mock.calls.some(([method]) =>
          ['prompt.submit', 'approval.respond', 'session.interrupt', 'prompt.cancel'].includes(
            method,
          ),
        ),
      ).toBe(false);
      // Release the test lease with correlated terminal proof.
      bridge.request.mockImplementation(async (method, params) =>
        method === 'prompt.receipt'
          ? receipt('terminal', {
              outcome: 'completed',
              result: { completed: true, final_response: 'done' },
            })
          : original(method, params),
      );
      await core.reconcile();
      expect(core.current?.state).toBe('completed');
    } finally {
      await core.dispose();
      vi.useRealTimers();
    }
  });
  it('automatically monitors a silent running admission even after replay expires and restores its terminal receipt once', async () => {
    vi.useFakeTimers();
    const { bridge, adapter } = create();
    let completed = false;
    const original = bridge.request.getMockImplementation()!;
    bridge.request.mockImplementation(async (method, params) =>
      method === 'prompt.receipt'
        ? completed
          ? receipt('terminal', {
              outcome: 'completed',
              result: { completed: true, final_response: 'final' },
            })
          : receipt('started')
        : method === 'session.events.since'
          ? { replay_epoch: 'epoch-1', truncated: true, events: [] }
          : original(method, params),
    );
    const judge = { judge: vi.fn() };
    const core = new TurnCoordinator({ adapter, binding: turn.binding, onEvent: () => {}, judge });
    try {
      await core.send('fixture');
      for (let i = 0; i < 8; i++) {
        await vi.advanceTimersByTimeAsync(30001);
        expect(core.current?.state).toBe('awaiting_result');
        expect(core.current?.error).toBeUndefined();
      }
      expect(
        bridge.request.mock.calls.filter(([method]) => method === 'prompt.submit'),
      ).toHaveLength(1);
      completed = true;
      await vi.advanceTimersByTimeAsync(30001);
      expect(core.current).toMatchObject({ state: 'completed', text: 'final' });
      expect(judge.judge).not.toHaveBeenCalled();
      const count = bridge.request.mock.calls.length;
      await vi.advanceTimersByTimeAsync(100000);
      expect(bridge.request.mock.calls).toHaveLength(count);
    } finally {
      await core.dispose();
      vi.useRealTimers();
    }
  });
  it('restores progress boundaries as separate snapshots without replaying live completions', async () => {
    const { bridge, adapter } = create();
    const events: AgentEvent[] = [];
    await adapter.send(turn, (e) => events.push(e));
    bridge.event('message.delta', 11, { text: '진행 중.' });
    const original = bridge.request.getMockImplementation()!;
    bridge.request.mockImplementation(async (method, params) => {
      if (method === 'session.resume') return { ...snapshot, last_sequence: 13 };
      if (method === 'prompt.receipt') return receipt('started');
      if (method === 'session.events.since')
        return {
          replay_epoch: 'epoch-1',
          last_sequence: 13,
          events: [
            {
              type: 'message.delta',
              seq: 12,
              replay_epoch: 'epoch-1',
              admission_id: 'admission-1',
              payload: { text: null },
            },
            {
              type: 'message.delta',
              seq: 13,
              replay_epoch: 'epoch-1',
              admission_id: 'admission-1',
              payload: { text: '최종 답변 중' },
            },
          ],
        };
      return original(method, params);
    });
    expect(await adapter.reconcile(turn, (e) => events.push(e))).toBe('resumed');
    expect(events.filter((e) => e.type === 'message.snapshot')).toMatchObject([
      { payload: { messageId: 'admission-1', text: '진행 중.' } },
      { payload: { messageId: 'admission-1:message:1', text: '최종 답변 중' } },
    ]);
    expect(events.filter((e) => e.type === 'message.complete')).toHaveLength(0);
  });
  it('restores missed deltas as one snapshot instead of replaying delta speech', async () => {
    const { bridge, adapter } = create();
    const events: AgentEvent[] = [];
    await adapter.send(turn, (event) => events.push(event));
    bridge.event('message.delta', 11, { text: 'old ' });
    bridge.onDisconnect();
    const original = bridge.request.getMockImplementation()!;
    bridge.request.mockImplementation(async (method, params) => {
      if (method === 'session.resume')
        return { ...snapshot, last_sequence: 12, execution_generation: 7 };
      if (method === 'prompt.receipt') return receipt('started');
      if (method === 'session.events.since')
        return {
          replay_epoch: 'epoch-1',
          last_sequence: 12,
          truncated: false,
          events: [
            {
              method: 'event',
              params: {
                type: 'message.delta',
                session_id: 'existing-session',
                admission_id: 'admission-1',
                execution_generation: 7,
                replay_epoch: 'epoch-1',
                seq: 12,
                payload: { text: 'new' },
              },
            },
          ],
        };
      return original(method, params);
    });
    expect(await adapter.reconcile(turn, (event) => events.push(event))).toBe('resumed');
    expect(events.filter((event) => event.type === 'message.delta')).toHaveLength(1);
    expect(events.find((event) => event.type === 'message.snapshot')).toMatchObject({
      payload: { text: 'old new' },
    });
    expect(bridge.request).toHaveBeenCalledWith('session.events.since', {
      session_id: 'existing-session',
      replay_epoch: 'epoch-1',
      last_sequence: 11,
    });
  });
  it('an expired replay stays unknown and never re-submits the prompt', async () => {
    const { bridge, adapter } = create();
    const events: AgentEvent[] = [];
    await adapter.send(turn, (event) => events.push(event));
    const original = bridge.request.getMockImplementation()!;
    bridge.request.mockImplementation(async (method, params) =>
      method === 'prompt.receipt'
        ? receipt('started')
        : method === 'session.events.since'
          ? { replay_epoch: 'epoch-1', truncated: true, events: [] }
          : original(method, params),
    );
    expect(await adapter.reconcile(turn, (event) => events.push(event))).toBe('unknown');
    expect(events.at(-1)).toMatchObject({
      type: 'turn.resumed',
      payload: { state: 'awaiting_result' },
    });
    expect(bridge.request.mock.calls.filter(([method]) => method === 'prompt.submit')).toHaveLength(
      1,
    );
  });
});
