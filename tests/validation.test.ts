import { describe, it, expect } from 'vitest';
import {
  allowedEndpoint,
  canonicalEndpoint,
  parseSettings,
  validateAgentEvent,
} from '../src/shared/validation.js';
import { credentialScope } from '../src/main/storage.js';
describe('IPC and endpoint validation', () => {
  it('normalizes equivalent hosts before credentials and leases use them', () => {
    expect(canonicalEndpoint('https://EXAMPLE.test:443/')).toBe('https://example.test');
    expect(credentialScope('hermes', 'https://EXAMPLE.test:443/')).toBe(
      credentialScope('hermes', 'https://example.test'),
    );
    expect(canonicalEndpoint('ssh://tester@EXAMPLE.test/')).toBe('ssh://tester@example.test');
  });
  it('allows SSH key auth but refuses passwords, plaintext remote HTTP and bad payloads', () => {
    expect(allowedEndpoint('ssh://tester@example.test')).toBe(true);
    for (const value of [
      'ssh://tester:password@example.test',
      'ssh://tester@example.test/path',
      'http://example.test',
      'https://tester:password@example.test',
      'file:///etc/passwd',
    ])
      expect(allowedEndpoint(value)).toBe(false);
    expect(
      validateAgentEvent({ type: 'message.delta', payload: { text: 'unbound' } }),
    ).toBeUndefined();
    expect(() =>
      parseSettings({
        provider: {
          provider: 'hermes',
          endpoint: 'http://example.test',
          agentId: 'default',
          sessionId: 's',
        },
        jevEnabled: false,
        jevModel: 'jev-1.14.0',
        modelPath: '',
        scale: 1,
        alwaysOnTop: true,
        clickThrough: true,
      }),
    ).toThrow();
  });
});
