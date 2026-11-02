import { describe, it, expect } from 'vitest';
import {
  allowedEndpoint,
  canonicalEndpoint,
  characterPreviewSchema,
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

const legacySettings = {
  provider: { provider: 'mock', endpoint: '', agentId: 'demo', sessionId: 'demo-session' },
  jevEnabled: false,
  jevModel: 'jev-1.14.0',
  modelPath: '/model/character.model3.json',
  scale: 1,
  alwaysOnTop: true,
  clickThrough: true,
};
describe('character presentation settings (FR-SET-001)', () => {
  it('migrates legacy settings without losing provider, scale or model fields', () => {
    const migrated = parseSettings(legacySettings);
    expect(migrated).toMatchObject(legacySettings);
    expect(migrated.presentation).toEqual({
      intensity: 'normal',
      framing: 'full',
      positionLocked: false,
      reducedMotion: false,
      pettingEnabled: false,
    });
    migrated.presentation!.positionLocked = true;
    expect(parseSettings(legacySettings).presentation?.positionLocked).toBe(false);
  });
  it('round trips all supported presentation modes and rejects invalid bounds and fields', () => {
    for (const intensity of ['quiet', 'normal', 'expressive'])
      for (const framing of ['full', 'bust', 'close']) {
        const presentation = { intensity, framing, positionLocked: true, reducedMotion: true };
        const parsed = parseSettings({ ...legacySettings, presentation });
        expect(parseSettings(JSON.parse(JSON.stringify(parsed))).presentation).toEqual(
          presentation,
        );
      }
    const presentation = parseSettings(legacySettings).presentation!;
    for (const invalid of [
      { ...presentation, intensity: 'unbounded' },
      { ...presentation, framing: 'camera' },
      { ...presentation, positionLocked: 'true' },
      { ...presentation, reducedMotion: 1 },
      { ...presentation, pettingEnabled: 'true' },
      { ...presentation, network: true },
      {},
      null,
    ])
      expect(() => parseSettings({ ...legacySettings, presentation: invalid })).toThrow();
    expect(parseSettings({ ...legacySettings, scale: 4 }).scale).toBe(4);
    for (const scale of [0, 0.39, 4.01, Infinity, NaN])
      expect(() => parseSettings({ ...legacySettings, scale })).toThrow();
  });
  it('persists explicit petting opt-in while old settings stay disabled', () => {
    const old = {
      intensity: 'normal',
      framing: 'full',
      positionLocked: false,
      reducedMotion: false,
    };
    expect(
      parseSettings({ ...legacySettings, presentation: old }).presentation?.pettingEnabled,
    ).toBeFalsy();
    const enabled = parseSettings({
      ...legacySettings,
      presentation: { ...old, pettingEnabled: true },
    });
    expect(parseSettings(JSON.parse(JSON.stringify(enabled))).presentation?.pettingEnabled).toBe(
      true,
    );
  });
  it('saves all newly offered emotion mapping rows with the existing strict schema', () => {
    const saved = parseSettings({
      ...legacySettings,
      expressionMap: { angry: '@companion/angry', confused: '圈圈眼' },
    });
    expect(parseSettings(JSON.parse(JSON.stringify(saved))).expressionMap).toEqual(
      saved.expressionMap,
    );
  });
  it('accepts only local preview preset enum values', () => {
    for (const preset of ['thinking', 'explain', 'shy', 'tease', 'happy', 'reset'])
      expect(characterPreviewSchema.parse(preset)).toBe(preset);
    for (const invalid of ['tool.started', 'happy;send', '', null, { preset: 'happy' }])
      expect(characterPreviewSchema.safeParse(invalid).success).toBe(false);
  });
});
