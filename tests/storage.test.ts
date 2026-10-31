import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSettings } from '../src/shared/validation.js';
import { JsonFile, CredentialVault, credentialScope } from '../src/main/storage.js';

describe('credential and metadata storage', () => {
  it('fails closed on corrupt pending metadata and refuses oversized writes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'companion-pending-'));
    try {
      const file = new JsonFile(dir, 'pending.json');
      expect(await file.readStrict()).toBeUndefined();
      await file.write({ invalid: false });
      const { writeFile } = await import('node:fs/promises');
      await writeFile(join(dir, 'pending.json'), '{broken');
      await expect(file.readStrict()).rejects.toThrow();
      await expect(file.write('x'.repeat(2_000_001))).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('does not write secrets when OS encryption is unavailable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'companion-vault-'));
    try {
      const file = new JsonFile(dir, 'credentials.json');
      const vault = new CredentialVault(file, {
        available: async () => false,
        encrypt: async (value) => Buffer.from(value),
        decrypt: async (value) => value.toString(),
      });
      await vault.initialize();
      await vault.set('jev', 'private-test-value');
      expect(await vault.get('jev')).toBe('private-test-value');
      expect(await file.read()).toBeUndefined();
      expect(
        await new CredentialVault(file, {
          available: async () => false,
          encrypt: async (value) => Buffer.from(value),
          decrypt: async (value) => value.toString(),
        }).get('jev'),
      ).toBe('');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('persists encrypted values only and scopes remote credentials by endpoint', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'companion-vault-'));
    try {
      const encryption = {
        available: async () => true,
        encrypt: async (value: string) => Buffer.from([...value].reverse().join('')),
        decrypt: async (value: Buffer) => [...value.toString()].reverse().join(''),
      };
      const vault = new CredentialVault(new JsonFile(dir, 'vault.json'), encryption);
      await vault.initialize();
      const scope = credentialScope('hermes', 'https://a.example');
      await vault.set(scope, 'private-test-value');
      expect(await readFile(join(dir, 'vault.json'), 'utf8')).not.toContain('private-test-value');
      const restored = new CredentialVault(new JsonFile(dir, 'vault.json'), encryption);
      await restored.initialize();
      expect(await restored.get(scope)).toBe('private-test-value');
      expect(await restored.get(credentialScope('hermes', 'https://b.example'))).toBe('');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('presentation persistence (FR-SET-001)', () => {
  it('restores presentation alongside an intentional offscreen position', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'companion-presentation-'));
    try {
      const settings = parseSettings({
        provider: { provider: 'mock', endpoint: '', agentId: 'demo', sessionId: 'demo-session' },
        jevEnabled: false,
        jevModel: 'jev-1.14.0',
        modelPath: '',
        scale: 1.4,
        alwaysOnTop: true,
        clickThrough: true,
        presentation: {
          intensity: 'expressive',
          framing: 'close',
          positionLocked: true,
          reducedMotion: true,
        },
      });
      const position = { x: -130, y: 780 };
      await new JsonFile(dir, 'settings.json').write({ settings, position });
      const restored = (await new JsonFile(dir, 'settings.json').read()) as {
        settings: unknown;
        position: unknown;
      };
      expect(parseSettings(restored.settings)).toEqual(settings);
      expect(restored.position).toEqual(position);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
