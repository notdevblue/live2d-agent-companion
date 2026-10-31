import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { ConversationHistory } from '../src/core/conversation-history.js';
import type { ConversationMessage, TurnView } from '../src/shared/contracts.js';

const previous: ConversationMessage[] = [
  { id: 'row:1', role: 'user', text: 'previous question' },
  { id: 'row:2', role: 'assistant', text: 'previous answer' },
];
const turn = (text: string, requestId = 'request-1'): TurnView => ({
  binding: {
    provider: 'hermes',
    connectionId: 'host-a',
    agentId: 'default',
    sessionId: 'one',
    continuity: 'unverified',
  },
  turnId: 'turn-1',
  requestId,
  state: 'streaming',
  text,
});

describe('conversation display history (FR-CHAT-001)', () => {
  it('loads once across concurrent opens, then updates only the matching reply', async () => {
    const history = new ConversationHistory();
    const loader = vi.fn(async () => previous);
    await Promise.all([history.load(loader), history.load(loader)]);
    history.submitted('request-1', 'same question');
    history.update(turn('part'));
    history.update(turn('whole answer'));
    history.submitted('request-2', 'same question');
    history.update(turn('whole answer', 'request-2'));
    await history.load(loader);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(history.snapshot().map((row) => row.text)).toEqual([
      'previous question',
      'previous answer',
      'same question',
      'whole answer',
      'same question',
      'whole answer',
    ]);
    history.snapshot()[0]!.text = 'mutated snapshot';
    expect(history.snapshot()[0]!.text).toBe('previous question');
    const otherSession = new ConversationHistory();
    await otherSession.load();
    expect(otherSession.snapshot()).toEqual([]);
  });
  it('retries a failed history read without erasing the last displayed transcript', async () => {
    const history = new ConversationHistory();
    await expect(
      history.load(async () => {
        throw new Error('offline');
      }),
    ).rejects.toThrow('offline');
    await history.load(async () => previous);
    await expect(
      history.refresh(async () => {
        throw new Error('offline');
      }),
    ).rejects.toThrow('offline');
    expect(history.snapshot()).toEqual(previous);
    await history.load(async () => previous);
    expect(history.snapshot()).toEqual(previous);
  });
  it('uses provider history for restored requests without guessing identity from identical text', async () => {
    const history = new ConversationHistory();
    history.restoredRequestId = 'restored';
    await history.load(async () => previous);
    history.update(turn('previous answer', 'restored'));
    expect(history.snapshot()).toEqual(previous);
    await history.refresh(async () => [
      ...previous,
      { id: 'row:3', role: 'assistant', text: 'recovered answer' },
    ]);
    history.submitted('new', 'previous question');
    history.update(turn('previous answer', 'new'));
    expect(history.snapshot()).toHaveLength(5);
    expect(history.snapshot().at(-1)?.requestId).toBe('new');
  });
  it('strips private native history sidecars on the host before crossing SSH', () => {
    const raw = {
      messages: [
        { role: 'system', text: 'private system' },
        { role: 'tool', text: 'private output', args: { key: 'private argument' } },
        { role: 'assistant', text: 'private hidden', display_kind: 'hidden' },
        { role: 'user', text: 'question', row_id: 7, display_metadata: { private: true } },
        {
          role: 'assistant',
          text: 'answer',
          row_id: 8,
          reasoning: 'private reasoning',
          tool_calls: [{ private: true }],
        },
        { role: 'assistant', text: '', reasoning: 'private reasoning only' },
      ],
    };
    const result = execFileSync(
      'python3',
      [
        '-c',
        "import json,runpy,sys; b=runpy.run_path('scripts/hermes-bridge.py'); print(json.dumps(b['safe_result']('session.history',json.load(sys.stdin))))",
      ],
      { input: JSON.stringify(raw), encoding: 'utf8' },
    );
    expect(JSON.parse(result)).toEqual({
      messages: [
        { id: 'row:7', role: 'user', text: 'question' },
        { id: 'row:8', role: 'assistant', text: 'answer' },
      ],
    });
    expect(result).not.toContain('private');
  });
});
