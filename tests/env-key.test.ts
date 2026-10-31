import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, chmod, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJevEnv } from '../src/main/env-key.js';

describe('explicit local Jev credential file', () => {
  it('accepts bare and named keys across fresh reads without modifying process.env', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'companion-env-'));
    try {
      const path = join(dir, '.env');
      const before = process.env.JEV_API_KEY;
      for (const text of [
        'apikey_test_fixture',
        'JEV_API_KEY="fixture-value" # local',
        'export TYPESAFE_API_KEY=fixture-value',
      ]) {
        await writeFile(path, text, { mode: 0o600 });
        const first = await readJevEnv(path);
        const second = await readJevEnv(path);
        expect(first).toBe(text.startsWith('apikey_') ? 'apikey_test_fixture' : 'fixture-value');
        expect(second).toBe(first);
        expect(process.env.JEV_API_KEY).toBe(before);
      }
      expect(await readJevEnv(join(dir, 'absent'))).toBeUndefined();
      for (const text of ['OTHER_SETTING=local', 'JEV_API_KEY=', '# empty']) {
        await writeFile(path, text, { mode: 0o600 });
        expect(await readJevEnv(path)).toBeUndefined();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('rejects invalid, conflicting or oversized input without exposing contents in errors', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'companion-env-'));
    try {
      const path = join(dir, '.env');
      for (const text of [
        'JEV_API_KEY=fixture-secret\nTYPESAFE_API_KEY=different-secret',
        'JEV_API_KEY="fixture secret"',
        'fixture-secret',
        'JEV_API_KEY=' + 'x'.repeat(66000),
      ]) {
        await writeFile(path, text, { mode: 0o600 });
        await expect(readJevEnv(path)).rejects.toThrow();
        try {
          await readJevEnv(path);
        } catch (error) {
          expect(String(error)).not.toContain('fixture-secret');
        }
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it.skipIf(process.platform === 'win32')(
    'refuses shared permissions and symbolic links',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'companion-env-'));
      try {
        const path = join(dir, '.env');
        await writeFile(path, 'apikey_test_fixture', { mode: 0o600 });
        await chmod(path, 0o644);
        await expect(readJevEnv(path)).rejects.toThrow('600');
        await chmod(path, 0o600);
        await symlink(path, join(dir, 'linked'));
        await expect(readJevEnv(join(dir, 'linked'))).rejects.toThrow();
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});
